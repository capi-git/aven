// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getKeeperProject,
  offerMemoryKeeper,
  resetMemoryKeeperCache,
  updateKeeperProject,
} from "../lib/memoryKeeper";
import {
  MemoryKeeperChangeNote,
  MemoryKeeperOffer,
  MemoryKeeperSwitch,
} from "./MemoryKeeper";

const native = vi.hoisted(() => ({
  available: new Set<string>(["claude"]),
  memory: null as null | { body: string; updatedAt: number },
  saves: [] as { body: string; baseUpdatedAt: number | null }[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === "project_memory_get")
      return native.memory
        ? { key: "/work/shop", path: "/work/shop", ...native.memory }
        : null;
    if (command === "project_memory_set") {
      native.saves.push({
        body: args!.body as string,
        baseUpdatedAt: args!.baseUpdatedAt as number | null,
      });
      native.memory = {
        body: args!.body as string,
        updatedAt: (native.memory?.updatedAt ?? 0) + 1,
      };
      return { key: "/work/shop", path: "/work/shop", ...native.memory };
    }
    return null;
  }),
  isTauri: () => true,
  convertFileSrc: (path: string) => path,
}));

vi.mock("../lib/harness/availability", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isHarnessAvailable: (id: string) => native.available.has(id),
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

const PROJECT = "/work/shop";
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetMemoryKeeperCache();
  native.available = new Set(["claude"]);
  native.memory = null;
  native.saves = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  resetMemoryKeeperCache();
});

async function render(element: ReturnType<typeof createElement>) {
  await act(async () => root.render(element));
}

function button(label: string) {
  return [...container.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
}

describe("the offer above the message box", () => {
  it("asks once, and Turn on starts keeping", async () => {
    await render(createElement(MemoryKeeperOffer, { project: PROJECT }));
    expect(container.textContent).toBe("");
    await act(async () => offerMemoryKeeper(PROJECT));
    expect(container.textContent).toContain(
      "Keep this project's memory up to date?",
    );
    expect(container.textContent).not.toContain("Let Aven");
    await act(async () => button("Turn on")!.click());
    expect(getKeeperProject(PROJECT).consent).toBe("on");
    expect(container.textContent).toBe("");
  });

  it("Not now is remembered for the project", async () => {
    offerMemoryKeeper(PROJECT);
    await render(createElement(MemoryKeeperOffer, { project: PROJECT }));
    await act(async () => button("Not now")!.click());
    expect(getKeeperProject(PROJECT).consent).toBe("off");
    expect(container.querySelector("[data-memory-keeper-offer]")).toBeNull();
  });

  it("wraps its question in a narrow chat instead of cutting it off", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/chrome/MemoryKeeper.css", "utf8");
    const rule = css.match(/\.memory-keeper-offer-copy \{([^}]*)\}/)?.[1];
    expect(rule).toBeDefined();
    expect(rule).not.toMatch(/white-space:\s*nowrap/);
    expect(rule).not.toMatch(/text-overflow:\s*ellipsis/);
  });

  it("stays hidden when no model could keep the memory", async () => {
    native.available = new Set();
    offerMemoryKeeper(PROJECT);
    await render(createElement(MemoryKeeperOffer, { project: PROJECT }));
    expect(container.querySelector("[data-memory-keeper-offer]")).toBeNull();
  });
});

describe("the switch", () => {
  it("turns keeping on and off, and shows which model keeps it", async () => {
    await render(
      createElement(MemoryKeeperSwitch, { path: PROJECT, details: true }),
    );
    const toggle =
      container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.textContent).toContain("Kept up to date by Aven");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    // Turning it on asks for a pass straight away.
    expect(container.textContent).toContain("updating…");
    await act(async () =>
      updateKeeperProject(PROJECT, (state) => ({
        ...state,
        requested: undefined,
        model: "Claude · Haiku 4.5",
        lastRunAt: Date.now() - 2 * 60 * 60_000,
      })),
    );
    expect(container.textContent).toContain(
      "Claude · Haiku 4.5 · last ran 2 h ago",
    );
    await act(async () => button("Refresh now")!.click());
    expect(getKeeperProject(PROJECT).requested?.manual).toBe(true);
    await act(async () => toggle.click());
    expect(getKeeperProject(PROJECT).consent).toBe("off");
    expect(button("Refresh now")).toBeUndefined();
  });

  it("explains a failed update quietly", async () => {
    updateKeeperProject(PROJECT, () => ({
      consent: "on",
      lastError: "Claude text generation timed out",
    }));
    await render(
      createElement(MemoryKeeperSwitch, { path: PROJECT, details: true }),
    );
    expect(container.textContent).toContain(
      "Last update didn't finish: Claude text generation timed out",
    );
  });

  it("cannot be turned on without Claude Code or Codex", async () => {
    native.available = new Set();
    await render(
      createElement(MemoryKeeperSwitch, { path: PROJECT, details: true }),
    );
    expect(
      container.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled,
    ).toBe(true);
    expect(container.textContent).toContain(
      "Needs Claude Code or Codex installed.",
    );
  });
});

describe("the change note", () => {
  const change = (patch = {}) => ({
    at: Date.now() - 2 * 60 * 60_000,
    kind: "update" as const,
    added: 2,
    removed: 1,
    before: "- Before",
    baselineBefore: "## Stack\n- Go",
    updatedAt: 7,
    seen: false,
    ...patch,
  });

  it("says what changed and undoes it in one click", async () => {
    native.memory = { body: "- After", updatedAt: 7 };
    updateKeeperProject(PROJECT, () => ({ consent: "on", change: change() }));
    await render(
      createElement(MemoryKeeperChangeNote, { path: PROJECT, editing: false }),
    );
    expect(container.textContent).toContain(
      "Updated by Aven 2 h ago · +2 −1 lines",
    );
    await act(async () => button("Undo")!.click());
    await act(async () => undefined);
    expect(native.saves).toEqual([{ body: "- Before", baseUpdatedAt: 7 }]);
    expect(container.textContent).toContain("Aven's last update was undone");
  });

  it("waits while the editor holds unsaved text", async () => {
    updateKeeperProject(PROJECT, () => ({ consent: "on", change: change() }));
    await render(
      createElement(MemoryKeeperChangeNote, { path: PROJECT, editing: true }),
    );
    expect(button("Undo")!.disabled).toBe(true);
  });
});
