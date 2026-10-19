// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newBoardWorkspaceTab } from "../lib/layout";
import { FilePane } from "./FilePane";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
// The board's own code arrives only when the test lets it.
const code = vi.hoisted(() => {
  let arrive = () => {};
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  return { arrived, arrive: () => arrive() };
});
vi.mock("./WorkBoard", async () => {
  await code.arrived;
  const { createElement } = await import("react");
  return {
    WorkBoard: ({ project }: { project: string }) =>
      createElement("div", { "data-board-stub": project }),
  };
});

describe("a board opening in a file pane", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows its title and four columns at once, then the board in their place", async () => {
    const noop = () => {};
    const props: ComponentProps<typeof FilePane> = {
      pane: newBoardWorkspaceTab("/work/tip-calc").editorPanes[0],
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
    await act(async () => root.render(createElement(FilePane, props)));
    const frame = container.querySelector<HTMLElement>(
      "[data-work-board-frame]",
    );
    expect(frame?.dataset.workBoardFrame).toBe("/work/tip-calc");
    expect(frame?.querySelector("h1")?.textContent).toBe("tip-calc");
    expect(
      [...(frame?.querySelectorAll(".work-board-column-title") ?? [])].map(
        (title) => title.textContent,
      ),
    ).toEqual(["Ideas", "Building", "Review", "Shipped"]);
    expect(container.querySelector("[data-board-stub]")).toBeNull();

    await act(async () => {
      code.arrive();
      await code.arrived;
    });
    await act(async () => {});
    expect(container.querySelector("[data-board-stub]")).not.toBeNull();
    expect(container.querySelector("[data-work-board-frame]")).toBeNull();
  });
});
