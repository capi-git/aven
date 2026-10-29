// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerHarness } from "../lib/harness/registry";
import { codexAdapter } from "../lib/harness/codexAdapter";
import {
  invalidateProjectFiles,
  PROJECT_FILES_FRESH_MS,
} from "../lib/fileIndex";
import {
  applyFileMentionsToTurn,
  resetStableMentionLabels,
} from "../lib/fileMentions";
import type { ProjectFile } from "../lib/fs";
import { resetOpenFiles, setOpenFiles } from "../lib/openFiles";
import { Composer } from "./Composer";

const listing = vi.hoisted(() => ({
  files: [] as ProjectFile[],
  scans: 0,
}));
vi.mock("./useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [], refresh: async () => true }),
}));
vi.mock("../lib/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/fs")>()),
  listProjectFiles: vi.fn(async () => {
    listing.scans += 1;
    return listing.files;
  }),
}));
vi.mock("../lib/notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/notes")>()),
  loadNotes: vi.fn(async () => []),
}));
vi.mock("../hooks/useTabGroupLogos", () => ({ useTabGroupLogos: () => ({}) }));
vi.mock("./ComposerRunner", () => ({ ComposerRunner: () => null }));

const app: ProjectFile = {
  name: "App.tsx",
  path: "/work/site/src/App.tsx",
  relative: "src/App.tsx",
};
const outside = "/Users/me/Documents/Stanislaus impressions.md";

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof Composer>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  registerHarness(codexAdapter);
  invalidateProjectFiles();
  resetOpenFiles();
  resetStableMentionLabels();
  listing.files = [app];
  listing.scans = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    enabled: true,
    focused: false,
    harness: "codex",
    model: "gpt-5",
    runtimeMode: "full-access",
    cwd: "/work/site",
    executionCwd: "/work/site",
    hideTopBar: true,
    onFocus: vi.fn(),
    onCwdChange: vi.fn(),
    onModelChange: vi.fn(),
    onRuntimeModeChange: vi.fn(),
    onSubmit: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  resetOpenFiles();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(patch: Partial<ComponentProps<typeof Composer>> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(createElement(Composer, props)));
}
const field = () => container.querySelector("textarea")!;
const picker = () => container.querySelector("[data-mention-picker]");
const options = () =>
  [...container.querySelectorAll<HTMLElement>('[role="option"]')].map(
    (option) => option.textContent ?? "",
  );
async function type(text: string) {
  await act(async () => {
    const el = field();
    el.value = text;
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    field().dispatchEvent(
      new KeyboardEvent("keyup", { key: text.slice(-1), bubbles: true }),
    );
  });
}
async function press(key: string) {
  await act(async () => {
    field().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
  });
}

describe("@ offers files open in tabs", () => {
  it("lists open files first, an outside one by name with its folder", async () => {
    setOpenFiles([outside, app.path]);
    await render();
    await type("@");
    expect(picker()).not.toBeNull();
    const rows = options();
    expect(rows[0]).toBe("Stanislaus impressions.md~/Documents");
    expect(rows[1]).toBe("App.tsxsrc");
    // The project's own entry for an open file is not listed twice.
    expect(rows.filter((row) => row.startsWith("App.tsx"))).toHaveLength(1);
  });

  it("matches open files as the query narrows", async () => {
    setOpenFiles([outside]);
    await render();
    await type("@stan");
    expect(options()).toEqual(["Stanislaus impressions.md~/Documents"]);
  });

  it("opens in a chat with no project when files are open", async () => {
    setOpenFiles([outside]);
    await render({ cwd: "~", executionCwd: "~" });
    await type("@");
    expect(options()).toEqual(["Stanislaus impressions.md~/Documents"]);
  });

  it("sends an outside file's full path, even after its tab closes", async () => {
    setOpenFiles([outside]);
    await render();
    await type("@stan");
    await press("Enter");
    expect(field().value).toBe("@Stanislaus-impressions.md ");
    expect(container.querySelectorAll(".chat-reference")).toHaveLength(1);

    setOpenFiles([]);
    await type("@Stanislaus-impressions.md summarise this");
    await press("Enter");
    const sent = vi.mocked(props.onSubmit).mock.calls[0]![0];
    expect(sent).toBe("@Stanislaus-impressions.md summarise this");
    const turn = await applyFileMentionsToTurn(sent, "/work/site");
    expect(turn).toContain(`- @Stanislaus-impressions.md → ${outside}`);
  });
});

describe("@ picker listing", () => {
  it("rescans a listing that is a few seconds old when it opens", async () => {
    await render();
    await type("@");
    expect(options()).toContain("App.tsxsrc");
    expect(listing.scans).toBe(1);

    // An agent writes a file; the listing just read still counts as current.
    listing.files = [
      app,
      {
        name: "impressions.md",
        path: "/work/site/impressions.md",
        relative: "impressions.md",
      },
    ];
    await type("");
    await type("@");
    expect(listing.scans).toBe(1);
    expect(options()).not.toContain("impressions.md");

    await type("");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + PROJECT_FILES_FRESH_MS + 1);
    await type("@");
    expect(listing.scans).toBe(2);
    expect(options()).toContain("impressions.md");
  });
});

describe("Add to chat from a file tab", () => {
  it("mentions the file at the end of the message and focuses the box", async () => {
    await render({ initialDraft: "Look at" });
    const consumed = vi.fn();
    await render({
      quoteRequest: { id: 1, text: "", mention: outside },
      onQuoteRequestConsumed: consumed,
    });
    expect(field().value).toBe("Look at @Stanislaus-impressions.md ");
    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe(field().value.length);
    expect(consumed).toHaveBeenCalledWith(1);
    expect(container.querySelectorAll(".chat-reference")).toHaveLength(1);

    await render({ quoteRequest: { id: 2, text: "", mention: app.path } });
    expect(field().value).toBe("Look at @Stanislaus-impressions.md @App.tsx ");
  });

  it("adds a file whose name can't be an @ label as its path", async () => {
    await render({
      quoteRequest: { id: 1, text: "", mention: "/tmp/odd@name.md" },
    });
    expect(field().value.trim()).toBe("/tmp/odd@name.md");
  });
});
