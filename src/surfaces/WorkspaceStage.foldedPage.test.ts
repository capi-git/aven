// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserBounds } from "../lib/browser";
import { resetBrowserHandoff } from "../lib/browserHandoff";
import {
  createBrowserPresentation,
  type BrowserPresentation,
  type BrowserPresentationState,
} from "../lib/browserPresentation";
import type { LayoutNode } from "../lib/layout";
import { WorkspaceStage, type WorkspaceStageProps } from "./WorkspaceStage";

const leaf = (id: string): LayoutNode => ({ type: "leaf", id });
const columns: LayoutNode = {
  type: "split",
  id: "columns",
  dir: "right",
  children: [leaf("chat"), leaf("page")],
  sizes: [0.5, 0.5],
};
const pointer = (type: string, x: number) =>
  new PointerEvent(type, {
    bubbles: true,
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: 300,
  });

/**
 * A page pane folded by dragging its divider: the stage draws its rail at
 * once, before the fold is committed and the page's tab stops being
 * visible. The live native page must go with it, not stay drawn where the
 * pane was.
 */
describe("a page pane folded to its rail by a divider drag", () => {
  let root: Root;
  let container: HTMLDivElement;
  let frames: Map<number, FrameRequestCallback>;
  let presentation: BrowserPresentation;
  const page = { visible: false, layouts: 0 };
  // The tab is still visible to the app until the fold is committed.
  const state: BrowserPresentationState = {
    visible: true,
    paused: false,
    nativeId: "native-page",
    holesSupported: false,
    url: "https://example.com/",
    navigation: 0,
    zoom: { factor: 1, menu: null },
  };
  const settle = async () => {
    for (let count = 0; count < 12; count += 1) await Promise.resolve();
  };
  const flushFrame = () => {
    const pending = [...frames.values()];
    frames.clear();
    act(() => pending.forEach((callback) => callback(0)));
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLElement.prototype, "setPointerCapture").mockImplementation(
      () => {},
    );
    vi.spyOn(HTMLElement.prototype, "releasePointerCapture").mockImplementation(
      () => {},
    );
    frames = new Map();
    let next = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(next, callback);
      return next++;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const surfaces: WorkspaceStageProps["surfaces"] = [
      { id: "chat", content: createElement("p", null, "chat") },
      { id: "page", content: createElement("div", { "data-page-host": "" }) },
    ];
    // As the app does: a divider let go commits the layout it drew.
    function Harness() {
      const [layout, setLayout] = useState(columns);
      return createElement(WorkspaceStage, {
        layout,
        focusedId: "chat",
        visible: true,
        surfaces,
        onFocus: () => {},
        onLayoutChange: setLayout,
        dragTarget: null,
        dragging: false,
      });
    }
    await act(async () => root.render(createElement(Harness)));
    vi.spyOn(
      container.querySelector<HTMLElement>("[data-workspace-stage]")!,
      "getBoundingClientRect",
    ).mockReturnValue(new DOMRect(100, 50, 1000, 600));
    // A retained surface stays measurable while hidden: the page's bounds
    // read as on screen whatever the stage does with its pane.
    const measured: BrowserBounds = {
      x: 600,
      y: 82,
      width: 500,
      height: 568,
      scale: 2,
    };
    presentation = createBrowserPresentation({
      surfaceId: "page",
      pageId: "native-page",
      element: container.querySelector<HTMLElement>("[data-page-host]")!,
      readState: () => state,
      adapter: {
        bounds: () => measured,
        layout: async (_id, _bounds, visible) => {
          page.layouts += 1;
          page.visible = visible;
        },
        snapshot: async () => "data:image/png;base64,",
        decode: async () => {},
        onFocusChanged: async () => () => {},
      },
      onSnapshot: () => {},
      onNotice: () => {},
    });
    await settle();
  });

  afterEach(async () => {
    presentation.dispose();
    act(() => root.unmount());
    container.remove();
    resetBrowserHandoff();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("hides the live page as soon as the pane folds, and nothing shows it again", async () => {
    expect(page.visible).toBe(true);
    const sash = container.querySelector<HTMLElement>('[role="separator"]')!;
    act(() => sash.dispatchEvent(pointer("pointerdown", 600)));
    // Past half the page's minimum from the right edge: it folds.
    act(() => window.dispatchEvent(pointer("pointermove", 1076)));
    flushFrame();
    await settle();
    expect(container.querySelector('[data-pane-rail="page"]')).not.toBeNull();
    expect(page.visible).toBe(false);
    // More frames of the drag, and the end of a glide, re-place pages.
    act(() => window.dispatchEvent(pointer("pointermove", 1080)));
    flushFrame();
    window.dispatchEvent(new Event("supermono:workspace-layout"));
    await settle();
    expect(page.visible).toBe(false);
    // Let go: the fold is committed, and the page stays hidden even before
    // its tab stops being visible.
    act(() => window.dispatchEvent(pointer("pointerup", 1080)));
    await settle();
    expect(container.querySelector('[data-pane-rail="page"]')).not.toBeNull();
    expect(page.visible).toBe(false);
  });
});
