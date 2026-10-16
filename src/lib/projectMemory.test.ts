import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  NO_PROJECT_MEMORY,
  PROJECT_MEMORY_CHANGED,
  PROJECT_MEMORY_MAX_CHARS,
  PROJECT_MEMORY_PREAMBLE,
  appendProjectMemory,
  clearProjectMemory,
  harnessProjectMemory,
  isProjectMemoryConflict,
  loadProjectMemory,
  memoryItemFromReply,
  memoryProjectFor,
  projectMemoryBlock,
  projectMemoryEdited,
  projectMemoryForTurn,
  projectMemoryRevision,
  projectMemorySize,
  saveProjectMemory,
  subscribeProjectMemory,
} from "./projectMemory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

const call = vi.mocked(invoke);

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  call.mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("project memory storage", () => {
  it("reads, saves, appends and clears by project key", async () => {
    const saved = {
      key: "/work/app",
      path: "/work/app",
      body: "- Use pnpm",
      updatedAt: 5,
    };
    call.mockResolvedValue(saved);
    await expect(loadProjectMemory("/work/app/")).resolves.toEqual(saved);
    expect(call).toHaveBeenLastCalledWith("project_memory_get", {
      key: "/work/app",
    });

    await saveProjectMemory("/work/app/", "- Use pnpm", 0);
    expect(call).toHaveBeenLastCalledWith("project_memory_set", {
      key: "/work/app",
      path: "/work/app",
      body: "- Use pnpm",
      baseUpdatedAt: 0,
    });
    await saveProjectMemory("/work/app", "- Use pnpm");
    expect(call.mock.lastCall?.[1]).toMatchObject({ baseUpdatedAt: null });

    await appendProjectMemory("/work/app", "- Ship small");
    expect(call).toHaveBeenLastCalledWith("project_memory_append", {
      key: "/work/app",
      path: "/work/app",
      item: "- Ship small",
    });

    await clearProjectMemory("/work/app");
    expect(call).toHaveBeenLastCalledWith("project_memory_delete", {
      key: "/work/app",
    });
  });

  it("keys Windows projects case-insensitively like other project data", async () => {
    call.mockResolvedValue(null);
    await loadProjectMemory("C:\\Users\\Me\\App\\");
    expect(call).toHaveBeenLastCalledWith("project_memory_get", {
      key: "c:/users/me/app",
    });
  });

  it("tells open views in this window about changes", async () => {
    const heard: string[] = [];
    const stop = subscribeProjectMemory((key) => heard.push(key));
    call.mockResolvedValue(null);
    await saveProjectMemory("/a", "");
    await appendProjectMemory("/b", "- x");
    await clearProjectMemory("/c");
    stop();
    await clearProjectMemory("/d");
    expect(heard).toEqual(["/a", "/b", "/c"]);
  });

  it("recognises a refused save based on an older copy", async () => {
    call.mockRejectedValue(new Error(PROJECT_MEMORY_CHANGED));
    const error = await saveProjectMemory("/a", "x", 1).catch(
      (failure: unknown) => failure,
    );
    expect(isProjectMemoryConflict(error)).toBe(true);
    expect(isProjectMemoryConflict(new Error("disk full"))).toBe(false);
  });

  it("does nothing outside the desktop app", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(loadProjectMemory("/a")).resolves.toBeNull();
    await clearProjectMemory("/a");
    expect(call).not.toHaveBeenCalled();
  });
});

describe("project memory for a turn", () => {
  it("wraps the memory in a tagged block after the preamble", () => {
    expect(projectMemoryBlock("  - Use pnpm\r\n- Ship small\n\n")).toBe(
      `<aven-project-memory>\n${PROJECT_MEMORY_PREAMBLE}\n\n- Use pnpm\n- Ship small\n</aven-project-memory>`,
    );
    expect(projectMemoryBlock(" \n ")).toBe("");
    expect(PROJECT_MEMORY_PREAMBLE).toBe(
      "Project memory kept by Aven for this project. Treat it as background context; the user's messages take priority.",
    );
  });

  it("gives agents the memory keeper's sections without its markers", () => {
    expect(
      projectMemoryBlock(
        "<!-- aven:auto — kept up to date by Aven. Edit a line here and it becomes yours. -->\n## Stack\n- Go\n<!-- /aven:auto -->\n\n- Use pnpm",
      ),
    ).toBe(
      `<aven-project-memory>\n${PROJECT_MEMORY_PREAMBLE}\n\n## Stack\n- Go\n\n- Use pnpm\n</aven-project-memory>`,
    );
  });

  it("hashes text into a short revision that changes with the content", () => {
    const one = projectMemoryRevision("alpha");
    expect(one).toMatch(/^[0-9a-f]{9,}$/);
    expect(projectMemoryRevision("alpha")).toBe(one);
    expect(projectMemoryRevision("alphb")).not.toBe(one);
    expect(projectMemoryRevision("")).toBe("");
    const memory = harnessProjectMemory("- a");
    expect(memory.text).toContain("- a");
    expect(memory.revision).toBe(projectMemoryRevision(memory.text));
    expect(harnessProjectMemory("  ")).toEqual(NO_PROJECT_MEMORY);
  });

  it("reads the project's memory, or none for folders that are not projects", async () => {
    call.mockResolvedValue({
      key: "/work/app",
      path: "/work/app",
      body: "- Use pnpm",
      updatedAt: 1,
    });
    const memory = await projectMemoryForTurn("/work/app");
    expect(memory).toEqual(harnessProjectMemory("- Use pnpm"));
    expect(memory?.text).toContain(PROJECT_MEMORY_PREAMBLE);

    call.mockClear();
    await expect(projectMemoryForTurn("/")).resolves.toEqual(NO_PROJECT_MEMORY);
    expect(memoryProjectFor("~")).toBeNull();
    expect(memoryProjectFor(undefined)).toBeNull();
    expect(call).not.toHaveBeenCalled();

    call.mockResolvedValue(null);
    await expect(projectMemoryForTurn("/work/empty")).resolves.toEqual(
      NO_PROJECT_MEMORY,
    );
  });

  it("reports an unreadable memory as unknown, not as removed", async () => {
    call.mockRejectedValue(new Error("Chat history could not be opened"));
    await expect(projectMemoryForTurn("/work/app")).resolves.toBeUndefined();
  });
});

describe("remembering a reply", () => {
  it("starts from the first paragraph of prose as one list item", () => {
    expect(
      memoryItemFromReply(
        "## Summary\n\nThe API client now retries\non 503 responses.\n\n```ts\nretry()\n```\n\nMore detail.",
      ),
    ).toBe("- The API client now retries on 503 responses.");
    expect(
      memoryItemFromReply(
        "```sh\nnpm test\n```\n\n- Tests live next to each module.\n- Name them after it.",
      ),
    ).toBe("- Tests live next to each module. Name them after it.");
    expect(memoryItemFromReply("```\nonly code\n```")).toBe("");
    expect(memoryItemFromReply("   ")).toBe("");
  });

  it("keeps long replies short, ending on a sentence when it can", () => {
    const sentence = "Use the shared theme tokens for every new colour.";
    const item = memoryItemFromReply(`${sentence} ${"word ".repeat(200)}`);
    expect(item).toBe(`- ${sentence}`);
    const run = memoryItemFromReply("word ".repeat(200));
    expect(run.endsWith("…")).toBe(true);
    expect(run.length).toBeLessThanOrEqual(405);
  });

  it("says when it was last edited", () => {
    const now = Date.UTC(2026, 9, 15, 12);
    expect(projectMemoryEdited(now - 20_000, now)).toBe("Edited just now");
    expect(projectMemoryEdited(now - 5 * 60_000, now)).toBe("Edited 5 min ago");
    expect(projectMemoryEdited(now - 3 * 3_600_000, now)).toBe(
      "Edited 3 h ago",
    );
    expect(projectMemoryEdited(now - 2 * 86_400_000, now)).toBe(
      "Edited 2 d ago",
    );
    expect(projectMemoryEdited(now - 30 * 86_400_000, now)).toMatch(
      /^Edited \S/,
    );
    expect(projectMemoryEdited(0, now)).toBe("");
  });

  it("labels the size against the cap", () => {
    expect(PROJECT_MEMORY_MAX_CHARS).toBe(8000);
    expect(projectMemorySize(0)).toBe("0 of 8k characters");
    expect(projectMemorySize(1234)).toBe("1.2k of 8k characters");
    expect(projectMemorySize(8000)).toBe("8k of 8k characters");
  });
});
