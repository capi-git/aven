// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBoardWorkspaceTab, newFileTab } from "../lib/layout";
import { FilePane } from "./FilePane";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("./WorkBoard", () => ({
  WorkBoard: ({ project, visible }: { project: string; visible: boolean }) =>
    createElement("div", {
      "data-board-stub": project,
      "data-visible": String(visible),
    }),
}));

describe("a board in a file pane", () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: ComponentProps<typeof FilePane>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const noop = () => {};
    props = {
      pane: newBoardWorkspaceTab("/work/site").editorPanes[0],
      focused: true,
      presented: true,
      dirtyFileIds: new Set(),
      fileErrorCounts: new Map(),
      sessions: [],
      onFocus: noop,
      onSelectFile: noop,
      onCloseFile: noop,
      onDirtyChange: noop,
      onErrorCountChange: noop,
      onReorderFiles: noop,
      onOpenFile: noop,
      onUpdatePlan: noop,
      onBuildPlan: noop,
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const board = () => container.querySelector<HTMLElement>("[data-board-stub]");

  it("shows the project's board with no strip of its own when alone in its tab", async () => {
    await act(async () => root.render(createElement(FilePane, props)));
    expect(board()?.dataset.boardStub).toBe("/work/site");
    expect(board()?.dataset.visible).toBe("true");
    expect(container.querySelector(".aven-surface-tabs")).toBeNull();
  });

  it("only says where it lives in a workspace window", async () => {
    await act(async () =>
      root.render(createElement(FilePane, { ...props, boards: false })),
    );
    expect(board()).toBeNull();
    expect(container.querySelector("[data-board-elsewhere]")?.textContent).toBe(
      "Boards stay in the main window.",
    );
  });

  it("keeps its strip beside other panes or files, and stops while hidden", async () => {
    await act(async () =>
      root.render(
        createElement(FilePane, { ...props, onPaneDragStart: () => {} }),
      ),
    );
    expect(
      container.querySelector(".aven-surface-tabs")?.textContent,
    ).toContain("Board");
    const notes = newFileTab("/work/site/notes.md", "/work/site");
    await act(async () =>
      root.render(
        createElement(FilePane, {
          ...props,
          presented: false,
          pane: { ...props.pane, files: [...props.pane.files, notes] },
        }),
      ),
    );
    expect(container.querySelector(".aven-surface-tabs")).not.toBeNull();
    expect(board()?.dataset.visible).toBe("false");
  });
});
