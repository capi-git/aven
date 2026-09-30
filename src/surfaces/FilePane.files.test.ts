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
vi.mock("./BinaryFileView", () => ({ BinaryFileView: () => null }));
vi.mock("./WorkingTreeDiff", () => ({ WorkingTreeDiff: () => null }));
vi.mock("./CommitDiff", () => ({ CommitDiff: () => null }));
vi.mock("./SessionChangesDiff", () => ({ SessionChangesDiff: () => null }));
vi.mock("./TerminalView", () => ({ TerminalView: () => null }));
vi.mock("./AgentMarkdown", () => ({ MarkdownPreview: () => null }));
vi.mock("./ReleaseNotesSurface", () => ({ ReleaseNotesSurface: () => null }));

it("shows each open file while keeping inactive editor buffers mounted", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const noop = () => {};
  const a = { id: "a", path: "/repo/a.md", cwd: "/repo" };
  const b = { id: "b", path: "/repo/b.md", cwd: "/repo" };
  const c = { id: "c", path: "/repo/c.json", cwd: "/repo" };
  const props: ComponentProps<typeof FilePane> = {
    pane: { id: "pane", files: [a], activeFileId: a.id },
    focused: true,
    dirtyFileIds: new Set(),
    fileErrorCounts: new Map(),
    sessions: [],
    onFocus: noop,
    onSelectFile: noop,
    onCloseFile: noop,
    onReorderFiles: noop,
    onDirtyChange: noop,
    onErrorCountChange: noop,
    onOpenFile: noop,
    onUpdatePlan: noop,
    onBuildPlan: noop,
  };
  const editor = (path: string) =>
    host.querySelector<HTMLInputElement>(`[data-editor-path="${path}"]`)!;
  const labels = () =>
    Array.from(host.querySelectorAll('[role="tab"]')).map((tab) =>
      tab.textContent?.trim(),
    );
  try {
    await act(async () => root.render(createElement(FilePane, props)));
    const firstEditor = editor(a.path);
    firstEditor.value = "retained first draft";
    await act(async () =>
      root.render(
        createElement(FilePane, {
          ...props,
          pane: { ...props.pane, files: [a, b], activeFileId: b.id },
        }),
      ),
    );
    const secondEditor = editor(b.path);
    secondEditor.value = "retained second draft";
    expect(labels()).toEqual(["a.md", "b.md"]);
    expect(editor(a.path)).toBe(firstEditor);
    expect(firstEditor.closest('[aria-hidden="true"]')).not.toBeNull();

    const allFilesPane = {
      ...props.pane,
      files: [a, b, c],
      activeFileId: c.id,
    };
    await act(async () =>
      root.render(
        createElement(FilePane, {
          ...props,
          pane: allFilesPane,
          dirtyFileIds: new Set([a.id, b.id]),
        }),
      ),
    );
    expect(labels()).toEqual(["a.md", "b.md", "c.json"]);
    expect(
      host.querySelectorAll('[aria-label="Unsaved changes"]'),
    ).toHaveLength(2);
    expect(host.querySelector('[title="Keep this file open"]')).toBeNull();
    expect(editor(a.path)).toBe(firstEditor);
    expect(editor(b.path)).toBe(secondEditor);
    expect(secondEditor.closest('[aria-hidden="true"]')).not.toBeNull();

    await act(async () =>
      root.render(
        createElement(FilePane, {
          ...props,
          pane: { ...allFilesPane, activeFileId: a.id },
        }),
      ),
    );
    expect(labels()).toEqual(["a.md", "b.md", "c.json"]);
    expect(firstEditor.closest('[aria-hidden="false"]')).not.toBeNull();
    expect(firstEditor.value).toBe("retained first draft");
    expect(secondEditor.value).toBe("retained second draft");
    expect(host.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
