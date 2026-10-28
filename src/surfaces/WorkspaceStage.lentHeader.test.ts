// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPaneHeaders } from "../lib/paneHeader";
import { TitleBar } from "../chrome/TitleBar";
import { workspaceSurfaceDropAt } from "./WorkspaceStage";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setFocus: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/app", () => ({
  getName: vi.fn().mockResolvedValue("Aven"),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setTitle: vi.fn().mockResolvedValue(undefined),
    startDragging: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("../chrome/WindowControls", () => ({ WindowControls: () => null }));

function rect(x: number, y: number, width: number, height: number) {
  return {
    x,
    y,
    left: x,
    top: y,
    width,
    height,
    right: x + width,
    bottom: y + height,
    toJSON() {},
  } as DOMRect;
}

/**
 * A pane holding chat A and page B, B in front, with the window's strip
 * naming them: the title row is the stage's real one, lending its row to
 * B's toolbar or not.
 */
describe("a pane whose title row is lent to its tab's toolbar", () => {
  let stage: HTMLDivElement;
  let header: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    stage = document.createElement("div");
    stage.setAttribute("data-workspace-stage", "");
    header = document.createElement("div");
    header.dataset.workspaceHeader = "b";
    const surface = document.createElement("div");
    surface.dataset.workspaceSurface = "b";
    const body = document.createElement("div");
    body.setAttribute("data-workspace-body", "");
    surface.append(body);
    stage.append(header, surface);
    document.body.append(stage);
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue(
      rect(100, 50, 1000, 32),
    );
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue(
      rect(100, 82, 1000, 568),
    );
    root = createRoot(header);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    stage.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetPaneHeaders();
  });

  async function render(lend: boolean) {
    const props: ComponentProps<typeof TitleBar> = {
      variant: "title",
      paneLocal: true,
      stackOnStrip: true,
      frontOwnHeader: lend,
      frontNamed: true,
      tabs: [
        {
          id: "a",
          project: "demo",
          title: "Chat A",
          more: [],
          sessionCount: 1,
          harnesses: ["claude"],
          busyHarnesses: [],
          files: [],
        },
      ],
      browserTabs: [{ id: "b", title: "Page B" }],
      surfaceOrder: ["a", "b"],
      activeId: "b",
      cwd: "/projects/demo",
      onToggleSidebar: vi.fn(),
      onSelect: vi.fn(),
      onNew: vi.fn(),
      onClose: vi.fn(),
      onCloseMany: vi.fn(),
      onReorder: vi.fn(),
      onSelectBrowser: vi.fn(),
      onCloseBrowser: vi.fn(),
      onSurfaceDragEnd: vi.fn(),
    };
    await act(async () => root.render(createElement(TitleBar, props)));
  }

  for (const lend of [false, true])
    it(`docks drags the same way ${lend ? "with" : "without"} the toolbar in the row`, async () => {
      await render(lend);
      expect(
        header.querySelector<HTMLElement>("[data-pane-header-slot]") !== null,
      ).toBe(lend);
      // The front tab splits off to an edge, its sibling keeping the pane.
      expect(workspaceSurfaceDropAt(stage, 1098, 300, "b")).toEqual({
        id: "b",
        edge: "right",
      });
      // A tab of the same pane dropped on its middle or its row: no move,
      // so no outline that promises one.
      expect(workspaceSurfaceDropAt(stage, 600, 300, "a")).toBeNull();
      expect(workspaceSurfaceDropAt(stage, 600, 60, "a")).toBeNull();
    });
});
