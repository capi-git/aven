// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  lastDragEnd,
  setCssZoomRectsForTests,
  type CssZoomRects,
} from "../lib/drag";
import {
  SORTABLE_DROP_PART_ATTRIBUTE,
  useSortable,
  type SortableOptions,
  type SortablePart,
} from "./useSortable";

describe("useSortable external drops and cancellation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let sortable: ReturnType<typeof useSortable>;
  let onReorder: Mock<(ids: string[], movedId?: string) => void>;
  let options: SortableOptions;
  let ids: string[];
  let frames: Map<number, FrameRequestCallback>;
  let now: number;
  let restoreClock: () => void;
  let withVisuals: boolean;
  let widths: Map<string, number>;
  let reducedMotion: boolean;
  let animationApiAvailable: boolean;
  let geometryReads: Map<string, number>;
  /**
   * The CSS zoom the items sit under (the window strip cancels the
   * interface zoom with one), and how the engine reports their rects:
   * in the viewport's pixels, or divided by that zoom (legacy WebKit).
   */
  let stripZoom: number;
  let rects: CssZoomRects;
  let renders: number;
  /** The part of an item a press lands on (a split's segment), if any. */
  let partOf: (id: string) => SortablePart | undefined;
  let animations: Map<
    string,
    { animate: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }
  >;

  /** Origins read in the same commit, as the highlight reads them. */
  let probeOrigin: string | null;
  let probed: Array<{ left: number } | null>;
  /** The item each render previews a drop onto. */
  let probeTarget: ((target: string | null) => void) | null;
  /** Parts drawn in an item a drop can land beside: id, left, width. */
  let partsOf: (id: string) => Array<[string, number, number]>;
  function Harness() {
    renders += 1;
    sortable = useSortable(ids, onReorder, options);
    useLayoutEffect(() => {
      if (probeOrigin) probed.push(sortable.takeOrigin(probeOrigin));
      probeTarget?.(sortable.dropTarget?.id ?? null);
    });
    return createElement(
      "div",
      null,
      ids.map((id, index) =>
        createElement(
          "button",
          {
            key: id,
            "data-id": id,
            ref: (element: HTMLButtonElement | null) => {
              sortable.setItemRef(id, element);
              if (!element) return;
              const start = ids
                .slice(0, index)
                .reduce((total, id) => total + (widths.get(id) ?? 100), 0);
              const size = widths.get(id) ?? 100;
              Object.defineProperty(element, "currentCSSZoom", {
                configurable: true,
                get: () => stripZoom,
              });
              element.getBoundingClientRect = () => {
                geometryReads.set(id, (geometryReads.get(id) ?? 0) + 1);
                // Drawn `stripZoom` times its own size in the viewport.
                const scale = rects === "legacy" ? 1 : stripZoom;
                return options.axis === "y"
                  ? new DOMRect(
                      0,
                      (start - (element.parentElement?.scrollTop ?? 0)) * scale,
                      30 * scale,
                      size * scale,
                    )
                  : new DOMRect(
                      (start - (element.parentElement?.scrollLeft ?? 0)) *
                        scale,
                      0,
                      size * scale,
                      30 * scale,
                    );
              };
              element.setPointerCapture = vi.fn();
              element.releasePointerCapture = vi.fn();
              const visual = element.querySelector<HTMLElement>(
                "[data-sortable-motion]",
              );
              if (visual) {
                visual.getBoundingClientRect = () => {
                  const outer = element.getBoundingClientRect();
                  const match =
                    /translate3d\(([-\d.]+)(?:px)?, ([-\d.]+)(?:px)?, 0\)/.exec(
                      visual.style.transform,
                    );
                  return new DOMRect(
                    outer.left + Number(match?.[1] ?? 0),
                    outer.top + Number(match?.[2] ?? 0),
                    outer.width,
                    outer.height,
                  );
                };
                if (!animations.has(id)) {
                  const cancel = vi.fn();
                  const animation = { cancel, onfinish: null, oncancel: null };
                  animations.set(id, {
                    animate: vi.fn(() => animation),
                    cancel,
                  });
                }
                Object.defineProperty(visual, "animate", {
                  configurable: true,
                  value: animationApiAvailable
                    ? animations.get(id)!.animate
                    : undefined,
                });
              }
            },
            onPointerDown: (event) =>
              sortable.onItemPointerDown(id, event, partOf(id)),
          },
          withVisuals
            ? createElement("span", { "data-sortable-motion": "" }, id)
            : id,
          ...partsOf(id).map(([part, left, width]) =>
            createElement("span", {
              key: part,
              [SORTABLE_DROP_PART_ATTRIBUTE]: part,
              ref: (element: HTMLElement | null) => {
                if (element)
                  element.getBoundingClientRect = () =>
                    new DOMRect(left, 0, width, 30);
              },
            }),
          ),
        ),
      ),
    );
  }

  beforeEach(() => {
    probeOrigin = null;
    probed = [];
    probeTarget = null;
    partsOf = () => [];
    now = 1000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    restoreClock = () => clock.mockRestore();
    ids = ["session-a", "browser-a", "session-b"];
    withVisuals = false;
    widths = new Map();
    reducedMotion = false;
    animationApiAvailable = true;
    geometryReads = new Map();
    stripZoom = 1;
    rects = "standard";
    setCssZoomRectsForTests("standard");
    renders = 0;
    partOf = () => undefined;
    animations = new Map();
    vi.stubGlobal("matchMedia", () => ({ matches: reducedMotion }));
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    frames = new Map();
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onReorder = vi.fn();
    options = { onDragMove: vi.fn(), onDragEnd: vi.fn(() => false) };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    restoreClock();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setCssZoomRectsForTests(undefined);
  });

  /** Lets every landing copy finish: each is bounded by a timer. */
  async function land() {
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
  }

  async function pointer(
    target: EventTarget,
    type: string,
    x: number,
    y: number,
  ) {
    await act(async () =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          button: 0,
          clientX: x,
          clientY: y,
        }),
      ),
    );
  }

  async function flushFrame() {
    const pending = [...frames.values()];
    frames.clear();
    await act(async () => pending.forEach((callback) => callback(16)));
  }

  async function start(paint = true) {
    await act(async () => root.render(createElement(Harness)));
    const handle = container.querySelector<HTMLButtonElement>(
      '[data-id="browser-a"]',
    )!;
    await pointer(handle, "pointerdown", 150, 15);
    await pointer(window, "pointermove", 10, 120);
    if (paint) await flushFrame();
    return handle;
  }

  it("lets a content-edge drop consume the gesture without reordering tabs", async () => {
    options.onDragEnd = vi.fn(() => true);
    await start();
    await pointer(window, "pointerup", 12, 150);
    expect(options.onDragMove).toHaveBeenCalledExactlyOnceWith(
      "browser-a",
      10,
      120,
      { screenX: 0, screenY: 0 },
    );
    expect(options.onDragEnd).toHaveBeenCalledExactlyOnceWith(
      "browser-a",
      12,
      150,
      false,
      { screenX: 0, screenY: 0 },
    );
    expect(onReorder).not.toHaveBeenCalled();
    expect(sortable.consumeClick()).toBe(true);
    expect(document.documentElement.classList.contains("is-reordering")).toBe(
      false,
    );
    expect(document.body.style.cursor).toBe("");
  });

  it("keeps up with the pointer when WebKit holds animation frames back", async () => {
    // Over a native page WKWebView may not paint for a while; the copy and
    // its drop target follow the pointer all the same.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await start(false);
    expect(options.onDragMove).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(16);
    });
    expect(options.onDragMove).toHaveBeenCalledExactlyOnceWith(
      "browser-a",
      10,
      120,
      { screenX: 0, screenY: 0 },
    );
    // The frame that comes late does not run it again.
    await flushFrame();
    expect(options.onDragMove).toHaveBeenCalledOnce();
    await pointer(window, "pointerup", 10, 120);
  });

  it("preserves ordinary reordering when an external target does not consume the drop", async () => {
    await start();
    await pointer(window, "pointerup", 10, 15);
    expect(options.onDragEnd).toHaveBeenCalledExactlyOnceWith(
      "browser-a",
      10,
      15,
      false,
      { screenX: 0, screenY: 0 },
    );
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(
      ["browser-a", "session-a", "session-b"],
      "browser-a",
    );
  });

  it.each(["pointercancel", "blur", "lostpointercapture", "Escape", "unmount"])(
    "cancels on %s, releases selection, and never commits a reorder",
    async (reason) => {
      const handle = await start();
      await act(async () => {
        if (reason === "unmount") root.render(null);
        else if (reason === "Escape")
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        else if (reason === "lostpointercapture")
          handle.dispatchEvent(new Event(reason));
        else window.dispatchEvent(new Event(reason));
      });
      expect(options.onDragEnd).toHaveBeenCalledExactlyOnceWith(
        "browser-a",
        10,
        120,
        true,
        { screenX: 0, screenY: 0 },
      );
      expect(onReorder).not.toHaveBeenCalled();
      expect(document.documentElement.classList.contains("is-reordering")).toBe(
        false,
      );
      expect(document.body.style.cursor).toBe("");
      // What ended it, for the real-app check to name.
      expect(lastDragEnd()).toEqual({
        how: reason === "unmount" ? "cancel" : reason,
        focused: document.hasFocus(),
        at: now,
      });
      await pointer(window, "pointerup", 20, 15);
      expect(options.onDragEnd).toHaveBeenCalledOnce();
      expect(onReorder).not.toHaveBeenCalled();
    },
  );

  it("keeps a drag when an element loses focus, as a message box does to the press", async () => {
    // The real-app check's Escape over a page in a split: the new chat's
    // message box had focus, and pressing a tab took it away.
    const field = document.createElement("textarea");
    document.body.append(field);
    field.focus();
    try {
      await start();
      await act(async () => {
        field.blur();
        field.dispatchEvent(new FocusEvent("blur"));
      });
      expect(options.onDragEnd).not.toHaveBeenCalled();
      expect(sortable.draggingId).toBe("browser-a");
      now = 1500;
      await pointer(window, "pointerup", 10, 15);
      expect(lastDragEnd()).toMatchObject({
        how: "release",
        at: 1500,
      });
      expect(onReorder).toHaveBeenCalledExactlyOnceWith(
        ["browser-a", "session-a", "session-b"],
        "browser-a",
      );
    } finally {
      field.remove();
    }
  });

  it("does not report a drag or consume a click below the activation threshold", async () => {
    withVisuals = true;
    options.animate = true;
    await act(async () => root.render(createElement(Harness)));
    const handle = container.querySelector<HTMLButtonElement>(
      '[data-id="browser-a"]',
    )!;
    await pointer(handle, "pointerdown", 150, 15);
    await pointer(window, "pointermove", 152, 15);
    expect(preview()).toBeNull();
    expect(visual().style.opacity).toBe("");
    await pointer(window, "pointerup", 152, 15);
    expect(options.onDragMove).not.toHaveBeenCalled();
    expect(options.onDragEnd).not.toHaveBeenCalled();
    expect(onReorder).not.toHaveBeenCalled();
    expect(sortable.consumeClick()).toBe(false);
  });
  it.each([
    { axis: "x", source: 0, near: 60, before: 149, across: 151, expected: 1 },
    { axis: "x", source: 2, near: 240, before: 151, across: 149, expected: 1 },
    { axis: "y", source: 0, near: 60, before: 149, across: 151, expected: 1 },
    { axis: "y", source: 2, near: 240, before: 151, across: 149, expected: 1 },
  ] as const)(
    "reorders $axis source $source only after crossing the neighboring midpoint",
    async ({ axis, source, near, before, across, expected }) => {
      options.axis = axis;
      await act(async () => root.render(createElement(Harness)));
      const handle = container.querySelector<HTMLButtonElement>(
        `[data-id="${ids[source]}"]`,
      )!;
      const move = async (
        type: string,
        position: number,
        target: EventTarget = window,
      ) =>
        pointer(
          target,
          type,
          axis === "x" ? position : 15,
          axis === "y" ? position : 15,
        );
      await move("pointerdown", source * 100 + 50, handle);
      await move("pointermove", near);
      await flushFrame();
      expect(sortable.toIndex).toBe(source);
      await move("pointermove", before);
      await flushFrame();
      expect(sortable.toIndex).toBe(source);
      await move("pointermove", across);
      await flushFrame();
      expect(sortable.toIndex).toBe(expected);
      await move("pointerup", across);
      expect(onReorder).toHaveBeenCalledExactlyOnceWith(
        source === 0
          ? ["browser-a", "session-a", "session-b"]
          : ["session-a", "session-b", "browser-a"],
        ids[source],
      );
    },
  );

  it("consumes only the trailing drag click, allowing the next immediate selection", async () => {
    await start();
    await pointer(window, "pointerup", 10, 15);
    expect(sortable.consumeClick()).toBe(true);
    expect(sortable.consumeClick()).toBe(false);
  });

  it("expires trailing-click suppression after 400 ms without depending on test execution speed", async () => {
    await start();
    await pointer(window, "pointerup", 10, 15);
    now += 400;
    expect(sortable.consumeClick()).toBe(false);
  });

  it("allows a fresh primary click immediately after a drag even if no trailing click was delivered", async () => {
    await start();
    await pointer(window, "pointerup", 10, 15);
    const next = container.querySelector<HTMLButtonElement>(
      '[data-id="session-b"]',
    )!;
    await pointer(next, "pointerdown", 250, 15);
    await pointer(window, "pointerup", 250, 15);
    expect(sortable.consumeClick()).toBe(false);
    expect(onReorder).toHaveBeenCalledOnce();
  });
  it("allows the sole tab to drag to an external pane without strip reordering", async () => {
    ids = ["browser-a"];
    options.onDragEnd = vi.fn(() => true);
    await act(async () => root.render(createElement(Harness)));
    const handle = container.querySelector<HTMLButtonElement>("button")!;
    await pointer(handle, "pointerdown", 50, 15);
    await pointer(window, "pointermove", 300, 200);
    await pointer(window, "pointerup", 300, 200);
    expect(options.onDragEnd).toHaveBeenCalledExactlyOnceWith(
      "browser-a",
      300,
      200,
      false,
      { screenX: 0, screenY: 0 },
    );
    expect(onReorder).not.toHaveBeenCalled();
  });
  it("never turns an unhandled outside or invalid drop into a strip reorder", async () => {
    await start();
    await pointer(window, "pointerup", 450, 120);
    expect(onReorder).not.toHaveBeenCalled();
    expect(sortable.toIndex).toBeNull();
    expect(sortable.consumeClick()).toBe(true);
  });

  it("forwards absolute screen position separately from client coordinates", async () => {
    const handle = await start();
    const release = handle.releasePointerCapture;
    await act(async () =>
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 1,
          clientX: -20,
          clientY: 140,
          screenX: 1500,
          screenY: 500,
        }),
      ),
    );
    expect(options.onDragEnd).toHaveBeenLastCalledWith(
      "browser-a",
      -20,
      140,
      false,
      { screenX: 1500, screenY: 500 },
    );
    expect(onReorder).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it("autoscrolls an overflowed strip only during an active edge drag and stops on cancellation", async () => {
    await act(async () => root.render(createElement(Harness)));
    const strip = container.firstElementChild as HTMLElement;
    strip.getBoundingClientRect = () => new DOMRect(0, 0, 300, 30);
    Object.defineProperties(strip, {
      scrollWidth: { value: 900 },
      clientWidth: { value: 300 },
    });
    sortable.setContainerRef(strip);
    const handle = strip.querySelector<HTMLButtonElement>(
      '[data-id="browser-a"]',
    )!;
    await pointer(handle, "pointerdown", 150, 15);
    expect(frames.size).toBe(0);
    await pointer(window, "pointermove", 295, 15);
    expect(frames.size).toBe(1);
    const [id, callback] = [...frames][0];
    frames.delete(id);
    await act(async () => callback(16));
    expect(strip.scrollLeft).toBeGreaterThan(0);
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(frames.size).toBe(0);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("coalesces pointer bursts into one hit-test update using the latest coordinates", async () => {
    await start(false);
    await pointer(window, "pointermove", 50, 120);
    await pointer(window, "pointermove", 80, 140);
    expect(options.onDragMove).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    await flushFrame();
    expect(options.onDragMove).toHaveBeenCalledExactlyOnceWith(
      "browser-a",
      80,
      140,
      { screenX: 0, screenY: 0 },
    );
    expect(frames.size).toBe(0);
  });

  it.each([false, true])(
    "measures each scroll and item hit box once within a drag frame (animate=%s)",
    async (animate) => {
      withVisuals = animate;
      options.animate = animate;
      options.onDropOnItem = vi.fn();
      await act(async () => root.render(createElement(Harness)));
      const strip = container.firstElementChild as HTMLElement;
      strip.setAttribute("data-sortable-scroll-container", "");
      const stripBounds = vi.fn(() => new DOMRect(0, 0, 300, 30));
      strip.getBoundingClientRect = stripBounds;
      sortable.setContainerRef(strip);
      const handle = strip.querySelector<HTMLButtonElement>(
        '[data-id="browser-a"]',
      )!;
      await pointer(handle, "pointerdown", 150, 15);
      await pointer(window, "pointermove", 260, 15);
      geometryReads.clear();
      stripBounds.mockClear();
      await flushFrame();
      expect(stripBounds).toHaveBeenCalledOnce();
      expect(geometryReads).toEqual(
        new Map(
          ids
            .filter((id) => animate || id !== "browser-a")
            .map((id) => [id, 1]),
        ),
      );
      expect(sortable.dropTarget).toEqual({
        kind: "tab",
        id: "session-b",
        allowed: true,
      });
    },
  );

  it("keeps React idle within the same drop target but updates permission changes", async () => {
    let allowed = true;
    options.onDropOnItem = vi.fn();
    options.canDropOn = () => allowed;
    await act(async () => root.render(createElement(Harness)));
    const handle = container.querySelector<HTMLButtonElement>(
      '[data-id="browser-a"]',
    )!;
    await pointer(handle, "pointerdown", 150, 15);
    await pointer(window, "pointermove", 260, 15);
    await flushFrame();
    const targetRenders = renders;
    await pointer(window, "pointermove", 265, 15);
    await flushFrame();
    await pointer(window, "pointermove", 255, 15);
    await flushFrame();
    expect(renders).toBe(targetRenders);
    expect(options.onDragMove).toHaveBeenCalledTimes(3);
    allowed = false;
    await pointer(window, "pointermove", 260, 15);
    await flushFrame();
    expect(renders).toBe(targetRenders + 1);
    expect(sortable.dropTarget?.allowed).toBe(false);
    await pointer(window, "pointerup", 260, 15);
    expect(options.onDropOnItem).not.toHaveBeenCalled();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("stops requesting frames when an edge scroll cannot move the container", async () => {
    await act(async () => root.render(createElement(Harness)));
    const strip = container.firstElementChild as HTMLElement;
    strip.getBoundingClientRect = () => new DOMRect(0, 0, 300, 30);
    Object.defineProperties(strip, {
      scrollWidth: { value: 900 },
      clientWidth: { value: 300 },
      scrollLeft: { get: () => 0, set: () => {} },
    });
    sortable.setContainerRef(strip);
    const handle = strip.querySelector<HTMLButtonElement>(
      '[data-id="browser-a"]',
    )!;
    await pointer(handle, "pointerdown", 150, 15);
    await pointer(window, "pointermove", 295, 15);
    await flushFrame();
    expect(options.onDragMove).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  it("uses the release position even when no scheduled drag frame has painted", async () => {
    await start(false);
    await pointer(window, "pointermove", 250, 15);
    await pointer(window, "pointerup", 10, 15);
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(
      ["browser-a", "session-a", "session-b"],
      "browser-a",
    );
    expect(options.onDragEnd).toHaveBeenCalledExactlyOnceWith(
      "browser-a",
      10,
      15,
      false,
      { screenX: 0, screenY: 0 },
    );
    expect(frames.size).toBe(0);
    await flushFrame();
    expect(options.onDragMove).not.toHaveBeenCalled();
  });

  const item = (id = "browser-a") =>
    container.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
  const visual = (id = "browser-a") =>
    item(id).querySelector<HTMLElement>("[data-sortable-motion]")!;
  const preview = () =>
    document.querySelector<HTMLElement>("[data-sortable-preview]");
  async function startAnimated(x = 220) {
    withVisuals = true;
    options.animate = true;
    await act(async () => root.render(createElement(Harness)));
    await pointer(item(), "pointerdown", 150, 15);
    await pointer(window, "pointermove", x, 15);
    await flushFrame();
  }

  it("reads external drop geometry before applying this frame's visual motion", async () => {
    const paintedTransforms: string[] = [];
    options.onDragMove = vi.fn(() => {
      item().getBoundingClientRect();
      paintedTransforms.push(preview()?.style.transform ?? "");
    });
    await startAnimated(220);
    expect(paintedTransforms).toEqual(["translate3d(170px, 0px, 0)"]);
    expect(preview()?.style.transform).toBe("translate3d(170px, 0px, 0)");
    await pointer(window, "pointermove", 270, 15);
    await flushFrame();
    expect(paintedTransforms).toEqual([
      "translate3d(170px, 0px, 0)",
      "translate3d(170px, 0px, 0)",
    ]);
    expect(preview()?.style.transform).toBe("translate3d(220px, 0px, 0)");
  });

  it("moves visual children without changing unequal-width insertion hit boxes", async () => {
    widths = new Map([
      ["session-a", 80],
      ["browser-a", 140],
      ["session-b", 100],
    ]);
    withVisuals = true;
    options.animate = true;
    await act(async () => root.render(createElement(Harness)));
    await pointer(item(), "pointerdown", 100, 15);
    await pointer(window, "pointermove", 290, 15);
    await flushFrame();
    expect(sortable.toIndex).toBe(2);
    expect(item().style.transform).toBe("");
    expect(item().getBoundingClientRect().left).toBe(80);
    expect(visual().style.transform).toBe("");
    expect(visual().style.opacity).toBe("0");
    expect(preview()?.style.transform).toBe("translate3d(270px, 0px, 0)");
    expect(visual("session-b").style.transform).toBe(
      "translate3d(-140px, 0, 0)",
    );
    expect(item().dataset.sortableMoving).toBe("true");
    expect(visual().dataset.sortableDragging).toBe("true");
    await pointer(window, "pointermove", 265, 15);
    await flushFrame();
    expect(sortable.toIndex).toBe(1);
    // Back where it belongs, a sibling keeps its own style.
    expect(visual("session-b").style.transform).toBe("");
  });

  // The window strip cancels the interface zoom with CSS zoom: 1.25 at
  // 80%, 1/1.2 at 120%. Each 100px tab is that many of the viewport's
  // pixels, where the pointer is, and older WebKit (macOS 13 to 26) reports
  // the strip's rects divided by the zoom.
  const zoomCases = (["standard", "legacy"] as const).flatMap((engine) =>
    [0.8, 1.2].map((ui) => [engine, ui] as const),
  );
  /** Where the strip draws (x, y) of its own, in the viewport's pixels. */
  const onStrip = (x: number, y = 15) =>
    [x * stripZoom, y * stripZoom] as const;

  it.each(zoomCases)(
    "reorders a CSS-zoomed strip where the pointer is, on %s CSS zoom at %s",
    async (engine, ui) => {
      stripZoom = 1 / ui;
      rects = engine;
      setCssZoomRectsForTests(engine);
      await act(async () => root.render(createElement(Harness)));
      await pointer(item(), "pointerdown", ...onStrip(150));
      // The third tab is 200 to 300 of the strip's own. Over its first
      // half, low on the 30px strip, the dragged tab stays second.
      await pointer(window, "pointermove", ...onStrip(224, 27));
      await flushFrame();
      expect(sortable.toIndex).toBe(1);
      // Just past its middle, it goes last.
      await pointer(window, "pointermove", ...onStrip(262));
      await flushFrame();
      expect(sortable.toIndex).toBe(2);
      await pointer(window, "pointerup", ...onStrip(262));
      expect(onReorder).toHaveBeenCalledExactlyOnceWith(
        ["session-a", "session-b", "browser-a"],
        "browser-a",
      );
    },
  );

  it.each(zoomCases)(
    "joins the tab whose middle the pointer is on, on %s CSS zoom at %s",
    async (engine, ui) => {
      stripZoom = 1 / ui;
      rects = engine;
      setCssZoomRectsForTests(engine);
      options.onDropOnItem = vi.fn();
      await act(async () => root.render(createElement(Harness)));
      await pointer(item(), "pointerdown", ...onStrip(150));
      // The third tab's middle half is 225 to 275 of the strip's own.
      await pointer(window, "pointermove", ...onStrip(262));
      await flushFrame();
      await pointer(window, "pointerup", ...onStrip(262));
      expect(options.onDropOnItem).toHaveBeenCalledExactlyOnceWith(
        "browser-a",
        "session-b",
      );
      expect(onReorder).not.toHaveBeenCalled();
    },
  );

  it("keeps the floating tab at the grab offset during scrolling and outside the strip", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await startAnimated();
    const strip = item().parentElement!;
    strip.getBoundingClientRect = () => new DOMRect(0, 0, 300, 30);
    sortable.setContainerRef(strip);
    expect(preview()?.style.transform).toBe("translate3d(170px, 0px, 0)");
    strip.scrollLeft = 40;
    await pointer(window, "pointermove", 220, 15);
    await flushFrame();
    expect(preview()?.style.transform).toBe("translate3d(170px, 0px, 0)");
    await pointer(window, "pointermove", 220, 90);
    await flushFrame();
    expect(visual().style.transform).toBe("");
    expect(visual("session-b").style.transform).toBe("");
    expect(visual().dataset.sortableInStrip).toBe("false");
    // Out of the strip it follows the pointer, no longer rubber-banded.
    expect(preview()?.style.transform).toBe("translate3d(170px, 75px, 0)");
    expect(preview()?.parentElement).toBe(document.body);
    await pointer(window, "pointerup", 220, 90);
    // Let go where nothing takes it, the copy flies home; the tab itself
    // shows again once it lands.
    expect(animations.get("browser-a")!.animate).not.toHaveBeenCalled();
    expect(onReorder).not.toHaveBeenCalled();
    expect(preview()).not.toBeNull();
    expect(visual().style.opacity).toBe("0");
    expect(sortable.landingId).toBe("browser-a");
    await land();
    expect(preview()).toBeNull();
    expect(visual().style.opacity).toBe("");
    expect(sortable.landingId).toBeNull();
  });

  it("updates stationary-pointer drop geometry after a strip scroll", async () => {
    await startAnimated(220);
    expect(sortable.toIndex).toBe(1);
    const strip = item().parentElement!;
    strip.getBoundingClientRect = () => new DOMRect(0, 0, 300, 30);
    sortable.setContainerRef(strip);
    strip.scrollLeft = 50;
    await act(async () => strip.dispatchEvent(new Event("scroll")));
    expect(frames.size).toBe(1);
    await flushFrame();
    expect(sortable.toIndex).toBe(2);
    expect(preview()?.style.transform).toBe("translate3d(170px, 0px, 0)");
    await pointer(window, "pointerup", 220, 15);
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(
      ["session-a", "session-b", "browser-a"],
      "browser-a",
    );
    await act(async () => strip.dispatchEvent(new Event("scroll")));
    expect(frames.size).toBe(0);
  });

  it.each(["pointercancel", "blur", "lostpointercapture", "Escape", "unmount"])(
    "brings the picked-up copy home and restores the original on %s",
    async (reason) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await startAnimated(270);
      const handle = item();
      const original = visual();
      expect(preview()?.parentElement).toBe(document.body);
      expect(original.style.opacity).toBe("0");
      await act(async () => {
        if (reason === "unmount") root.render(null);
        else if (reason === "Escape")
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        else if (reason === "lostpointercapture")
          handle.dispatchEvent(new Event(reason));
        else window.dispatchEvent(new Event(reason));
      });
      // Gone at once with the strip; otherwise it flies home first.
      if (reason !== "unmount") await land();
      expect(preview()).toBeNull();
      expect(original.style.opacity).toBe("");
      expect(onReorder).not.toHaveBeenCalled();
      // Nothing is left behind mid-spring: every tab back in its own style,
      // and no timer still pending (an idle window wakes for nothing).
      if (reason !== "unmount")
        for (const id of ids) {
          expect(visual(id).style.transform).toBe("");
          expect(visual(id).style.opacity).toBe("");
        }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["pointercancel", "blur", "Escape"])(
    "leaves nothing behind when %s ends a drag whose neighbours are mid-spring and starts again at once",
    async (reason) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await startAnimated(270);
      // session-b is on its way to -100px when the drag ends.
      expect(visual("session-b").style.transform).toBe(
        "translate3d(-100px, 0, 0)",
      );
      await act(async () => {
        if (reason === "Escape")
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        else window.dispatchEvent(new Event(reason));
      });
      // A new press while everything is still flying home ends it at once.
      await pointer(item("session-a"), "pointerdown", 50, 15);
      await pointer(window, "pointerup", 50, 15);
      expect(preview()).toBeNull();
      for (const id of ids) {
        expect(visual(id).style.transform).toBe("");
        expect(visual(id).style.opacity).toBe("");
        expect(visual(id).hasAttribute("data-sortable-dragging")).toBe(false);
      }
      expect(sortable.landingId).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("captures the painted drag before reordering and settles against the committed layout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    onReorder.mockImplementation((next) => {
      expect(visual().style.transform).toBe("");
      ids = next;
      root.render(createElement(Harness));
    });
    await startAnimated(270);
    const copy = preview()!;
    const flight = vi.spyOn(copy, "animate");
    await pointer(window, "pointerup", 270, 15);
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(
      ["session-a", "session-b", "browser-a"],
      "browser-a",
    );
    // The copy flies from where it was let go to the tab's new slot, and the
    // tab stays hidden under it until it lands.
    const [frames] = flight.mock.calls[0];
    expect((frames as Keyframe[])[0].transform).toBe(
      "translate3d(220px, 0px, 0)",
    );
    expect((frames as Keyframe[]).at(-1)!.transform).toBe(
      "translate3d(200px, 0px, 0)",
    );
    expect(animations.get("browser-a")!.animate).not.toHaveBeenCalled();
    expect(visual().style.opacity).toBe("0");
    // The sibling it pushed aside settles from where it was drawn.
    const sibling = animations.get("session-b")!.animate.mock.calls[0];
    expect((sibling[0] as Keyframe[])[0].transform).toBe(
      "translate3d(0px, 0, 0)",
    );
    expect(visual().style.transform).toBe("");
    // Hidden under the copy at once, whatever transitions its opacity.
    expect(visual().style.transition).toBe("none");
    expect(item().hasAttribute("data-sortable-moving")).toBe(false);
    expect(visual().hasAttribute("data-sortable-dragging")).toBe(false);
    expect(visual().hasAttribute("data-sortable-in-strip")).toBe(false);
    // Even a new click below the threshold ends a landing at once.
    await pointer(item("session-a"), "pointerdown", 50, 15);
    expect(preview()).toBeNull();
    expect(visual().style.opacity).toBe("");
    expect(visual().style.transition).toBe("");
    expect(animations.get("session-b")!.cancel).toHaveBeenCalled();
    await pointer(window, "pointerup", 50, 15);
    expect(onReorder).toHaveBeenCalledOnce();
  });

  it("keeps where entries stood only for the commit that morphed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    probeOrigin = "session-b";
    await startAnimated(270);
    probed.length = 0;
    await pointer(window, "pointerup", 270, 15);
    // The drop's commit could read session-b's old box (drawn at -100px)...
    expect(probed.find(Boolean)).toMatchObject({ left: 100 });
    // ...and once it is over, nothing is left for a later front change to
    // glide from: it slides as usual.
    expect(sortable.takeOrigin("session-b")).toBeNull();
    expect(sortable.takeOrigin("session-a")).toBeNull();
  });

  it("brings siblings home from where they are drawn on Escape, and stops on unmount", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await startAnimated(270);
    expect(visual("session-b").style.transform).toBe(
      "translate3d(-100px, 0, 0)",
    );
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(onReorder).not.toHaveBeenCalled();
    expect(options.onDragEnd).toHaveBeenLastCalledWith(
      "browser-a",
      270,
      15,
      true,
      { screenX: 0, screenY: 0 },
    );
    for (const id of ids) {
      // The dragged tab is hidden under its copy until it lands.
      expect(visual(id).style.transition).toBe(
        id === "browser-a" ? "none" : "",
      );
      expect(visual(id).hasAttribute("data-sortable-dragging")).toBe(false);
      expect(item(id).hasAttribute("data-sortable-moving")).toBe(false);
    }
    // The tab's copy flies home; the sibling springs back from -100px.
    expect(animations.get("browser-a")!.animate).not.toHaveBeenCalled();
    const [home] = animations.get("session-b")!.animate.mock.calls.at(-1)!;
    expect((home as Keyframe[])[0].transform).toBe("translate3d(-100px, 0, 0)");
    expect((home as Keyframe[]).at(-1)!.transform).toBe(
      "translate3d(0px, 0, 0)",
    );
    expect(visual("session-b").style.transform).toBe("");
    await act(async () => root.render(null));
    expect(animations.get("session-b")!.cancel).toHaveBeenCalled();
    expect(preview()).toBeNull();
  });

  it("follows the pointer with reduced motion but does not start timed settling", async () => {
    reducedMotion = true;
    await startAnimated(270);
    expect(preview()?.style.transform).toBe("translate3d(220px, 0px, 0)");
    await pointer(window, "pointerup", 270, 15);
    expect(onReorder).toHaveBeenCalledOnce();
    expect(visual().style.transform).toBe("");
    for (const animation of animations.values())
      expect(animation.animate).not.toHaveBeenCalled();
  });

  it("flies no copy back from a consumed drop or a drop into another item", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    options.onDragEnd = vi.fn(() => true);
    await startAnimated(270);
    await pointer(window, "pointerup", 270, 90);
    expect(onReorder).not.toHaveBeenCalled();
    // Taken from outside the strip, it fades where it was let go, and the
    // tab (still on this test's strip) fades back in rather than flying.
    expect(sortable.landingId).toBeNull();
    expect(
      animations.get("browser-a")!.animate,
    ).toHaveBeenCalledExactlyOnceWith(
      [{ opacity: 0 }, { opacity: 1 }],
      expect.objectContaining({ easing: "linear" }),
    );
    const lift = preview()!.querySelector<HTMLElement>("[data-sortable-lift]")!;
    expect(lift.style.opacity).toBe("0");
    await land();
    expect(preview()).toBeNull();
    options.onDragEnd = vi.fn(() => false);
    options.onDropOnItem = vi.fn();
    await startAnimated(270);
    await pointer(window, "pointerup", 270, 15);
    expect(options.onDropOnItem).toHaveBeenCalledExactlyOnceWith(
      "browser-a",
      "session-b",
    );
    // Let go onto another item, that item shows it: nothing flies home (the
    // tab, still on this test's strip, only fades back in).
    expect(sortable.landingId).toBeNull();
    expect(animations.get("browser-a")!.animate).toHaveBeenCalledTimes(2);
    await land();
    expect(preview()).toBeNull();
    expect(visual().style.transition).toBe("");
  });

  it("leaves visual wrappers untouched when animation is not opted in", async () => {
    withVisuals = true;
    await act(async () => root.render(createElement(Harness)));
    await pointer(item(), "pointerdown", 150, 15);
    await pointer(window, "pointermove", 270, 15);
    await flushFrame();
    expect(visual().style.transform).toBe("");
    expect(item().hasAttribute("data-sortable-moving")).toBe(false);
    await pointer(window, "pointerup", 270, 15);
    expect(onReorder).toHaveBeenCalledOnce();
    for (const animation of animations.values())
      expect(animation.animate).not.toHaveBeenCalled();
  });

  it("continues reordering when visual wrappers or the animation API are unavailable", async () => {
    options.animate = true;
    await start();
    await pointer(window, "pointerup", 10, 15);
    expect(onReorder).toHaveBeenCalledOnce();
    await startAnimated(270);
    animationApiAvailable = false;
    for (const id of ids)
      Object.defineProperty(visual(id), "animate", {
        configurable: true,
        value: undefined,
      });
    await pointer(window, "pointerup", 270, 15);
    expect(onReorder).toHaveBeenCalledTimes(2);
    expect(visual().style.transform).toBe("");
  });

  it.each(["pointercancel", "blur", "lostpointercapture", "Escape", "unmount"])(
    "clears an unpainted drag frame on %s",
    async (reason) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      withVisuals = true;
      options.animate = true;
      const handle = await start(false);
      const original = visual();
      expect(frames.size).toBe(1);
      expect(preview()).not.toBeNull();
      await act(async () => {
        if (reason === "unmount") root.render(null);
        else if (reason === "Escape")
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        else if (reason === "lostpointercapture")
          handle.dispatchEvent(new Event(reason));
        else window.dispatchEvent(new Event(reason));
      });
      expect(frames.size).toBe(0);
      if (reason !== "unmount") await land();
      expect(preview()).toBeNull();
      expect(original.style.opacity).toBe("");
      await flushFrame();
      expect(options.onDragMove).not.toHaveBeenCalled();
      expect(onReorder).not.toHaveBeenCalled();
      expect(options.onDragEnd).toHaveBeenCalledExactlyOnceWith(
        "browser-a",
        10,
        120,
        true,
        { screenX: 0, screenY: 0 },
      );
    },
  );
  describe("a part of an item", () => {
    const page: SortablePart = {
      id: "page",
      element: document.createElement("span"),
    };
    beforeEach(() => {
      partOf = (id) => (id === "browser-a" ? page : undefined);
    });

    it("moves the whole item while the pointer stays on the strip", async () => {
      await act(async () => root.render(createElement(Harness)));
      const handle = container.querySelector<HTMLButtonElement>(
        '[data-id="browser-a"]',
      )!;
      await pointer(handle, "pointerdown", 150, 15);
      await pointer(window, "pointermove", 10, 15);
      await flushFrame();
      await pointer(window, "pointerup", 10, 15);
      expect(options.onDragEnd).toHaveBeenCalledExactlyOnceWith(
        "browser-a",
        10,
        15,
        false,
        { screenX: 0, screenY: 0 },
        { part: "page", torn: false, inStrip: true },
      );
      expect(onReorder).toHaveBeenCalledExactlyOnceWith(
        ["browser-a", "session-a", "session-b"],
        "browser-a",
      );
    });

    it("is torn off once the pointer leaves the strip, and never reorders it", async () => {
      await start();
      expect(options.onDragMove).toHaveBeenLastCalledWith(
        "browser-a",
        10,
        120,
        { screenX: 0, screenY: 0 },
        { part: "page", torn: true, inStrip: false },
      );
      // Back over the strip it stays torn off: the consumer places it.
      await pointer(window, "pointermove", 10, 15);
      await flushFrame();
      expect(sortable.toIndex).toBeNull();
      await pointer(window, "pointerup", 10, 15);
      expect(options.onDragEnd).toHaveBeenLastCalledWith(
        "browser-a",
        10,
        15,
        false,
        { screenX: 0, screenY: 0 },
        { part: "page", torn: true, inStrip: true },
      );
      expect(onReorder).not.toHaveBeenCalled();
    });
  });

  it("takes drops only on the items it names", async () => {
    options.onDropOnItem = vi.fn();
    options.isDropTarget = (_dragged, target) => target === "session-b";
    // Over session-a's drop zone (its middle half): an ordinary move.
    await start(false);
    await pointer(window, "pointerup", 30, 15);
    expect(options.onDropOnItem).not.toHaveBeenCalled();
    expect(onReorder).toHaveBeenCalledExactlyOnceWith(
      ["browser-a", "session-a", "session-b"],
      "browser-a",
    );
    // Over the middle of session-b: a drop onto it.
    await start(false);
    await pointer(window, "pointerup", 250, 15);
    expect(options.onDropOnItem).toHaveBeenCalledExactlyOnceWith(
      "browser-a",
      "session-b",
    );
    expect(onReorder).toHaveBeenCalledOnce();
  });

  describe("a delayed drop onto an item", () => {
    beforeEach(() => {
      options.onDropOnItem = vi.fn();
      options.dropOnDelay = 200;
    });
    async function hold(x: number) {
      await pointer(window, "pointermove", x, 15);
      await flushFrame();
    }
    async function press() {
      await act(async () => root.render(createElement(Harness)));
      await pointer(item(), "pointerdown", 150, 15);
    }

    it("reorders on a quick pass over an item's middle, never previewing a drop", async () => {
      const targets: Array<string | null> = [];
      probeTarget = (target) => targets.push(target);
      await press();
      await hold(250);
      // On its middle a release would join session-b: the slot does not
      // pass it and no line shows, only a light hint; no preview yet.
      expect(sortable.dropTarget).toBeNull();
      expect(sortable.toIndex).toBeNull();
      expect(sortable.joinHint).toBe("session-b");
      // On past the middle, into session-b's outer quarter: now the line
      // shows past it, and a release there moves the tab.
      now += 30;
      await hold(290);
      expect(sortable.joinHint).toBeNull();
      expect(sortable.toIndex).toBe(2);
      await pointer(window, "pointerup", 290, 15);
      expect(options.onDropOnItem).not.toHaveBeenCalled();
      expect(onReorder).toHaveBeenCalledExactlyOnceWith(
        ["session-a", "session-b", "browser-a"],
        "browser-a",
      );
      // No render ever previewed a drop onto session-b.
      expect(targets.length).toBeGreaterThan(0);
      expect(targets.every((target) => target === null)).toBe(true);
    });

    it("drops onto an item let go on its middle without resting", async () => {
      const targets: Array<string | null> = [];
      probeTarget = (target) => targets.push(target);
      await press();
      await hold(250);
      expect(sortable.dropTarget).toBeNull();
      await pointer(window, "pointerup", 250, 15);
      expect(options.onDropOnItem).toHaveBeenCalledExactlyOnceWith(
        "browser-a",
        "session-b",
      );
      expect(onReorder).not.toHaveBeenCalled();
      // The preview was drawn on release, before the drop was measured.
      expect(targets).toContain("session-b");
    });

    it("drops on a quick release that a busy page handles late", async () => {
      await press();
      await hold(250);
      // Let go 20 ms after reaching the middle; the page gets to the
      // release 100 ms later. Not a rest, but let go on the middle.
      now += 20;
      const release = new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: 250,
        clientY: 15,
      });
      now += 100;
      await act(async () => window.dispatchEvent(release));
      expect(options.onDropOnItem).toHaveBeenCalledExactlyOnceWith(
        "browser-a",
        "session-b",
      );
      expect(onReorder).not.toHaveBeenCalled();
    });

    it("dissolves the copy into the item's half when let go before it armed", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      await startAnimated(250);
      const lift = () =>
        preview()!.querySelector<HTMLElement>("[data-sortable-lift]")!;
      expect(lift().style.opacity).toBe("1");
      await pointer(window, "pointerup", 250, 15);
      expect(options.onDropOnItem).toHaveBeenCalledOnce();
      // Nothing flies home: the copy goes into session-b's right half
      // (from its centre at 250 to 275) as it fades.
      expect(sortable.landingId).toBeNull();
      expect(lift().style.transform).toMatch(/^translate3d\(25px, 0px, 0px\)/);
      expect(lift().style.opacity).toBe("0");
      await land();
      expect(preview()).toBeNull();
    });

    it("says which part of the item it was let go beside, and on which side", async () => {
      // session-b (200–300) holds two parts: 200–250 and 250–300.
      partsOf = (id) =>
        id === "session-b"
          ? [
              ["left", 200, 50],
              ["right", 250, 50],
            ]
          : [];
      await press();
      await hold(240);
      now += 200;
      await hold(240);
      expect(sortable.dropTarget).toEqual({
        kind: "tab",
        id: "session-b",
        allowed: true,
        at: { part: "left", side: "after" },
      });
      await hold(260);
      expect(sortable.dropTarget?.at).toEqual({
        part: "right",
        side: "before",
      });
      await pointer(window, "pointerup", 260, 15);
      expect(options.onDropOnItem).toHaveBeenCalledExactlyOnceWith(
        "browser-a",
        "session-b",
        undefined,
        { part: "right", side: "before" },
      );
    });

    it("counts a rest from when the pointer got there, not when the page drew it", async () => {
      await press();
      await pointer(window, "pointermove", 250, 15);
      // The frame runs 150 ms late.
      now += 150;
      await flushFrame();
      expect(sortable.dropTarget).toBeNull();
      // 200 ms after the pointer reached the middle, it arms.
      now += 50;
      await hold(251);
      expect(sortable.dropTarget?.id).toBe("session-b");
      await pointer(window, "pointerup", 251, 15);
      expect(options.onDropOnItem).toHaveBeenCalledExactlyOnceWith(
        "browser-a",
        "session-b",
      );
    });

    it("arms once the pointer rests there, and holds a little past its edge", async () => {
      await press();
      await hold(250);
      now += 199;
      await hold(251);
      expect(sortable.dropTarget).toBeNull();
      now += 1;
      await hold(250);
      expect(sortable.dropTarget).toEqual({
        kind: "tab",
        id: "session-b",
        allowed: true,
      });
      expect(sortable.toIndex).toBeNull();
      // Its middle is 225–275; armed, it holds to 217.
      await hold(220);
      expect(sortable.dropTarget?.id).toBe("session-b");
      await hold(212);
      expect(sortable.dropTarget).toBeNull();
      // Coming back, it waits again.
      await hold(250);
      expect(sortable.dropTarget).toBeNull();
      now += 200;
      await pointer(window, "pointerup", 250, 15);
      expect(options.onDropOnItem).toHaveBeenCalledExactlyOnceWith(
        "browser-a",
        "session-b",
      );
      expect(onReorder).not.toHaveBeenCalled();
    });

    it("dissolves the floating copy into the item it would drop onto", async () => {
      await startAnimated(250);
      const lift = () =>
        preview()!.querySelector<HTMLElement>("[data-sortable-lift]")!;
      expect(lift().style.opacity).toBe("1");
      now += 200;
      await hold(250);
      // Towards the right half of session-b (200–300), where it will join:
      // from the copy's centre (250) to that half's (275).
      expect(lift().style.opacity).toBe("0");
      expect(lift().style.transform).toMatch(/^translate3d\(25px, 0px, 0px\)/);
      await hold(290);
      expect(lift().style.opacity).toBe("1");
      expect(lift().style.transform).toMatch(/^translate3d\(0px, 0px, 0px\)/);
      await pointer(window, "pointerup", 290, 15);
    });

    it("never arms on a slow, steady pass, only on a rest", async () => {
      await press();
      // Through session-b's middle (225–275) at about 170px/s: never armed,
      // and session-b never moves aside (a release would join it), with
      // only the light hint on it.
      for (let x = 228; x <= 272; x += 3) {
        now += 18;
        await hold(x);
        expect(sortable.dropTarget).toBeNull();
        expect(sortable.toIndex).toBeNull();
        expect(sortable.joinHint).toBe("session-b");
      }
      now += 200;
      await hold(272);
      expect(sortable.dropTarget?.id).toBe("session-b");
      await pointer(window, "pointerup", 272, 15);
      expect(options.onDropOnItem).toHaveBeenCalledExactlyOnceWith(
        "browser-a",
        "session-b",
      );
    });

    it("shows at release what a release does: past a neighbour, then onto the next one's middle", async () => {
      await act(async () => root.render(createElement(Harness)));
      // session-a (0–100) to the right, briskly, one move per frame.
      await pointer(item("session-a"), "pointerdown", 50, 15);
      await hold(90);
      // Past browser-a (100–200) at its far edge: it moves aside.
      await hold(190);
      expect(sortable.toIndex).toBe(1);
      expect(sortable.joinHint).toBeNull();
      // On session-b's middle (225–275), past its midpoint: the slot stays
      // before it, no line shows, and the hint marks it.
      await hold(260);
      expect(sortable.toIndex).toBeNull();
      expect(sortable.joinHint).toBe("session-b");
      await pointer(window, "pointerup", 260, 15);
      expect(options.onDropOnItem).toHaveBeenCalledExactlyOnceWith(
        "session-a",
        "session-b",
      );
      expect(onReorder).not.toHaveBeenCalled();

      // Leftwards: session-b onto browser-a's middle (125–175), past its
      // midpoint, holds its own slot; at browser-a's near edge it moves.
      await pointer(item("session-b"), "pointerdown", 250, 15);
      await hold(210);
      await hold(140);
      expect(sortable.toIndex).toBeNull();
      expect(sortable.joinHint).toBe("browser-a");
      await hold(110);
      expect(sortable.joinHint).toBeNull();
      expect(sortable.toIndex).toBe(1);
      await pointer(window, "pointerup", 110, 15);
      expect(onReorder).toHaveBeenCalledExactlyOnceWith(
        ["session-a", "session-b", "browser-a"],
        "session-b",
      );
    });

    it("keeps the outer quarters for reordering", async () => {
      await press();
      await hold(290);
      now += 500;
      await hold(290);
      expect(sortable.dropTarget).toBeNull();
      await pointer(window, "pointerup", 290, 15);
      expect(options.onDropOnItem).not.toHaveBeenCalled();
      expect(onReorder).toHaveBeenCalledOnce();
    });

    it("lets a torn-off part drop onto an item back on the strip", async () => {
      const page: SortablePart = {
        id: "page",
        element: document.createElement("span"),
      };
      partOf = (id) => (id === "browser-a" ? page : undefined);
      options.isDropTarget = (_dragged, target, part) =>
        part === "page" && target === "session-b";
      await press();
      await pointer(window, "pointermove", 150, 120);
      await flushFrame();
      await hold(250);
      now += 200;
      await hold(250);
      expect(options.onDragMove).toHaveBeenLastCalledWith(
        "browser-a",
        250,
        15,
        { screenX: 0, screenY: 0 },
        { part: "page", torn: true, inStrip: true, target: "session-b" },
      );
      await pointer(window, "pointerup", 250, 15);
      expect(options.onDropOnItem).toHaveBeenCalledExactlyOnceWith(
        "browser-a",
        "session-b",
        "page",
      );
      expect(onReorder).not.toHaveBeenCalled();
    });
  });
});
