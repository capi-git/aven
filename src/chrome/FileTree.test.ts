// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  listCachedDir,
  notifyDirsChanged,
  saveExpanded,
} from "../lib/fileTree";
import { notifyGitChanged, type FsEntry } from "../lib/fs";
import { FileTree } from "./FileTree";

const { iconRender, directories, pendingDirectories } = vi.hoisted(() => ({
  iconRender: vi.fn(),
  directories: new Map<string, FsEntry[]>(),
  pendingDirectories: new Map<string, Promise<FsEntry[]>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async (command: string, args: { path: string }) => {
    if (command === "git_diff_stats")
      return { files: 1, additions: 2, deletions: 0 };
    if (command !== "list_dir")
      throw new Error(`Unexpected command: ${command}`);
    return (
      pendingDirectories.get(args.path) ?? directories.get(args.path) ?? []
    );
  }),
}));

// Count row renders independently of FileTypeIcon's own memoization.
vi.mock("./FileTypeIcon", () => ({
  FileTypeIcon: ({ name }: { name: string }) => {
    iconRender(name);
    return createElement("span", { "data-icon": name });
  },
}));

let container: HTMLDivElement;
let root: Root;
let cwd: string;
let props: ComponentProps<typeof FileTree>;
let project = 0;

function file(name: string): FsEntry {
  return { name, path: `${cwd}/${name}`, isDir: false, ignored: false };
}

function render(tick = 0, hidden = false) {
  root.render(
    createElement(
      "div",
      { hidden, "data-tick": tick },
      createElement(FileTree, props),
    ),
  );
}

function row(name: string): HTMLButtonElement {
  return container.querySelector(`[role="treeitem"][title="${cwd}/${name}"]`)!;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cwd = `/project-${++project}`;
  props = { cwd, onOpenFile: vi.fn() };
  directories.set(cwd, [file("first.ts")]);
  await listCachedDir(cwd);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  pendingDirectories.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FileTree render isolation", () => {
  it("does not read directories or Git stats when initially disabled", async () => {
    const folder = { ...file("src"), isDir: true };
    directories.set(cwd, [folder]);
    notifyDirsChanged();
    await listCachedDir(cwd);
    saveExpanded(cwd, new Set([cwd, folder.path]));
    props = { ...props, enabled: false, onShowSourceControl: vi.fn() };
    vi.mocked(invoke).mockClear();

    await act(async () => render());
    expect(row("src")).not.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps loaded rows and scroll while hidden, then refreshes in place on reveal", async () => {
    vi.useFakeTimers();
    const folder = { ...file("src"), isDir: true };
    directories.set(cwd, [folder, file("first.ts")]);
    directories.set(folder.path, [file("src/old.ts")]);
    notifyDirsChanged();
    saveExpanded(cwd, new Set([cwd, folder.path]));
    props = { ...props, onShowSourceControl: vi.fn() };
    await act(async () => render());
    const original = row("first.ts");
    expect(row("src/old.ts")).not.toBeNull();
    await act(async () => original.click());
    const scroll = container.querySelector<HTMLElement>(".overflow-y-auto")!;
    scroll.scrollTop = 80;
    props = { ...props, enabled: false };
    await act(async () => render(1, true));
    vi.mocked(invoke).mockClear();

    await act(async () => {
      notifyDirsChanged();
      notifyGitChanged();
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(row("first.ts")).toBe(original);
    expect(original.className).toContain("bg-content/10");
    expect(row("src/old.ts")).not.toBeNull();
    expect(scroll.scrollTop).toBe(80);
    expect(
      container.querySelector('[aria-label="1 file changed +2"]'),
    ).not.toBeNull();

    let finishRoot!: (entries: FsEntry[]) => void;
    let finishFolder!: (entries: FsEntry[]) => void;
    pendingDirectories.set(
      cwd,
      new Promise((resolve) => {
        finishRoot = resolve;
      }),
    );
    pendingDirectories.set(
      folder.path,
      new Promise((resolve) => {
        finishFolder = resolve;
      }),
    );
    props = { ...props, enabled: true };
    await act(async () => render(2));
    expect(row("first.ts")).toBe(original);
    expect(row("src/old.ts")).not.toBeNull();
    expect(scroll.scrollTop).toBe(80);
    expect(invoke).toHaveBeenCalledWith("list_dir", { path: cwd });
    expect(invoke).toHaveBeenCalledWith("list_dir", { path: folder.path });
    expect(invoke).toHaveBeenCalledWith("git_diff_stats", { cwd });

    await act(async () => {
      finishRoot([folder, file("first.ts"), file("added.ts")]);
      finishFolder([file("src/new.ts")]);
    });
    expect(row("first.ts")).toBe(original);
    expect(row("added.ts")).not.toBeNull();
    expect(row("src/new.ts")).not.toBeNull();
    expect(row("src/old.ts")).toBeNull();
    expect(scroll.scrollTop).toBe(80);
  });

  it.each([false, true])(
    "skips unchanged rows on parent updates (hidden=%s)",
    async (hidden) => {
      await act(async () => render(0, hidden));
      expect(row("first.ts")).not.toBeNull();
      iconRender.mockClear();

      for (let tick = 1; tick <= 20; tick++) act(() => render(tick, hidden));

      expect(iconRender.mock.calls.length).toBe(0);
    },
  );

  it("still updates Git decorations and uses a changed navigation callback", async () => {
    await act(async () => render());
    const onOpenFile = vi.fn();
    props = {
      ...props,
      onOpenFile,
      gitStatuses: {
        files: new Map([[`${cwd}/first.ts`, "modified"]]),
        dirs: new Map(),
      },
    };
    act(() => render(1));
    expect(row("first.ts").querySelector(".text-amber-400")).not.toBeNull();
    act(() => row("first.ts").click());
    expect(onOpenFile).toHaveBeenCalledWith(`${cwd}/first.ts`);
  });

  it("still expands folders and refreshes rows after filesystem changes", async () => {
    saveExpanded(cwd, new Set());
    await act(async () => render());
    expect(row("first.ts")).toBeNull();
    const expand = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    )!;
    await act(async () => expand.click());
    expect(row("first.ts")).not.toBeNull();

    vi.useFakeTimers();
    directories.set(cwd, [file("added.ts")]);
    await act(async () => {
      notifyDirsChanged();
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(row("added.ts")).not.toBeNull();
    expect(row("first.ts")).toBeNull();
  });
});
