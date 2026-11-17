// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutNode } from "../lib/layout";
import { WorkspaceStage, type WorkspaceStageProps } from "./WorkspaceStage";

type Split = Extract<LayoutNode, { type: "split" }>;
const leaf = (id: string): LayoutNode => ({ type: "leaf", id });
// A chat beside a page collapsed to its rail, in a 1000px stage at x 100:
// the rail is the last 28px, from 1072 to 1100 in the window.
const collapsed: LayoutNode = {
  type: "split",
  id: "columns",
  dir: "right",
  children: [leaf("chat"), { ...leaf("page"), rail: 0.4 }],
  sizes: [0.972, 0.028],
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
 * A collapsed pane's rail is the widest thing to take hold of where the pane
 * stood. Pressed and let go, it opens the pane at its last size; pressed and
 * pulled, it opens the pane under the pointer, as the divider beside it does.
 */
describe("a collapsed pane pulled open by its rail", () => {
  let root: Root;
  let container: HTMLDivElement;
  let frames: Map<number, FrameRequestCallback>;
  let layout: LayoutNode;
  const flushFrame = () => {
    const pending = [...frames.values()];
    frames.clear();
    act(() => pending.forEach((callback) => callback(0)));
  };
  const rail = () =>
    container.querySelector<HTMLButtonElement>('[data-pane-rail="page"]');
  const split = () => layout as Split;

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
      { id: "page", content: createElement("p", null, "page") },
    ];
    layout = collapsed;
    function Harness() {
      const [tree, setTree] = useState(collapsed);
      layout = tree;
      return createElement(WorkspaceStage, {
        layout: tree,
        focusedId: "chat",
        visible: true,
        surfaces,
        onFocus: () => {},
        onLayoutChange: setTree,
        dragTarget: null,
        dragging: false,
      });
    }
    await act(async () => root.render(createElement(Harness)));
    vi.spyOn(
      container.querySelector<HTMLElement>("[data-workspace-stage]")!,
      "getBoundingClientRect",
    ).mockReturnValue(new DOMRect(100, 50, 1000, 600));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("opens under the pointer, mid-drag and when let go", () => {
    act(() => rail()!.dispatchEvent(pointer("pointerdown", 1086)));
    // Past the few pixels that tell a pull from a click: the drag begins.
    act(() => window.dispatchEvent(pointer("pointermove", 1060)));
    act(() => window.dispatchEvent(pointer("pointermove", 786)));
    flushFrame();
    // The pane is drawn open while the mouse is still held.
    expect(rail()).toBeNull();
    expect(split().children[1].rail).toBe(0.4);
    act(() => window.dispatchEvent(pointer("pointerup", 786)));
    expect(split().children[1].rail).toBeUndefined();
    // 300px left of where the rail's edge stood: 672px and 328px.
    expect(split().sizes).toEqual([0.672, 0.328]);
  });

  it("opens at the pane's least width after a short pull", () => {
    act(() => rail()!.dispatchEvent(pointer("pointerdown", 1086)));
    act(() => window.dispatchEvent(pointer("pointermove", 1070)));
    act(() => window.dispatchEvent(pointer("pointerup", 1070)));
    expect(split().children[1].rail).toBeUndefined();
    expect(split().sizes).toEqual([0.8, 0.2]);
  });

  it("leaves the rail as it was for a pull too short to open it", () => {
    act(() => rail()!.dispatchEvent(pointer("pointerdown", 1086)));
    act(() => window.dispatchEvent(pointer("pointermove", 1080)));
    act(() => window.dispatchEvent(pointer("pointerup", 1080)));
    // The click that ends the press does not open the pane either.
    act(() => rail()!.click());
    expect(split()).toEqual(collapsed);
    // The next press that stays put is a click again.
    act(() => vi.runOnlyPendingTimers());
    act(() => rail()!.dispatchEvent(pointer("pointerdown", 1086)));
    act(() => window.dispatchEvent(pointer("pointerup", 1086)));
    act(() => rail()!.click());
    expect(split().children[1].rail).toBeUndefined();
  });

  it("is still a click when pressed and let go in place", () => {
    act(() => rail()!.dispatchEvent(pointer("pointerdown", 1086)));
    act(() => window.dispatchEvent(pointer("pointermove", 1087)));
    act(() => window.dispatchEvent(pointer("pointerup", 1087)));
    act(() => rail()!.click());
    expect(split().children[1].rail).toBeUndefined();
    // At the share it had before it was collapsed.
    expect(split().sizes[1]).toBeCloseTo(0.4);
  });

  it("does nothing when pulled toward the edge, where no pane can give room", () => {
    act(() => rail()!.dispatchEvent(pointer("pointerdown", 1076)));
    act(() => window.dispatchEvent(pointer("pointermove", 1096)));
    act(() => window.dispatchEvent(pointer("pointerup", 1096)));
    expect(split()).toEqual(collapsed);
  });
});
