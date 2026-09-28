// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FilePane } from "./FilePane";

vi.mock("./FileEditor", () => ({
  FileEditor: ({ path }: { path: string }) =>
    createElement("input", {
      "data-editor-path": path,
      defaultValue: "original",
    }),
}));
vi.mock("../chrome/ExplorerMenu", () => ({ ExplorerMenu: () => null }));
vi.mock("./BinaryFileView", () => ({ BinaryFileView: () => null }));
vi.mock("./WorkingTreeDiff", () => ({ WorkingTreeDiff: () => null }));
vi.mock("./CommitDiff", () => ({ CommitDiff: () => null }));
vi.mock("./SessionChangesDiff", () => ({ SessionChangesDiff: () => null }));
vi.mock("./TerminalView", () => ({ TerminalView: () => null }));
vi.mock("./AgentMarkdown", () => ({ MarkdownPreview: () => null }));
vi.mock("./ReleaseNotesSurface", () => ({ ReleaseNotesSurface: () => null }));

it("keeps preview editors mounted and preserves their buffer when another file becomes the preview", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const noop = () => {};
  const a = { id: "a", path: "/repo/a.md", cwd: "/repo" };
  const b = { id: "b", path: "/repo/b.md", cwd: "/repo" };
  const onKeepFile = vi.fn();
  const props: ComponentProps<typeof FilePane> = {
    pane: { id: "pane", files: [a, b], activeFileId: a.id },
    focused: true,
    dirtyFileIds: new Set(),
    fileErrorCounts: new Map(),
    sessions: [],
    onFocus: noop,
    onSelectFile: noop,
    onCloseFile: noop,
    onKeepFile,
    onReorderFiles: noop,
    onDirtyChange: noop,
    onErrorCountChange: noop,
    onOpenFile: noop,
    onUpdatePlan: noop,
    onBuildPlan: noop,
  };
  try {
    await act(async () => root.render(createElement(FilePane, props)));
    const firstEditor = host.querySelector<HTMLInputElement>(
      '[data-editor-path="/repo/a.md"]',
    )!;
    firstEditor.value = "retained draft";
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);
    await act(async () =>
      root.render(
        createElement(FilePane, {
          ...props,
          pane: { ...props.pane, activeFileId: b.id },
        }),
      ),
    );
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(host.querySelector('[role="tab"]')?.textContent).toContain("b.md");
    expect(host.querySelector('[data-editor-path="/repo/a.md"]')).toBe(
      firstEditor,
    );
    expect(firstEditor.value).toBe("retained draft");
    expect(firstEditor.closest('[aria-hidden="true"]')).not.toBeNull();
    await act(async () =>
      (
        host.querySelector('[title="Keep this file open"]') as HTMLButtonElement
      ).click(),
    );
    expect(onKeepFile).toHaveBeenCalledExactlyOnceWith("pane", "b");
    await act(async () => root.render(createElement(FilePane, props)));
    expect(firstEditor.closest('[aria-hidden="false"]')).not.toBeNull();
    expect(firstEditor.value).toBe("retained draft");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
