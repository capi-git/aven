// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceInspector,
  type WorkspaceInspectorProps,
} from "./WorkspaceInspector";

const mocks = vi.hoisted(() => ({
  loadFiles: vi.fn(),
  loadChanges: vi.fn(),
  loadSearch: vi.fn(),
  files: vi.fn(),
  changes: vi.fn(),
  search: vi.fn(),
  mountFiles: vi.fn(),
  unmountFiles: vi.fn(),
  mountChanges: vi.fn(),
  unmountChanges: vi.fn(),
  mountSearch: vi.fn(),
  unmountSearch: vi.fn(),
  subscribeStatuses: vi.fn(),
  unsubscribeStatuses: vi.fn(),
  changesReady: undefined as Promise<void> | undefined,
}));

vi.mock("./FileTree", () => {
  mocks.loadFiles();
  return {
    FileTree: (props: {
      onSearch: () => void;
      onShowSourceControl: () => void;
    }) => {
      mocks.files(props);
      useEffect(() => {
        mocks.mountFiles();
        return () => mocks.unmountFiles();
      }, []);
      return createElement(
        "div",
        { "data-content": "files" },
        createElement("button", { onClick: props.onSearch }, "Search files"),
        createElement(
          "button",
          { onClick: props.onShowSourceControl },
          "Show source control",
        ),
      );
    },
  };
});

vi.mock("../hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: (cwd: string, enabled: boolean) => {
    useEffect(() => {
      if (!enabled) return;
      mocks.subscribeStatuses(cwd, enabled);
      return () => mocks.unsubscribeStatuses(cwd);
    }, [cwd, enabled]);
    return { files: new Map(), dirs: new Map() };
  },
}));

vi.mock("./SourceControl", async () => {
  mocks.loadChanges();
  if (mocks.changesReady) await mocks.changesReady;
  return {
    SourceControl: (props: unknown) => {
      mocks.changes(props);
      useEffect(() => {
        mocks.mountChanges();
        return () => mocks.unmountChanges();
      }, []);
      return createElement(
        "div",
        { "data-content": "changes" },
        "Changed files",
      );
    },
  };
});

vi.mock("./ProjectSearch", () => {
  mocks.loadSearch();
  return {
    ProjectSearch: (props: unknown) => {
      mocks.search(props);
      useEffect(() => {
        mocks.mountSearch();
        return () => mocks.unmountSearch();
      }, []);
      return createElement(
        "div",
        { "data-content": "search" },
        "Search results",
      );
    },
  };
});

let root: Root;
let container: HTMLDivElement;
let props: WorkspaceInspectorProps;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.changesReady = undefined;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  props = {
    active: true,
    cwd: "/project",
    gitCwd: "/project-worktree",
    tab: "files",
    onTabChange: vi.fn(),
    onClose: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenDiff: vi.fn(),
    onOpenAllChanges: vi.fn(),
    onOpenCommit: vi.fn(),
    filesSearchOpen: false,
    onFilesSearchOpenChange: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(patch: Partial<WorkspaceInspectorProps> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(createElement(WorkspaceInspector, props)));
}

describe("WorkspaceInspector lifecycle", () => {
  it("offers an explicit pin action only when the caller provides it", async () => {
    await render({ cwd: "~", onPin: undefined });
    expect(container.querySelector('[aria-label="Pin inspector"]')).toBeNull();
    const onPin = vi.fn();
    await render({ onPin });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Pin inspector"]')!
        .click(),
    );
    expect(onPin).toHaveBeenCalledOnce();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("does not load or mount file, Git, or search components while closed", async () => {
    await render({ active: false });
    await render({ active: false, tab: "changes" });
    expect(container.childElementCount).toBe(0);
    expect(mocks.loadFiles).not.toHaveBeenCalled();
    expect(mocks.loadChanges).not.toHaveBeenCalled();
    expect(mocks.loadSearch).not.toHaveBeenCalled();
    expect(mocks.subscribeStatuses).not.toHaveBeenCalled();
  });

  it("does not load inspector content without a project", async () => {
    await render({ cwd: "~", gitCwd: undefined });
    expect(container.textContent).toContain("Open a project");
    expect(mocks.loadFiles).not.toHaveBeenCalled();
    expect(mocks.loadChanges).not.toHaveBeenCalled();
    expect(mocks.subscribeStatuses).not.toHaveBeenCalled();
    expect(
      [...container.querySelectorAll('[role="tab"]')].map(
        (tab) => tab.textContent,
      ),
    ).toEqual(["Files", "Changes"]);
  });

  it("mounts only the visible tree and replaces its Git subscription with search", async () => {
    await render();
    expect(mocks.subscribeStatuses).toHaveBeenCalledWith(
      "/project-worktree",
      true,
    );
    expect(mocks.files).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cwd: "/project-worktree",
        onOpenFile: props.onOpenFile,
      }),
    );
    expect(mocks.changes).not.toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-content="files"] button')!
        .click(),
    );
    expect(props.onFilesSearchOpenChange).toHaveBeenCalledWith(true);
    await render({ filesSearchOpen: true, searchFocusToken: 8 });
    expect(mocks.unmountFiles).toHaveBeenCalledOnce();
    expect(mocks.unsubscribeStatuses).toHaveBeenCalledWith("/project-worktree");
    expect(mocks.search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cwd: "/project-worktree",
        focusToken: 8,
        onOpenFile: props.onOpenFile,
      }),
    );
    expect(container.querySelector('[data-content="files"]')).toBeNull();
    expect(container.querySelector('[data-content="changes"]')).toBeNull();
    await render({ active: false });
    expect(mocks.unmountSearch).not.toHaveBeenCalled();
    expect(mocks.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    expect(
      container.querySelector("section")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("preserves source control callbacks and pauses Git content when closing", async () => {
    const onOpenTerminal = vi.fn();
    const onFileMoved = vi.fn();
    const onFileDeleted = vi.fn();
    await render({ onOpenTerminal, onFileMoved, onFileDeleted });
    expect(mocks.files).toHaveBeenLastCalledWith(
      expect.objectContaining({ onOpenTerminal, onFileMoved, onFileDeleted }),
    );
    let releaseChanges!: () => void;
    mocks.changesReady = new Promise<void>((resolve) => {
      releaseChanges = resolve;
    });
    await render({
      tab: "changes",
      textHarness: "codex",
      selectedDiffPath: "/project-worktree/file.ts",
      selectedDiffKind: "staged",
      selectedCommitSha: "abc",
    });
    expect(mocks.unmountFiles).toHaveBeenCalledOnce();
    expect(mocks.unsubscribeStatuses).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Loading changes");
    expect(mocks.changes).not.toHaveBeenCalled();
    await act(async () => releaseChanges());
    expect(mocks.changes).toHaveBeenLastCalledWith({
      cwd: "/project-worktree",
      enabled: true,
      textHarness: "codex",
      selectedPath: "/project-worktree/file.ts",
      selectedKind: "staged",
      selectedSha: "abc",
      onOpenFile: props.onOpenDiff,
      onOpenAllChanges: props.onOpenAllChanges,
      onOpenCommit: props.onOpenCommit,
    });
    await render({ tab: "files" });
    expect(mocks.unmountChanges).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-content="changes"]')).toBeNull();
    await render({ tab: "changes" });
    await render({ active: false });
    expect(mocks.unmountChanges).toHaveBeenCalledTimes(1);
    expect(mocks.changes).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    expect(container.querySelector("section")?.hasAttribute("inert")).toBe(
      true,
    );
  });

  it("keeps the warmed tree and scroll position across hover peeks without hidden subscriptions", async () => {
    await render();
    const tree = container.querySelector<HTMLElement>(
      '[data-content="files"]',
    )!;
    tree.scrollTop = 120;
    for (let peek = 0; peek < 3; peek++) {
      await render({ active: false });
      expect(mocks.files).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: false }),
      );
      expect(container.querySelector('[data-content="files"]')).toBe(tree);
      expect(tree.scrollTop).toBe(120);
      await render({ active: true });
      expect(mocks.files).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true }),
      );
    }
    expect(mocks.mountFiles).toHaveBeenCalledOnce();
    expect(mocks.unmountFiles).not.toHaveBeenCalled();
    expect(mocks.unsubscribeStatuses).toHaveBeenCalledTimes(3);
  });

  it("defers hidden project and tab changes until the next reveal", async () => {
    await render();
    await render({ active: false, gitCwd: "/other", tab: "changes" });
    expect(mocks.loadChanges).not.toHaveBeenCalled();
    expect(mocks.files).toHaveBeenLastCalledWith(
      expect.objectContaining({ cwd: "/project-worktree", enabled: false }),
    );
    expect(mocks.unmountFiles).not.toHaveBeenCalled();
    await render({ active: true });
    expect(mocks.unmountFiles).toHaveBeenCalledOnce();
    expect(mocks.changes).toHaveBeenLastCalledWith(
      expect.objectContaining({ cwd: "/other", enabled: true }),
    );
  });

  it("remounts content for a different worktree and supports keyboard tab switching and close", async () => {
    await render({ tab: "changes" });
    await render({ gitCwd: "/another-worktree" });
    expect(mocks.unmountChanges).toHaveBeenCalledOnce();
    expect(mocks.changes).toHaveBeenLastCalledWith(
      expect.objectContaining({ cwd: "/another-worktree" }),
    );
    const changes = container.querySelector<HTMLButtonElement>(
      '[data-inspector-tab="changes"]',
    )!;
    await act(async () =>
      changes.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      ),
    );
    expect(props.onTabChange).toHaveBeenCalledWith("files");
    expect(document.activeElement).toBe(
      container.querySelector('[data-inspector-tab="files"]'),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Hide inspector"]')!
        .click(),
    );
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("skips unchanged inspector content during unrelated parent updates", async () => {
    await render({ tab: "changes" });
    mocks.changes.mockClear();
    for (let tick = 0; tick < 20; tick++) await render();
    expect(mocks.changes).not.toHaveBeenCalled();
    await render({ selectedDiffPath: "/project-worktree/updated.ts" });
    expect(mocks.changes).toHaveBeenCalledOnce();
  });
});
