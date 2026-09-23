// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FilePane } from "./FilePane";

const mocks = vi.hoisted(() => ({
  pdf: vi.fn(),
  editor: vi.fn(),
  image: vi.fn(),
}));
vi.mock("./PdfViewer", () => ({
  default: (props: unknown) => {
    mocks.pdf(props);
    return null;
  },
}));
vi.mock("./FileEditor", () => ({
  FileEditor: (props: unknown) => {
    mocks.editor(props);
    return null;
  },
}));
vi.mock("./BinaryFileView", () => ({
  BinaryFileView: (props: unknown) => {
    mocks.image(props);
    return null;
  },
}));
vi.mock("../chrome/SurfaceTabs", () => ({ SurfaceTabs: () => null }));
vi.mock("./WorkingTreeDiff", () => ({ WorkingTreeDiff: () => null }));
vi.mock("./CommitDiff", () => ({ CommitDiff: () => null }));
vi.mock("./SessionChangesDiff", () => ({ SessionChangesDiff: () => null }));
vi.mock("./TerminalView", () => ({ TerminalView: () => null }));
vi.mock("./AgentMarkdown", () => ({ MarkdownPreview: () => null }));
vi.mock("./ReleaseNotesSurface", () => ({ ReleaseNotesSurface: () => null }));

it("opens a restored PDF directly in its viewer and leaves Markdown, SVG, and images in their existing surfaces", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const callbacks = {
    onFocus: vi.fn(),
    onSelectFile: vi.fn(),
    onCloseFile: vi.fn(),
    onDirtyChange: vi.fn(),
    onErrorCountChange: vi.fn(),
    onReorderFiles: vi.fn(),
    onOpenFile: vi.fn(),
    onUpdatePlan: vi.fn(),
    onBuildPlan: vi.fn(),
  };
  const open = async (path: string) =>
    act(async () =>
      root.render(
        createElement(FilePane, {
          ...callbacks,
          pane: {
            id: "restored-pane",
            activeFileId: "restored-file",
            files: [{ id: "restored-file", path, cwd: "/work" }],
          },
          focused: true,
          dirtyFileIds: new Set<string>(),
          fileErrorCounts: new Map<string, number>(),
          sessions: [],
        }),
      ),
    );
  try {
    await open("/work/HOLO-Slide-Finalized.PDF");
    expect(mocks.pdf).toHaveBeenCalledWith({
      path: "/work/HOLO-Slide-Finalized.PDF",
      active: true,
    });
    expect(mocks.editor).not.toHaveBeenCalled();
    expect(mocks.image).not.toHaveBeenCalled();
    await open("/work/notes.md");
    expect(mocks.editor).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "/work/notes.md" }),
    );
    await open("/work/logo.svg");
    expect(mocks.editor).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: "/work/logo.svg" }),
    );
    await open("/work/photo.png");
    expect(mocks.image).toHaveBeenLastCalledWith({
      path: "/work/photo.png",
      cwd: "/work",
    });
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("pauses a retained PDF when its workspace hides without remounting the file pane", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const noop = () => {};
  const props: ComponentProps<typeof FilePane> = {
    pane: {
      id: "pdf-pane",
      activeFileId: "pdf-file",
      files: [{ id: "pdf-file", path: "/work/guide.pdf", cwd: "/work" }],
    },
    focused: false,
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
  try {
    await act(async () =>
      root.render(createElement(FilePane, { ...props, presented: true })),
    );
    const element = container.firstElementChild;
    expect(mocks.pdf).toHaveBeenLastCalledWith({
      path: "/work/guide.pdf",
      active: true,
    });
    await act(async () =>
      root.render(createElement(FilePane, { ...props, presented: false })),
    );
    expect(container.firstElementChild).toBe(element);
    expect(mocks.pdf).toHaveBeenLastCalledWith({
      path: "/work/guide.pdf",
      active: false,
    });
    await act(async () =>
      root.render(createElement(FilePane, { ...props, presented: true })),
    );
    expect(container.firstElementChild).toBe(element);
    expect(mocks.pdf).toHaveBeenLastCalledWith({
      path: "/work/guide.pdf",
      active: true,
    });
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
