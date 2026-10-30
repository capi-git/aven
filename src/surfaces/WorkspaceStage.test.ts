// @vitest-environment happy-dom
import { act, createElement, useEffect, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { layoutLeaves, type LayoutNode } from "../lib/layout";
import { HIDDEN_SURFACE_DEMOTE_MS } from "../lib/hiddenSurfaces";
import {
  BROWSER_HANDOFF_MAX_MS,
  beginBrowserHandoff,
  endBrowserHandoff,
  resetBrowserHandoff,
} from "../lib/browserHandoff";
import { notifyMemoryPressure } from "../lib/memoryPressure";
import { moveWorkspaceTab, resolveWorkspaceView } from "../lib/workspaceViews";
import {
  WorkspaceStage,
  workspaceSurfaceDropAt,
  type WorkspaceStageProps,
} from "./WorkspaceStage";

const leaf = (id: string): LayoutNode => ({ type: "leaf", id });
const columns = (sizes = [0.5, 0.5]): LayoutNode => ({
  type: "split",
  id: "columns",
  dir: "right",
  children: [leaf("chat"), leaf("browser")],
  sizes,
});
const rectangle = (x: number, y: number, width: number, height: number) =>
  new DOMRect(x, y, width, height);
const pointer = (type: string, x: number, y = 300, pointerId = 1) =>
  new PointerEvent(type, {
    bubbles: true,
    button: 0,
    pointerId,
    clientX: x,
    clientY: y,
  });

describe("workspace stage", () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: WorkspaceStageProps;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  const mounted = vi.fn();
  const unmounted = vi.fn();
  const rendered = vi.fn();

  function StatefulSurface({ id }: { id: string }) {
    rendered(id);
    useEffect(() => {
      mounted(id);
      return () => unmounted(id);
    }, [id]);
    return createElement("input", {
      "aria-label": id,
      defaultValue: `Unsaved ${id}`,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLElement.prototype, "setPointerCapture").mockImplementation(
      () => {},
    );
    vi.spyOn(HTMLElement.prototype, "releasePointerCapture").mockImplementation(
      () => {},
    );
    frames = new Map();
    nextFrame = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    props = {
      layout: leaf("chat"),
      focusedId: "chat",
      visible: true,
      surfaces: ["chat", "browser"].map((id) => ({
        id,
        content: createElement(StatefulSurface, { id }),
      })),
      onFocus: vi.fn(),
      onLayoutChange: vi.fn(),
      dragTarget: null,
      dragging: false,
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function render(patch: Partial<WorkspaceStageProps> = {}) {
    props = { ...props, ...patch };
    await act(async () => root.render(createElement(WorkspaceStage, props)));
  }
  const stage = () =>
    container.querySelector<HTMLElement>("[data-workspace-stage]")!;
  const surface = (id: string) =>
    container.querySelector<HTMLElement>(`[data-workspace-surface="${id}"]`)!;
  const input = (id: string) =>
    surface(id).querySelector<HTMLInputElement>("input")!;
  const body = (id: string) =>
    surface(id).querySelector<HTMLElement>("[data-workspace-body]")!;
  const header = (id: string) =>
    stage().querySelector<HTMLElement>(`[data-workspace-header="${id}"]`);
  const sash = (index = 0) =>
    container.querySelectorAll<HTMLElement>('[role="separator"]')[index];
  const flushFrame = () => {
    const pending = [...frames.values()];
    frames.clear();
    act(() => pending.forEach((callback) => callback(0)));
  };
  const bindStageBounds = () =>
    vi
      .spyOn(stage(), "getBoundingClientRect")
      .mockReturnValue(rectangle(100, 50, 1000, 600));

  it("preserves mounted content and unsaved state through splits, reordering and hiding", async () => {
    await render();
    const chat = input("chat");
    const browser = input("browser");
    const browserWrapper = surface("browser");
    chat.value = "Draft that must survive a split";
    browser.value = "A browser form value";
    expect(browserWrapper.hidden).toBe(true);
    expect(browserWrapper.hasAttribute("inert")).toBe(true);

    await render({ layout: columns() });
    expect(browserWrapper.hidden).toBe(false);
    expect(surface("chat").style.width).toBe("calc(50% - 0.5px)");
    expect(
      surface("chat").style.getPropertyValue("--workspace-background-left"),
    ).toBe("calc(0cqw - 0px)");
    expect(
      surface("browser").style.getPropertyValue("--workspace-background-left"),
    ).toBe("calc(-50cqw - 0.5px)");
    await render({
      layout: {
        type: "split",
        id: "reordered",
        dir: "down",
        children: [leaf("browser"), leaf("chat")],
        sizes: [0.3, 0.7],
      },
    });
    expect(surface("chat").style.top).toBe("calc(30% + 0.5px)");
    expect(
      surface("chat").style.getPropertyValue("--workspace-background-top"),
    ).toBe("calc(-30cqh - 0.5px - var(--workspace-background-header-offset))");
    expect(surface("browser")).toBe(browserWrapper);
    await render({ layout: leaf("browser") });
    expect(surface("chat").hidden).toBe(true);
    expect(
      surface("browser").style.getPropertyValue("--workspace-background-left"),
    ).toBe("calc(0cqw - 0px)");
    await render({ visible: false });
    expect(stage().hidden).toBe(true);
    await render({ visible: true, layout: columns() });

    expect(input("chat")).toBe(chat);
    expect(input("browser")).toBe(browser);
    expect(chat.value).toBe("Draft that must survive a split");
    expect(browser.value).toBe("A browser form value");
    expect(mounted.mock.calls).toEqual([["chat"], ["browser"]]);
    expect(unmounted).not.toHaveBeenCalled();
    expect(rendered).toHaveBeenCalledTimes(2);
  });

  describe("switching to a native browser page", () => {
    function IncomingPage({ id, active }: { id: string; active: boolean }) {
      useLayoutEffect(() => {
        if (active) beginBrowserHandoff(id);
      }, [id, active]);
      return null;
    }
    const surfacesFor = (active: string) =>
      ["chat", "browser"].map((id) => ({
        id,
        content:
          id === "browser"
            ? createElement(IncomingPage, { id, active: active === id })
            : createElement(StatefulSurface, { id }),
      }));

    beforeEach(() => resetBrowserHandoff());
    afterEach(() => resetBrowserHandoff());

    it("keeps the outgoing chat painted underneath until the page is shown", async () => {
      await render({ surfaces: surfacesFor("chat") });
      await render({
        layout: leaf("browser"),
        focusedId: "browser",
        surfaces: surfacesFor("browser"),
      });
      expect(surface("chat").hidden).toBe(false);
      expect(surface("chat").dataset.handoff).toBe("out");
      expect(surface("chat").hasAttribute("inert")).toBe(true);
      expect(stage().dataset.handoff).toBe("true");

      await act(async () => endBrowserHandoff("browser"));
      expect(surface("chat").hidden).toBe(true);
      expect(surface("chat").dataset.handoff).toBeUndefined();
      expect(stage().dataset.handoff).toBeUndefined();
    });

    it("releases the outgoing chat at the deadline if the page never shows", async () => {
      await render({ surfaces: surfacesFor("chat") });
      await render({
        layout: leaf("browser"),
        focusedId: "browser",
        surfaces: surfacesFor("browser"),
      });
      expect(surface("chat").hidden).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BROWSER_HANDOFF_MAX_MS);
      });
      expect(surface("chat").hidden).toBe(true);
    });

    it("hides the outgoing surface in the same commit when nothing is on its way in", async () => {
      await render({ layout: leaf("browser"), focusedId: "browser" });
      await render({ layout: leaf("chat"), focusedId: "chat" });
      expect(surface("browser").hidden).toBe(true);
      expect(surface("browser").dataset.handoff).toBeUndefined();
    });
  });

  it("keeps visited workspace geometry, drafts and scroll positions warm across profile and home switches", async () => {
    const workHeaders = ["chat", "browser"].map((id) => ({
      id,
      content: createElement("span", null, `${id} tabs`),
    }));
    const chatContent = createElement(
      "div",
      { "data-scroll": true, style: { overflow: "auto", height: "100%" } },
      createElement(StatefulSurface, { id: "chat" }),
    );
    const surfaces = [
      { id: "chat", content: chatContent },
      ...["browser", "personal", "unvisited"].map((id) => ({
        id,
        content: createElement(StatefulSurface, { id }),
      })),
    ];
    await render({
      layout: columns([0.4, 0.6]),
      headers: workHeaders,
      surfaces,
    });
    const chat = surface("chat");
    const browser = surface("browser");
    const draft = input("chat");
    const scroller = chat.querySelector<HTMLElement>("[data-scroll]")!;
    draft.value = "Keep this unfinished message";
    scroller.scrollTop = 387;
    scroller.scrollLeft = 23;
    const chatGeometry = chat.style.cssText;
    const browserGeometry = browser.style.cssText;

    await render({
      layout: leaf("personal"),
      focusedId: "personal",
      headers: [{ id: "personal", content: "Personal tabs" }],
    });
    expect(chat.hidden).toBe(true);
    expect(chat.getAttribute("aria-hidden")).toBe("true");
    expect(chat.hasAttribute("inert")).toBe(true);
    expect(chat.dataset.retained).toBe("true");
    expect(chat.dataset.hasHeader).toBe("true");
    expect(chat.style.cssText).toBe(chatGeometry);
    expect(browser.style.cssText).toBe(browserGeometry);
    expect(surface("personal").hidden).toBe(false);
    expect(surface("personal").style.width).toBe("100%");
    expect(surface("unvisited").dataset.retained).toBe("false");
    expect(surface("unvisited").style.width).toBe("");

    // Profile home/settings can hide the entire stage while changing its view.
    await render({ visible: false, layout: null, headers: [] });
    expect(stage().hidden).toBe(true);
    expect(stage().dataset.retained).toBe("true");
    expect(stage().hasAttribute("inert")).toBe(true);
    expect(chat.style.cssText).toBe(chatGeometry);
    expect(chat.dataset.hasHeader).toBe("true");
    expect(surface("personal").style.width).toBe("100%");

    await render({
      visible: true,
      layout: columns([0.4, 0.6]),
      focusedId: "chat",
      headers: workHeaders,
    });
    expect(surface("chat")).toBe(chat);
    expect(surface("browser")).toBe(browser);
    expect(input("chat")).toBe(draft);
    expect(draft.value).toBe("Keep this unfinished message");
    expect(chat.querySelector("[data-scroll]")).toBe(scroller);
    expect(scroller.scrollTop).toBe(387);
    expect(scroller.scrollLeft).toBe(23);
    expect(chat.hidden).toBe(false);
    expect(chat.hasAttribute("inert")).toBe(false);
    expect(mounted).toHaveBeenCalledTimes(4);
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("releases long-hidden surfaces without timers and restores their scroll offsets", async () => {
    vi.setSystemTime(1_000_000);
    const chatContent = createElement(
      "div",
      { "data-scroll": true, style: { overflow: "auto", height: "100%" } },
      createElement(StatefulSurface, { id: "chat" }),
    );
    const surfaces = [
      { id: "chat", content: chatContent },
      ...["browser", "personal"].map((id) => ({
        id,
        content: createElement(StatefulSurface, { id }),
      })),
    ];
    await render({ layout: leaf("chat"), focusedId: "chat", surfaces });
    const chat = surface("chat");
    const scroller = chat.querySelector<HTMLElement>("[data-scroll]")!;
    scroller.scrollTop = 387;
    await render({ layout: leaf("browser"), focusedId: "browser" });
    expect(chat.hidden).toBe(true);
    expect(chat.dataset.demoted).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);

    // Age alone changes nothing until the stage next looks at its hidden set.
    vi.setSystemTime(1_000_000 + HIDDEN_SURFACE_DEMOTE_MS);
    expect(chat.dataset.demoted).toBeUndefined();
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(chat.dataset.demoted).toBe("true");
    expect(surface("browser").dataset.demoted).toBeUndefined();
    expect(chat.querySelector("[data-scroll]")).toBe(scroller);

    scroller.scrollTop = 0; // display: none discards the offset
    await render({ layout: leaf("chat"), focusedId: "chat" });
    expect(chat.hidden).toBe(false);
    expect(chat.dataset.demoted).toBeUndefined();
    expect(scroller.scrollTop).toBe(387);
    expect(input("chat").value).toBe("Unsaved chat");
  });

  it("releases every hidden surface under memory pressure or when the app is hidden", async () => {
    await render({
      layout: leaf("chat"),
      focusedId: "chat",
      surfaces: ["chat", "browser", "personal"].map((id) => ({
        id,
        content: createElement(StatefulSurface, { id }),
      })),
    });
    await render({ layout: leaf("browser"), focusedId: "browser" });
    await render({ layout: leaf("personal"), focusedId: "personal" });
    expect(surface("chat").dataset.demoted).toBeUndefined();
    await act(async () => notifyMemoryPressure("warn"));
    expect(surface("chat").dataset.demoted).toBe("true");
    expect(surface("browser").dataset.demoted).toBe("true");
    expect(surface("personal").dataset.demoted).toBeUndefined();

    await render({ layout: leaf("chat"), focusedId: "chat" });
    expect(surface("chat").dataset.demoted).toBeUndefined();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(surface("personal").dataset.demoted).toBe("true");
    hidden.mockRestore();
  });

  it("discards warm geometry when a surface closes and keeps a reopened inactive surface cold", async () => {
    await render({
      headers: [{ id: "chat", content: "Chat tabs" }],
    });
    const original = input("chat");
    original.value = "A closed draft";
    const chatSurface = props.surfaces[0];
    const browserSurface = props.surfaces[1];
    await render({
      layout: leaf("browser"),
      focusedId: "browser",
      headers: [],
      surfaces: [browserSurface],
    });
    expect(unmounted).toHaveBeenCalledExactlyOnceWith("chat");
    await render({ surfaces: [chatSurface, browserSurface] });
    expect(input("chat")).not.toBe(original);
    expect(input("chat").value).toBe("Unsaved chat");
    expect(surface("chat").hidden).toBe(true);
    expect(surface("chat").dataset.retained).toBe("false");
    expect(surface("chat").dataset.hasHeader).toBe("false");
    expect(surface("chat").style.width).toBe("");
  });

  it("does not warm an unvisited layout while the whole workspace is hidden", async () => {
    await render({ visible: false, layout: leaf("browser") });
    expect(stage().dataset.retained).toBe("false");
    expect(surface("browser").dataset.retained).toBe("false");
    await render({ visible: false, layout: leaf("chat") });
    expect(stage().dataset.retained).toBe("false");
    expect(surface("browser").dataset.retained).toBe("false");
    expect(surface("browser").style.width).toBe("");
    await render({ visible: true, layout: leaf("chat") });
    await render({ visible: false, layout: leaf("browser") });
    expect(surface("chat").dataset.retained).toBe("true");
    expect(surface("chat").style.width).toBe("100%");
    expect(surface("browser").dataset.retained).toBe("false");
  });

  it("keeps the last visited split measurements when a hidden workspace has a different layout", async () => {
    await render({ layout: columns([0.4, 0.6]) });
    const chatGeometry = surface("chat").style.cssText;
    const browserGeometry = surface("browser").style.cssText;
    await render({ visible: false, layout: leaf("chat") });
    expect(surface("chat").style.cssText).toBe(chatGeometry);
    expect(surface("browser").style.cssText).toBe(browserGeometry);
    await render({ visible: true });
    expect(surface("chat").style.width).toBe("100%");
    expect(surface("browser").style.cssText).toBe(browserGeometry);
  });

  it("paints resize frames without rendering content and commits once on release", async () => {
    await render({ layout: columns() });
    const measure = bindStageBounds();
    act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
    expect(
      container.querySelector('[data-native-browser-occluded="true"]'),
    ).toBeNull();
    rendered.mockClear();
    act(() => window.dispatchEvent(pointer("pointermove", 700)));
    act(() => window.dispatchEvent(pointer("pointermove", 750)));
    expect(frames.size).toBe(1);
    expect(surface("chat").style.width).toBe("calc(50% - 0.5px)");
    expect(props.onLayoutChange).not.toHaveBeenCalled();
    flushFrame();
    expect(surface("chat").style.width).toBe("calc(65% - 0.5px)");
    expect(surface("browser").style.left).toBe("calc(65% + 0.5px)");
    expect(
      surface("browser").style.getPropertyValue("--workspace-background-left"),
    ).toBe("calc(-65cqw - 0.5px)");
    expect(sash().getAttribute("aria-valuenow")).toBe("65");
    expect(rendered).not.toHaveBeenCalled();
    expect(measure).toHaveBeenCalledOnce();
    act(() => window.dispatchEvent(pointer("pointerup", 750)));
    expect(props.onLayoutChange).toHaveBeenCalledExactlyOnceWith(
      columns([0.65, 0.35]),
    );
    act(() => window.dispatchEvent(pointer("pointerup", 750)));
    act(() => sash().dispatchEvent(new Event("lostpointercapture")));
    expect(props.onLayoutChange).toHaveBeenCalledOnce();
    expect(stage().hasAttribute("data-resizing")).toBe(false);
    expect(
      container.querySelector("[data-native-browser-occluded]"),
    ).toBeNull();
    expect(document.documentElement.classList.contains("is-reordering")).toBe(
      false,
    );
    expect(document.body.style.cursor).toBe("");
  });

  it("keeps vertical dragging current when animation frames are deferred", async () => {
    const rows = (sizes = [0.5, 0.5]): LayoutNode => ({
      type: "split",
      id: "rows",
      dir: "down",
      children: [leaf("chat"), leaf("browser")],
      sizes,
    });
    await render({ layout: rows() });
    bindStageBounds();
    const painted = vi.fn();
    stage().addEventListener("supermono:workspace-layout", painted);
    rendered.mockClear();
    // Grabbing off-center must not snap the divider to the pointer.
    act(() => sash().dispatchEvent(pointer("pointerdown", 600, 353)));
    act(() => window.dispatchEvent(pointer("pointermove", 600, 383)));
    act(() => window.dispatchEvent(pointer("pointermove", 600, 413)));
    act(() => vi.advanceTimersByTime(15));
    expect(surface("chat").style.height).toBe("calc(50% - 0.5px)");
    act(() => vi.advanceTimersByTime(1));
    expect(surface("chat").style.height).toBe("calc(60% - 0.5px)");
    expect(surface("browser").style.top).toBe("calc(60% + 0.5px)");
    expect(painted).toHaveBeenCalledOnce();
    expect(rendered).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    // Release can arrive before the final move or animation callback.
    act(() => window.dispatchEvent(pointer("pointermove", 600, 423)));
    act(() => window.dispatchEvent(pointer("pointerup", 600, 443)));
    expect(props.onLayoutChange).toHaveBeenCalledExactlyOnceWith(
      rows([0.65, 0.35]),
    );
    expect(surface("chat").style.height).toBe("calc(65% - 0.5px)");
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(100));
    expect(painted).toHaveBeenCalledTimes(2);
  });

  it("stops a divider at a pane's minimum, in the stage's own pixels", async () => {
    await render({
      layout: columns(),
      paneMinimum: (id) => (id === "chat" ? 240 : 200),
    });
    bindStageBounds();
    // 150px left of the middle would leave the chat 350px: allowed. 300px
    // would leave it 200px, under its 240: it stops there.
    act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
    act(() => window.dispatchEvent(pointer("pointerup", 300)));
    expect(props.onLayoutChange).toHaveBeenLastCalledWith(
      columns([0.24, 0.76]),
    );
    // The other way, the page keeps its 200px.
    act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
    act(() => window.dispatchEvent(pointer("pointerup", 950)));
    expect(props.onLayoutChange).toHaveBeenLastCalledWith(columns([0.8, 0.2]));
  });

  it.each([
    ["before", 124, "browser"],
    ["after", 1076, "chat"],
  ] as const)(
    "folds the %s pane to a rail past half its minimum, live, and commits it on release",
    async (side, x, surviving) => {
      const minimize = vi.fn();
      await render({ layout: columns(), onMinimizeSide: minimize });
      bindStageBounds();
      const folded = side === "before" ? "chat" : "browser";
      const draft = input(folded);
      draft.value = "Keep my unfinished prompt";
      act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
      act(() => window.dispatchEvent(pointer("pointermove", x)));
      flushFrame();
      // While the drag lasts, the pane is already its rail.
      const rail = container.querySelector<HTMLElement>(
        `[data-pane-rail="${folded}"]`,
      );
      expect(rail).not.toBeNull();
      expect(surface(folded).hidden).toBe(true);
      expect(surface(surviving).hidden).toBe(false);
      expect(rail!.style.width).toBe(
        side === "before" ? "calc(2.8% - 0.5px)" : "calc(2.8% - 0.5px)",
      );
      expect(props.onLayoutChange).not.toHaveBeenCalled();
      act(() => window.dispatchEvent(pointer("pointerup", x)));
      expect(minimize).not.toHaveBeenCalled();
      const committed = vi.mocked(props.onLayoutChange).mock.calls[0][0];
      expect(committed).toEqual({
        ...columns(side === "before" ? [0.028, 0.972] : [0.972, 0.028]),
        children:
          side === "before"
            ? [{ ...leaf("chat"), rail: 0.5 }, leaf("browser")]
            : [leaf("chat"), { ...leaf("browser"), rail: 0.5 }],
      });
      await render({ layout: committed });
      expect(input(folded)).toBe(draft);
      expect(draft.value).toBe("Keep my unfinished prompt");
      expect(unmounted).not.toHaveBeenCalled();
    },
  );

  it.each([125, 1075])(
    "keeps releases outside the edge threshold as ordinary resizing (%s)",
    async (x) => {
      const minimize = vi.fn();
      await render({ layout: columns(), onMinimizeSide: minimize });
      bindStageBounds();
      act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
      act(() => window.dispatchEvent(pointer("pointerup", x)));
      expect(minimize).not.toHaveBeenCalled();
      expect(props.onLayoutChange).toHaveBeenCalledOnce();
    },
  );

  it("opens a pane dragged back out of its rail, at its minimum or more", async () => {
    await render({ layout: columns() });
    bindStageBounds();
    act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
    act(() => window.dispatchEvent(pointer("pointermove", 120)));
    flushFrame();
    expect(container.querySelector("[data-pane-rail]")).not.toBeNull();
    // Back past half the minimum: open again, held at the minimum.
    act(() => window.dispatchEvent(pointer("pointermove", 230)));
    flushFrame();
    expect(container.querySelector("[data-pane-rail]")).toBeNull();
    expect(surface("chat").hidden).toBe(false);
    expect(surface("chat").style.width).toBe("calc(20% - 0.5px)");
    act(() => window.dispatchEvent(pointer("pointerup", 400)));
    expect(props.onLayoutChange).toHaveBeenCalledExactlyOnceWith(
      columns([0.3, 0.7]),
    );
  });

  it("measures travel in the stage's own pixels under CSS zoom", async () => {
    await render({ layout: columns() });
    stage().style.zoom = "2";
    bindStageBounds();
    // 1000 viewport pixels are 500 of the stage's; 200 of travel is 100,
    // leaving the left pane 150px, under its 200: it stops at 200.
    act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
    act(() => window.dispatchEvent(pointer("pointerup", 400)));
    expect(props.onLayoutChange).toHaveBeenCalledExactlyOnceWith(
      columns([0.4, 0.6]),
    );
  });

  it.each([
    ["before", 74, "chat"],
    ["after", 626, "browser"],
  ] as const)(
    "folds the %s pane of a column to a rail as wide as it",
    async (side, y, folded) => {
      const rows = (sizes = [0.5, 0.5]): LayoutNode => ({
        type: "split",
        id: "rows",
        dir: "down",
        children: [leaf("chat"), leaf("browser")],
        sizes,
      });
      await render({ layout: rows() });
      bindStageBounds();
      act(() => sash().dispatchEvent(pointer("pointerdown", 600, 350)));
      act(() => window.dispatchEvent(pointer("pointerup", 600, y)));
      const committed = vi.mocked(props.onLayoutChange).mock.calls[0][0];
      expect(committed).toEqual({
        ...rows(
          side === "before" ? [28 / 600, 572 / 600] : [572 / 600, 28 / 600],
        ),
        children: [
          folded === "chat" ? { ...leaf("chat"), rail: 0.5 } : leaf("chat"),
          folded === "browser"
            ? { ...leaf("browser"), rail: 0.5 }
            : leaf("browser"),
        ],
      });
      await render({ layout: committed });
      const rail = container.querySelector<HTMLElement>(
        `[data-pane-rail="${folded}"]`,
      )!;
      expect(rail.dataset.axis).toBe("y");
      expect(rail.style.width).toBe("100%");
    },
  );

  it.each(["Escape", "pointercancel", "blur", "lostpointercapture"])(
    "leaves no drafted rail behind a drag ended by %s",
    async (ending) => {
      const minimize = vi.fn();
      await render({ layout: columns(), onMinimizeSide: minimize });
      bindStageBounds();
      act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
      act(() => window.dispatchEvent(pointer("pointermove", 110)));
      flushFrame();
      expect(container.querySelector("[data-pane-rail]")).not.toBeNull();
      act(() => {
        if (ending === "Escape")
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        else if (ending === "pointercancel")
          window.dispatchEvent(pointer("pointercancel", 110));
        else
          (ending === "blur" ? window : sash()).dispatchEvent(
            new Event(ending),
          );
      });
      act(() => window.dispatchEvent(pointer("pointerup", 110)));
      expect(minimize).not.toHaveBeenCalled();
      // A cancel puts the panes back; leaving the window keeps the fold,
      // which arrives as the new layout.
      expect(vi.mocked(props.onLayoutChange).mock.calls.length).toBe(
        ending === "Escape" || ending === "pointercancel" ? 0 : 1,
      );
      expect(container.querySelector("[data-pane-rail]")).toBeNull();
      expect(surface("chat").hidden).toBe(false);
      expect(surface("chat").style.width).toBe("calc(50% - 0.5px)");
      expect(stage().hasAttribute("data-resizing")).toBe(false);
      expect(document.body.style.cursor).toBe("");
      expect(frames.size).toBe(0);
    },
  );

  it.each([
    ["left", "before", "chat", "browser"],
    ["right", "after", "browser", "chat"],
  ] as const)(
    "reserves header room and preserves keyboard focus for %s hide and restore controls",
    async (edge, side, hidden, surviving) => {
      const minimize = vi.fn();
      const restore = vi.fn();
      await render({
        layout: columns(),
        onMinimizeSide: minimize,
        headers: [
          { id: "chat", content: createElement("button", null, "Chat tab") },
          {
            id: "browser",
            content: createElement("button", null, "Browser tab"),
          },
        ],
      });
      const hide = container.querySelector<HTMLButtonElement>(
        `button[aria-label="Collapse ${edge} pane"]`,
      )!;
      expect(hide.type).toBe("button");
      expect(hide.closest("[data-workspace-header]")).toBe(header(hidden));
      expect(header("chat")!.style.paddingRight).toBe("28px");
      expect(header("browser")!.style.paddingLeft).toBe("28px");
      expect(header("chat")!.style.height).toBe("32px");
      act(() => {
        hide.focus();
        hide.dispatchEvent(pointer("pointerdown", 590));
        hide.dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail: 0 }),
        );
      });
      expect(stage().hasAttribute("data-resizing")).toBe(false);
      expect(minimize).toHaveBeenCalledExactlyOnceWith("columns", 0, side);
      expect(props.onLayoutChange).not.toHaveBeenCalled();
      await render({
        layout: leaf(surviving),
        onRestoreSplit: restore,
        restoreEdge: edge,
        restoreStatus: "working",
      });
      const show = container.querySelector<HTMLButtonElement>(
        ".workspace-pane-restore",
      )!;
      expect(show.getAttribute("aria-label")).toBe(
        "Show hidden pane (agent working)",
      );
      expect(show.closest("[data-workspace-header]")).toBe(header(surviving));
      expect(
        header(surviving)!.style[
          edge === "left" ? "paddingLeft" : "paddingRight"
        ],
      ).toBe("28px");
      expect(document.activeElement).toBe(show);
      expect(props.onFocus).not.toHaveBeenCalled();
      act(() =>
        show.dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail: 0 }),
        ),
      );
      expect(restore).toHaveBeenCalledOnce();
      await render({
        layout: columns(),
        onRestoreSplit: undefined,
        restoreStatus: undefined,
      });
      expect(document.activeElement).toBe(sash());
      expect(header("browser")!.style.paddingLeft).toBe("28px");
    },
  );

  it.each([
    ["upper", "before", "chat"],
    ["lower", "after", "browser"],
  ] as const)(
    "provides a keyboard-operable control for the %s pane",
    async (position, side, id) => {
      const minimize = vi.fn();
      await render({
        layout: {
          type: "split",
          id: "rows",
          dir: "down",
          children: [leaf("chat"), leaf("browser")],
          sizes: [0.4, 0.6],
        },
        onMinimizeSide: minimize,
      });
      const hide = container.querySelector<HTMLButtonElement>(
        `button[aria-label="Collapse ${position} pane"]`,
      )!;
      expect(hide.type).toBe("button");
      expect(hide.closest("[data-workspace-header]")).toBe(header(id));
      expect(header(id)!.style.height).toBe("32px");
      act(() => {
        hide.focus();
        hide.dispatchEvent(
          new MouseEvent("click", { bubbles: true, detail: 0 }),
        );
      });
      expect(minimize).toHaveBeenCalledExactlyOnceWith("rows", 0, side);
      expect(props.onLayoutChange).not.toHaveBeenCalled();
      expect(props.onFocus).not.toHaveBeenCalled();
    },
  );

  it("reserves both header edges for adjacent hide controls alongside a restore control", async () => {
    const minimize = vi.fn();
    const restore = vi.fn();
    await render({
      layout: {
        type: "split",
        id: "three",
        dir: "right",
        children: [leaf("chat"), leaf("browser"), leaf("third")],
        sizes: [0.3, 0.3, 0.4],
      },
      surfaces: [...props.surfaces, { id: "third", content: "Third pane" }],
      onMinimizeSide: minimize,
      onRestoreSplit: restore,
      restoreEdge: "right",
    });
    const middle = header("browser")!;
    expect(middle.style.paddingLeft).toBe("28px");
    expect(middle.style.paddingRight).toBe("28px");
    expect(header("third")!.style.paddingLeft).toBe("28px");
    expect(header("third")!.style.paddingRight).toBe("28px");
    const hideBefore = middle.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse left pane"]',
    )!;
    const hideAfter = middle.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse right pane"]',
    )!;
    act(() => hideBefore.click());
    expect(minimize).toHaveBeenLastCalledWith("three", 1, "before");
    act(() => hideAfter.click());
    expect(minimize).toHaveBeenLastCalledWith("three", 0, "after");
    act(() =>
      header("third")!
        .querySelector<HTMLButtonElement>(".workspace-pane-restore")!
        .click(),
    );
    expect(restore).toHaveBeenCalledOnce();
    expect(props.onFocus).not.toHaveBeenCalled();
  });

  it("separates restore and hide controls when they share the same header edge", async () => {
    const minimize = vi.fn();
    const restore = vi.fn();
    await render({
      layout: {
        type: "split",
        id: "rows",
        dir: "down",
        children: [leaf("chat"), leaf("browser")],
        sizes: [0.4, 0.6],
      },
      onMinimizeSide: minimize,
      onRestoreSplit: restore,
      restoreEdge: "right",
    });
    const topHeader = header("chat")!;
    expect(topHeader.style.paddingRight).toBe("54px");
    const hide = topHeader.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse upper pane"]',
    )!;
    expect(hide.parentElement!.style.right).toBe("28px");
    act(() => hide.click());
    expect(minimize).toHaveBeenCalledExactlyOnceWith("rows", 0, "before");
    act(() =>
      topHeader
        .querySelector<HTMLButtonElement>(".workspace-pane-restore")!
        .click(),
    );
    expect(restore).toHaveBeenCalledOnce();
    expect(props.onFocus).not.toHaveBeenCalled();
  });

  it("cancels the fallback when an animation frame paints first", async () => {
    await render({ layout: columns() });
    bindStageBounds();
    const painted = vi.fn();
    stage().addEventListener("supermono:workspace-layout", painted);
    act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
    act(() => window.dispatchEvent(pointer("pointermove", 700)));
    flushFrame();
    expect(surface("chat").style.width).toBe("calc(60% - 0.5px)");
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(100));
    expect(painted).toHaveBeenCalledOnce();
  });

  it("does not rewrite unchanged pane geometry while dragging", async () => {
    await render({ layout: columns() });
    bindStageBounds();
    const chatStyle = vi.spyOn(surface("chat").style, "setProperty");
    const browserStyle = vi.spyOn(surface("browser").style, "setProperty");
    act(() => sash().dispatchEvent(pointer("pointerdown", 603)));
    act(() => window.dispatchEvent(pointer("pointermove", 603)));
    flushFrame();
    expect(chatStyle).not.toHaveBeenCalled();
    expect(browserStyle).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(pointer("pointerup", 603)));
    expect(props.onLayoutChange).not.toHaveBeenCalled();
  });

  it("keeps bodies mounted while pane-local headers appear, move and disappear", async () => {
    await render({ layout: columns() });
    const chat = input("chat");
    const browser = input("browser");
    const retainedBody = body("browser");
    browser.value = "Unsaved page field";
    await render({
      headers: [
        { id: "chat", content: createElement("button", null, "Session tabs") },
        {
          id: "browser",
          content: createElement("button", null, "Browser tabs"),
        },
      ],
    });
    expect(header("browser")?.parentElement).toBe(stage());
    expect(surface("browser").dataset.hasHeader).toBe("true");
    expect(surface("browser").children[0]).toBe(retainedBody);
    await render({ layout: leaf("browser"), focusedId: "browser" });
    expect(header("chat")).toBeNull();
    expect(surface("browser").dataset.focused).toBe("true");
    await render({ headers: [] });
    expect(body("browser")).toBe(retainedBody);
    expect(input("browser")).toBe(browser);
    expect(browser.value).toBe("Unsaved page field");
    expect(input("chat")).toBe(chat);
    expect(unmounted).not.toHaveBeenCalled();
    expect(mounted).toHaveBeenCalledTimes(2);
  });

  it("retains a group's header DOM and scroll when its selected leaf changes", async () => {
    const headerContent = (active: string) =>
      createElement(
        "div",
        { "data-tab-strip": true },
        createElement(
          "button",
          { "data-surface-tab-id": "chat" },
          `Chat ${active === "chat" ? "active" : ""}`,
        ),
        createElement(
          "button",
          { "data-surface-tab-id": "browser" },
          `Browser ${active === "browser" ? "active" : ""}`,
        ),
      );
    await render({
      layout: leaf("chat"),
      headers: [
        { id: "chat", key: "browser,chat", content: headerContent("chat") },
      ],
    });
    const groupHeader = header("chat")!;
    const strip = groupHeader.querySelector<HTMLElement>("[data-tab-strip]")!;
    strip.scrollLeft = 127;
    const chatBody = body("chat");
    const browserBody = body("browser");
    await render({
      layout: leaf("browser"),
      focusedId: "browser",
      headers: [
        {
          id: "browser",
          key: "browser,chat",
          content: headerContent("browser"),
        },
      ],
    });
    expect(header("chat")).toBeNull();
    expect(header("browser")).toBe(groupHeader);
    expect(groupHeader.querySelector("[data-tab-strip]")).toBe(strip);
    expect(strip.scrollLeft).toBe(127);
    expect(strip.textContent).toContain("Browser active");
    expect(body("chat")).toBe(chatBody);
    expect(body("browser")).toBe(browserBody);
    await render({ visible: false });
    await render({ visible: true });
    expect(header("browser")).toBe(groupHeader);
    expect(strip.scrollLeft).toBe(127);
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("notifies native geometry after equal-size pane moves and coalesced resize paint", async () => {
    await render({ layout: columns() });
    const moved = vi.fn();
    window.addEventListener("supermono:workspace-layout", moved);
    try {
      await render({
        layout: {
          type: "split",
          id: "columns",
          dir: "right",
          children: [leaf("browser"), leaf("chat")],
          sizes: [0.5, 0.5],
        },
      });
      expect(moved).toHaveBeenCalledOnce();
      expect(surface("browser").style.left).toBe("0%");
      await render({ focusedId: "browser" });
      expect(moved).toHaveBeenCalledOnce();
      await render({
        headers: [
          { id: "browser", content: createElement("span", null, "Tabs") },
        ],
      });
      expect(moved).toHaveBeenCalledTimes(2);
      moved.mockClear();
      bindStageBounds();
      act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
      act(() => window.dispatchEvent(pointer("pointermove", 700)));
      act(() => window.dispatchEvent(pointer("pointermove", 800)));
      expect(moved).not.toHaveBeenCalled();
      flushFrame();
      expect(moved).toHaveBeenCalledOnce();
      expect(surface("browser").style.width).toBe("calc(70% - 0.5px)");
      act(() => window.dispatchEvent(pointer("pointerup", 800)));
      expect(moved).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("supermono:workspace-layout", moved);
    }
  });

  it("lays panes flush with the workspace edges, one pixel apart for the divider", async () => {
    await render();
    expect(surface("chat").style.left).toBe("0%");
    expect(surface("chat").style.width).toBe("100%");
    expect(surface("chat").style.height).toBe("100%");
    await render({
      layout: {
        type: "split",
        id: "three",
        dir: "right",
        children: [leaf("chat"), leaf("browser"), leaf("third")],
        sizes: [0.2, 0.3, 0.5],
      },
      surfaces: [
        ...props.surfaces,
        { id: "third", content: createElement("p", null, "Third surface") },
      ],
    });
    expect(surface("chat").style.left).toBe("0%");
    expect(surface("chat").style.width).toBe("calc(20% - 0.5px)");
    expect(surface("browser").style.left).toBe("calc(20% + 0.5px)");
    expect(surface("browser").style.width).toBe("calc(30% - 1px)");
    expect(surface("third").style.left).toBe("calc(50% + 0.5px)");
    expect(surface("third").style.width).toBe("calc(50% - 0.5px)");
    expect(surface("browser").style.top).toBe("0%");
    expect(surface("browser").style.height).toBe("100%");

    await render({
      layout: {
        type: "split",
        id: "rows",
        dir: "down",
        children: [leaf("chat"), leaf("browser")],
        sizes: [0.5, 0.5],
      },
    });
    expect(surface("chat").style.top).toBe("0%");
    expect(surface("chat").style.height).toBe("calc(50% - 0.5px)");
    expect(surface("browser").style.top).toBe("calc(50% + 0.5px)");
    expect(surface("browser").style.height).toBe("calc(50% - 0.5px)");
    expect(surface("chat").style.width).toBe("100%");
    expect(surface("browser").style.width).toBe("100%");
  });

  it("cancels a draft with Escape and ignores unrelated pointer events", async () => {
    await render({ layout: columns() });
    bindStageBounds();
    act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
    act(() => window.dispatchEvent(pointer("pointermove", 1000, 300, 2)));
    expect(frames.size).toBe(0);
    act(() => window.dispatchEvent(pointer("pointermove", 900)));
    flushFrame();
    expect(surface("chat").style.width).toBe("calc(80% - 0.5px)");
    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(surface("chat").style.width).toBe("calc(50% - 0.5px)");
    expect(props.onLayoutChange).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(pointer("pointerup", 900)));
    expect(props.onLayoutChange).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("");
    expect(
      container.querySelector("[data-native-browser-occluded]"),
    ).toBeNull();
  });

  it.each(["blur", "lostpointercapture"])(
    "finishes and cleans up a resize after %s",
    async (event) => {
      await render({ layout: columns() });
      bindStageBounds();
      act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
      act(() => window.dispatchEvent(pointer("pointermove", 800)));
      act(() =>
        (event === "blur" ? window : sash()).dispatchEvent(new Event(event)),
      );
      expect(frames.size).toBe(0);
      expect(props.onLayoutChange).toHaveBeenCalledOnce();
      expect(surface("chat").style.width).toBe("calc(70% - 0.5px)");
      expect(document.body.style.cursor).toBe("");
      expect(stage().hasAttribute("data-resizing")).toBe(false);
      expect(
        container.querySelector("[data-native-browser-occluded]"),
      ).toBeNull();
      act(() => window.dispatchEvent(pointer("pointermove", 900)));
      expect(frames.size).toBe(0);
    },
  );

  it("cancels an in-progress resize when the workspace becomes hidden", async () => {
    await render({ layout: columns() });
    bindStageBounds();
    act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
    act(() => window.dispatchEvent(pointer("pointermove", 800)));
    await render({ visible: false });
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(100));
    expect(surface("chat").style.width).toBe("calc(50% - 0.5px)");
    expect(props.onLayoutChange).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains("is-reordering")).toBe(
      false,
    );
    expect(document.body.style.cursor).toBe("");
  });

  it("restores inactive panes after cancelling a painted resize during a workspace switch", async () => {
    await render({
      layout: columns(),
      surfaces: [
        ...props.surfaces,
        {
          id: "personal",
          content: createElement(StatefulSurface, { id: "personal" }),
        },
      ],
    });
    bindStageBounds();
    const chat = input("chat");
    chat.value = "Unfinished work";
    const chatGeometry = surface("chat").style.cssText;
    const browserGeometry = surface("browser").style.cssText;
    act(() => sash().dispatchEvent(pointer("pointerdown", 600)));
    act(() => window.dispatchEvent(pointer("pointermove", 750)));
    flushFrame();
    expect(surface("chat").style.width).toBe("calc(65% - 0.5px)");
    expect(surface("browser").style.left).toBe("calc(65% + 0.5px)");
    act(() => window.dispatchEvent(pointer("pointermove", 800)));

    await render({ layout: leaf("personal"), focusedId: "personal" });
    expect(surface("chat").hidden).toBe(true);
    expect(surface("chat").style.cssText).toBe(chatGeometry);
    expect(surface("browser").style.cssText).toBe(browserGeometry);
    expect(surface("personal").style.width).toBe("100%");
    expect(input("chat")).toBe(chat);
    expect(chat.value).toBe("Unfinished work");
    expect(unmounted).not.toHaveBeenCalled();
    expect(props.onLayoutChange).not.toHaveBeenCalled();
    expect(stage().hasAttribute("data-resizing")).toBe(false);
    expect(document.body.style.cursor).toBe("");
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => window.dispatchEvent(pointer("pointerup", 800)));
    expect(props.onLayoutChange).not.toHaveBeenCalled();
  });

  it("resizes from the keyboard down to the minimums, folds with Home and End, and evens on double-click", async () => {
    const three = (
      sizes = [0.3, 0.3, 0.4],
      children: LayoutNode[] = [leaf("chat"), leaf("browser"), leaf("third")],
    ): LayoutNode => ({
      type: "split",
      id: "three",
      dir: "right",
      children,
      sizes,
    });
    await render({ layout: three() });
    bindStageBounds();
    const change = vi.mocked(props.onLayoutChange);
    const key = (index: number, key: string, shiftKey = false) =>
      act(() =>
        sash(index).dispatchEvent(
          new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }),
        ),
      );
    // 1000px: 300 | 300 | 400. A step is 20px.
    key(1, "ArrowRight");
    let widths = layoutLeaves(change.mock.lastCall![0]).map(
      ({ rect }) => rect.w,
    );
    expect(widths[0]).toBeCloseTo(0.3);
    expect(widths[1]).toBeCloseTo(0.32);
    expect(widths[2]).toBeCloseTo(0.38);
    // Five steps at once stop at the third pane's 200px minimum.
    await render({ layout: three([0.3, 0.45, 0.25]) });
    key(1, "ArrowRight", true);
    widths = layoutLeaves(change.mock.lastCall![0]).map(({ rect }) => rect.w);
    expect(widths[1]).toBeCloseTo(0.5);
    expect(widths[2]).toBeCloseTo(0.2);
    // Pressing on against the minimum folds that pane to a rail.
    await render({ layout: three([0.3, 0.5, 0.2]) });
    key(1, "ArrowRight");
    const folded = change.mock.lastCall![0] as Extract<
      LayoutNode,
      { type: "split" }
    >;
    expect(folded.children[2].rail).toBeCloseTo(0.2);
    expect(folded.sizes[2]).toBeCloseTo(0.028);
    // Home folds the pane before a divider; End the one after.
    await render({ layout: three() });
    key(0, "Home");
    expect(
      (change.mock.lastCall![0] as Extract<LayoutNode, { type: "split" }>)
        .children[0].rail,
    ).toBeCloseTo(0.3);
    // A double-click evens every pane of the split, a folded one opened.
    await render({
      layout: three(
        [0.028, 0.572, 0.4],
        [{ ...leaf("chat"), rail: 0.3 }, leaf("browser"), leaf("third")],
      ),
    });
    change.mockClear();
    act(() =>
      sash(1).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    const even = change.mock.lastCall![0] as Extract<
      LayoutNode,
      { type: "split" }
    >;
    expect(even.children.every((child) => child.rail === undefined)).toBe(true);
    expect(even.sizes).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it("focuses surfaces and shows drop hints without occluding the browser", async () => {
    await render({ layout: columns() });
    expect(
      container.querySelector("[data-native-browser-occluded]"),
    ).toBeNull();
    act(() => input("browser").dispatchEvent(pointer("pointerdown", 900)));
    expect(props.onFocus).toHaveBeenCalledWith("browser");
    vi.mocked(props.onFocus).mockClear();
    act(() => input("browser").focus());
    expect(props.onFocus).toHaveBeenCalledWith("browser");
    await render({
      dragging: true,
      dragTarget: { id: "browser", edge: "down" },
    });
    expect(
      container.querySelector('[data-native-browser-occluded="true"]'),
    ).toBeNull();
    const hint = container.querySelector<HTMLElement>(
      ".workspace-stage-drop-hint",
    )!;
    expect(hint.parentElement).toBe(body("browser"));
    // That half of the body, inset 4px (Cydonia's preview).
    expect(hint.style.left).toBe("calc(0% + 4px)");
    expect(hint.style.top).toBe("calc(50% + 4px)");
    expect(hint.style.width).toBe("calc(100% - 8px)");
    expect(hint.style.height).toBe("calc(50% - 8px)");
    await render({ dragging: false });
    expect(
      container.querySelector("[data-native-browser-occluded]"),
    ).toBeNull();
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("finds drop edges only on visible sibling surfaces in client coordinates", async () => {
    await render({ layout: columns() });
    vi.spyOn(body("chat"), "getBoundingClientRect").mockReturnValue(
      rectangle(100, 50, 500, 600),
    );
    vi.spyOn(body("browser"), "getBoundingClientRect").mockReturnValue(
      rectangle(600, 50, 500, 600),
    );
    expect(workspaceSurfaceDropAt(stage(), 620, 300, "chat")).toEqual({
      id: "browser",
      edge: "left",
    });
    expect(workspaceSurfaceDropAt(stage(), 1080, 300, "chat")?.edge).toBe(
      "right",
    );
    expect(workspaceSurfaceDropAt(stage(), 850, 70, "chat")?.edge).toBe("up");
    expect(workspaceSurfaceDropAt(stage(), 850, 630, "chat")?.edge).toBe(
      "down",
    );
    expect(workspaceSurfaceDropAt(stage(), 300, 300, "chat")).toBeNull();
    expect(workspaceSurfaceDropAt(stage(), 1200, 300, "chat")).toBeNull();
    surface("browser").inert = true;
    expect(workspaceSurfaceDropAt(stage(), 850, 300, "chat")).toBeNull();
    surface("browser").inert = false;
    await render({ layout: leaf("chat") });
    expect(workspaceSurfaceDropAt(stage(), 850, 300, "chat")).toBeNull();
    await render({ visible: false, layout: columns() });
    expect(workspaceSurfaceDropAt(stage(), 850, 300, "chat")).toBeNull();
  });

  it("targets another pane's header by tab midpoints without consuming same-group reorders", async () => {
    await render({
      layout: columns(),
      headers: [
        {
          id: "browser",
          content: createElement(
            "div",
            null,
            createElement(
              "button",
              { "data-surface-tab-id": "browser" },
              "Page",
            ),
            createElement("button", { "data-surface-tab-id": "docs" }, "Docs"),
          ),
        },
      ],
    });
    const browserHeader = header("browser")!;
    vi.spyOn(browserHeader, "getBoundingClientRect").mockReturnValue(
      rectangle(600, 50, 500, 32),
    );
    const tabs = browserHeader.querySelectorAll<HTMLElement>(
      "[data-surface-tab-id]",
    );
    vi.spyOn(tabs[0], "getBoundingClientRect").mockReturnValue(
      rectangle(600, 50, 100, 32),
    );
    vi.spyOn(tabs[1], "getBoundingClientRect").mockReturnValue(
      rectangle(700, 50, 100, 32),
    );
    vi.spyOn(body("browser"), "getBoundingClientRect").mockReturnValue(
      rectangle(600, 82, 500, 568),
    );
    expect(workspaceSurfaceDropAt(stage(), 620, 60, "chat")).toEqual({
      id: "browser",
      edge: "tab",
      index: 0,
    });
    expect(workspaceSurfaceDropAt(stage(), 690, 60, "chat")).toEqual({
      id: "browser",
      edge: "tab",
      index: 1,
    });
    expect(workspaceSurfaceDropAt(stage(), 1050, 60, "chat")).toEqual({
      id: "browser",
      edge: "tab",
      index: 2,
    });
    expect(workspaceSurfaceDropAt(stage(), 620, 60, "docs")).toBeNull();
    expect(workspaceSurfaceDropAt(stage(), 850, 84, "chat")).toEqual({
      id: "browser",
      edge: "up",
    });
    await render({
      dragging: true,
      dragTarget: { id: "browser", edge: "tab", index: 1 },
    });
    expect(browserHeader.dataset.dropTarget).toBe("true");
    expect(container.querySelector(".workspace-stage-drop-hint")).toBeNull();
    await render({ dragging: false });
    expect(browserHeader.dataset.dropTarget).toBeUndefined();
  });

  it("takes a tab at the slot it is over in a title row of tabs, and into the pane over a lone title", async () => {
    const titleRow = (layout: "tabs" | "lone", ids: string[]) =>
      createElement(
        "header",
        { "data-variant": "title", "data-title-layout": layout },
        createElement(
          "div",
          { "data-surface-order": JSON.stringify(["browser", "docs", "more"]) },
          ...ids.map((id) =>
            createElement("div", { key: id, "data-surface-tab-id": id }, id),
          ),
        ),
      );
    await render({
      layout: columns(),
      headers: [
        { id: "browser", content: titleRow("tabs", ["browser", "docs"]) },
      ],
    });
    const place = () => {
      vi.spyOn(header("browser")!, "getBoundingClientRect").mockReturnValue(
        rectangle(600, 50, 500, 32),
      );
      const tabs = header("browser")!.querySelectorAll<HTMLElement>(
        "[data-surface-tab-id]",
      );
      tabs.forEach((tab, index) =>
        vi
          .spyOn(tab, "getBoundingClientRect")
          .mockReturnValue(rectangle(600 + index * 100, 50, 100, 32)),
      );
      vi.spyOn(body("browser"), "getBoundingClientRect").mockReturnValue(
        rectangle(600, 82, 500, 568),
      );
    };
    place();
    expect(workspaceSurfaceDropAt(stage(), 690, 60, "chat")).toEqual({
      id: "browser",
      edge: "tab",
      index: 1,
    });
    // Past the last tab shown, before the tabs folded into the +N.
    expect(workspaceSurfaceDropAt(stage(), 900, 60, "chat")).toEqual({
      id: "browser",
      edge: "tab",
      index: 2,
    });
    await render({
      headers: [{ id: "browser", content: titleRow("lone", ["browser"]) }],
    });
    place();
    expect(workspaceSurfaceDropAt(stage(), 690, 60, "chat")).toEqual({
      id: "browser",
      edge: "tab",
    });
  });

  it("maps visible drop slots around hidden Recent tabs without moving the indicator", async () => {
    const visible = ["browser", "preview", "kept"];
    const order = [
      "hidden-first",
      "browser",
      "hidden-middle",
      "preview",
      "kept",
      "hidden-last",
    ];
    await render({
      layout: leaf("browser"),
      focusedId: "browser",
      headers: [
        {
          id: "browser",
          content: createElement(
            "div",
            {
              "data-surface-order": JSON.stringify(order),
            },
            ...visible.map((id) =>
              createElement(
                "button",
                {
                  key: id,
                  "data-surface-tab-id": id,
                },
                id,
              ),
            ),
          ),
        },
      ],
    });
    const targetHeader = stage().querySelector<HTMLElement>(
      '[data-workspace-header="browser"]',
    )!;
    vi.spyOn(targetHeader, "getBoundingClientRect").mockReturnValue(
      rectangle(100, 5, 600, 32),
    );
    const tabs = [
      ...targetHeader.querySelectorAll<HTMLElement>("[data-surface-tab-id]"),
    ];
    tabs.forEach((tab, index) => {
      vi.spyOn(tab, "getBoundingClientRect").mockReturnValue(
        rectangle(100 + index * 100, 5, 100, 32),
      );
    });
    for (const [x, index, orderIndex] of [
      [110, 0, 1],
      [190, 1, 3],
      [290, 2, 4],
      [490, 3, 5],
    ]) {
      expect(workspaceSurfaceDropAt(stage(), x, 20, "chat")).toEqual({
        id: "browser",
        edge: "tab",
        index,
        orderIndex,
      });
    }

    const target = workspaceSurfaceDropAt(stage(), 190, 20, "chat")!;
    if (target.edge !== "tab") throw new Error("Expected header drop");
    const view = resolveWorkspaceView(
      {
        layout: columns(),
        focusedId: "chat",
        groups: { chat: ["chat"], browser: order },
        order: ["chat", ...order],
      },
      ["chat", ...order],
      "chat",
    );
    const moved = moveWorkspaceTab(
      view,
      "chat",
      target.id,
      target.orderIndex ?? target.index,
    );
    expect(moved.groups.browser).toEqual([
      "hidden-first",
      "browser",
      "hidden-middle",
      "chat",
      "preview",
      "kept",
      "hidden-last",
    ]);
    expect(
      moved.groups.browser.filter(
        (id) => id === "chat" || visible.includes(id),
      ),
    ).toEqual(["browser", "chat", "preview", "kept"]);

    await render({ dragging: true, dragTarget: target });
    expect(
      targetHeader.querySelector<HTMLElement>("[data-drop-insertion]")?.style
        .left,
    ).toBe("100px");
  });

  it("falls back to visible positions when retained-order metadata is malformed", async () => {
    await render({
      headers: [
        {
          id: "chat",
          content: createElement(
            "div",
            { "data-surface-order": "broken" },
            createElement("button", { "data-surface-tab-id": "chat" }, "Chat"),
            createElement(
              "button",
              { "data-surface-tab-id": "browser" },
              "Browser",
            ),
          ),
        },
      ],
    });
    const targetHeader = header("chat")!;
    vi.spyOn(targetHeader, "getBoundingClientRect").mockReturnValue(
      rectangle(100, 5, 600, 32),
    );
    const tabs = [
      ...targetHeader.querySelectorAll<HTMLElement>("[data-surface-tab-id]"),
    ];
    tabs.forEach((tab, index) => {
      vi.spyOn(tab, "getBoundingClientRect").mockReturnValue(
        rectangle(100 + index * 100, 5, 100, 32),
      );
    });
    const strip = targetHeader.querySelector<HTMLElement>(
      "[data-surface-order]",
    )!;
    for (const serialized of [
      "broken",
      "null",
      '["chat"]',
      '["chat","browser","browser"]',
      '["chat","browser"]',
    ]) {
      strip.dataset.surfaceOrder = serialized;
      expect(workspaceSurfaceDropAt(stage(), 190, 20, "another")).toEqual({
        id: "chat",
        edge: "tab",
        index: 1,
      });
    }
  });

  it("allows the selected tab to split from its own body only when its group has a sibling", async () => {
    const groupedHeader = (members: string[]) => [
      {
        id: "browser",
        content: createElement(
          "div",
          null,
          ...members.map((id) =>
            createElement("button", { key: id, "data-surface-tab-id": id }, id),
          ),
        ),
      },
    ];
    await render({
      layout: leaf("browser"),
      headers: groupedHeader(["browser", "docs"]),
    });
    vi.spyOn(header("browser")!, "getBoundingClientRect").mockReturnValue(
      rectangle(100, 50, 1000, 32),
    );
    vi.spyOn(body("browser"), "getBoundingClientRect").mockReturnValue(
      rectangle(100, 82, 1000, 568),
    );
    expect(workspaceSurfaceDropAt(stage(), 500, 60, "browser")).toBeNull();
    expect(workspaceSurfaceDropAt(stage(), 102, 300, "browser")).toEqual({
      id: "browser",
      edge: "left",
    });
    expect(workspaceSurfaceDropAt(stage(), 1098, 300, "browser")).toEqual({
      id: "browser",
      edge: "right",
    });
    expect(workspaceSurfaceDropAt(stage(), 500, 84, "browser")).toEqual({
      id: "browser",
      edge: "up",
    });
    expect(workspaceSurfaceDropAt(stage(), 500, 648, "browser")).toEqual({
      id: "browser",
      edge: "down",
    });
    await render({ headers: groupedHeader(["browser"]) });
    expect(workspaceSurfaceDropAt(stage(), 102, 300, "browser")).toBeNull();
    expect(workspaceSurfaceDropAt(stage(), 500, 60, "browser")).toBeNull();
  });
  it("joins in the body center, labels the outcome, and keeps the edge preview stable near its boundary", async () => {
    await render({ layout: columns() });
    vi.spyOn(body("browser"), "getBoundingClientRect").mockReturnValue(
      rectangle(600, 50, 500, 600),
    );
    const center = workspaceSurfaceDropAt(stage(), 850, 350, "chat");
    expect(center).toEqual({ id: "browser", edge: "tab" });
    const left = workspaceSurfaceDropAt(stage(), 705, 350, "chat");
    expect(left).toEqual({ id: "browser", edge: "left" });
    expect(workspaceSurfaceDropAt(stage(), 715, 350, "chat", left)).toEqual(
      left,
    );
    expect(workspaceSurfaceDropAt(stage(), 715, 350, "chat", center)).toEqual(
      center,
    );
    expect(workspaceSurfaceDropAt(stage(), 850, 350, "chat", left)).toEqual(
      center,
    );
    await render({
      dragging: true,
      dragTarget: center,
      dragLabel: "Research · 2 tabs",
      dragKind: "group",
    });
    const hint = container.querySelector<HTMLElement>(
      ".workspace-stage-drop-hint",
    )!;
    // The preview is an outline only; the native indicator still gets the
    // drop details through data attributes.
    expect(hint.textContent).toBe("");
    expect(hint.dataset.dropEdge).toBe("tab");
    expect(hint.dataset.dropKind).toBe("group");
    expect(hint.dataset.dropTitle).toBe("Research · 2 tabs");
  });

  it("refuses to split or join a moving whole group back onto itself", async () => {
    await render({
      layout: leaf("browser"),
      headers: [
        {
          id: "browser",
          content: createElement(
            "div",
            null,
            createElement(
              "button",
              { "data-surface-tab-id": "browser" },
              "Page",
            ),
            createElement("button", { "data-surface-tab-id": "docs" }, "Docs"),
          ),
        },
      ],
    });
    vi.spyOn(body("browser"), "getBoundingClientRect").mockReturnValue(
      rectangle(100, 82, 1000, 568),
    );
    expect(
      workspaceSurfaceDropAt(stage(), 105, 300, "browser", null, [
        "browser",
        "docs",
      ]),
    ).toBeNull();
    expect(workspaceSurfaceDropAt(stage(), 500, 300, "docs")).toBeNull();
  });
});
