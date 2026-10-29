// @vitest-environment happy-dom
import { act, createElement, Fragment, useLayoutEffect } from "react";
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
  useSortable,
  type SortableLink,
  type SortableOptions,
} from "./useSortable";

/**
 * Two bars on one channel, as the window's strip and a pane's row of tabs
 * are: a tab dragged out of one and let go on the middle of the other's tab
 * joins it there. Bar A lies at y 0–30, bar B at y 100–130; each has two
 * 100px items from x 0.
 */
describe("useSortable between bars on one channel", () => {
  let container: HTMLDivElement;
  let root: Root;
  let now: number;
  let frames: Map<number, FrameRequestCallback>;
  let bars: Record<string, ReturnType<typeof useSortable>>;
  let options: Record<string, SortableOptions>;
  let reorders: Record<string, Mock<(ids: string[], movedId?: string) => void>>;
  let restoreClock: () => void;
  /** What each render of bar B previews: its target and what comes in. */
  let seen: Array<{ target: string | null; content: unknown }>;

  const ITEMS: Record<string, string[]> = { a: ["a1", "a2"], b: ["b1", "b2"] };
  const TOP: Record<string, number> = { a: 0, b: 100 };

  function Bar({ name }: { name: string }) {
    const sortable = useSortable(ITEMS[name], reorders[name], options[name]);
    bars[name] = sortable;
    useLayoutEffect(() => {
      if (name === "b")
        seen.push({
          target: sortable.dropTarget?.id ?? null,
          content: sortable.incoming?.content ?? null,
        });
    });
    return createElement(
      "div",
      {
        "data-bar": name,
        ref: (element: HTMLDivElement | null) => {
          sortable.setContainerRef(element);
          if (element)
            element.getBoundingClientRect = () =>
              new DOMRect(0, TOP[name], 200, 30);
        },
      },
      ITEMS[name].map((id, index) =>
        createElement(
          "button",
          {
            key: id,
            "data-id": id,
            ref: (element: HTMLButtonElement | null) => {
              sortable.setItemRef(id, element);
              if (!element) return;
              element.getBoundingClientRect = () =>
                new DOMRect(index * 100, TOP[name], 100, 30);
              element.setPointerCapture = vi.fn();
              element.releasePointerCapture = vi.fn();
            },
            onPointerDown: (event) => sortable.onItemPointerDown(id, event),
          },
          id,
        ),
      ),
    );
  }

  const link = (extra: Partial<SortableLink> = {}): SortableLink => ({
    channel: "tabs",
    describe: (moving) => `content of ${moving}`,
    ...extra,
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    now = 1000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    restoreClock = () => clock.mockRestore();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    frames = new Map();
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    bars = {};
    seen = [];
    reorders = { a: vi.fn(), b: vi.fn() };
    options = {
      a: {
        dropOnDelay: 200,
        onDragMove: vi.fn(),
        onDragEnd: vi.fn(() => false),
        onDropOnItem: vi.fn(),
        link: link(),
      },
      b: {
        dropOnDelay: 200,
        onDropOnItem: vi.fn(),
        link: link({
          accepts: (moving, target) => !(moving === "a2" && target === "b2"),
          onDrop: vi.fn(),
        }),
      },
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    restoreClock();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement(Bar, { name: "a" }),
          createElement(Bar, { name: "b" }),
        ),
      ),
    );
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
  /** Move the held pointer to (x, y) and let the drag's frame run. */
  async function hold(x: number, y: number) {
    await pointer(window, "pointermove", x, y);
    await flushFrame();
  }
  /** Press a1 and carry it out of bar A. */
  async function lift(id = "a1") {
    await render();
    const item = container.querySelector(`[data-id="${id}"]`)!;
    await pointer(item, "pointerdown", id === "a1" ? 50 : 150, 15);
    await hold(50, 60);
  }

  it("drops onto another bar's item let go on its middle, armed or not", async () => {
    await lift();
    // Over b1's middle (25–75), let go at once: no rest.
    await hold(50, 115);
    expect(bars.b.dropTarget).toBeNull();
    await pointer(window, "pointerup", 50, 115);
    expect(options.b.link!.onDrop).toHaveBeenCalledExactlyOnceWith("a1", "b1");
    // The bar dragging only tidies up: its drag ends cancelled, and it
    // neither reorders nor drops onto its own items.
    expect(options.a.onDragEnd).toHaveBeenLastCalledWith("a1", 50, 115, true, {
      screenX: 0,
      screenY: 0,
    });
    expect(reorders.a).not.toHaveBeenCalled();
    expect(options.a.onDropOnItem).not.toHaveBeenCalled();
    expect(options.b.onDropOnItem).not.toHaveBeenCalled();
    // Bar B drew the preview before the drop, and none after it.
    expect(seen.some((render) => render.target === "b1")).toBe(true);
    expect(bars.b.dropTarget).toBeNull();
    expect(bars.b.incoming).toBeNull();
  });

  it("previews the join on the other bar's item once the pointer rests there", async () => {
    await lift();
    await hold(50, 115);
    // On b1's middle a release joins it: at once, what else it would do
    // shows nothing, and b1 shows a light hint; the preview waits.
    expect(bars.a.joining()).toBe(true);
    expect(bars.b.joinHint).toBe("b1");
    expect(bars.b.dropTarget).toBeNull();
    now += 200;
    await hold(51, 115);
    expect(bars.b.dropTarget).toEqual({ kind: "tab", id: "b1", allowed: true });
    expect(bars.b.incoming?.content).toBe("content of a1");
    // The dragging bar previews nothing of its own.
    expect(bars.a.dropTarget).toBeNull();
    // Off the middle, the preview plays out while the drag goes on.
    await hold(95, 115);
    expect(bars.b.dropTarget).toBeNull();
    expect(bars.b.incoming).toEqual({
      moving: "a1",
      content: "content of a1",
      target: null,
      over: null,
    });
    expect(bars.b.joinHint).toBeNull();
    expect(bars.a.joining()).toBe(false);
    await pointer(window, "pointerup", 95, 115);
    expect(options.b.link!.onDrop).not.toHaveBeenCalled();
    expect(bars.b.incoming).toBeNull();
  });

  it("never previews a quick pass across the other bar's items", async () => {
    await lift();
    for (let x = 30; x <= 170; x += 20) {
      now += 15;
      await hold(x, 115);
    }
    await hold(150, 60);
    await pointer(window, "pointerup", 150, 60);
    expect(seen.every((render) => render.target === null)).toBe(true);
    expect(options.b.link!.onDrop).not.toHaveBeenCalled();
  });

  it("leaves the other bar's edges, and items it refuses, to whatever else takes the drop", async () => {
    await lift();
    // b1's outer quarter: not a join.
    await hold(10, 115);
    now += 500;
    await hold(10, 115);
    expect(bars.a.joining()).toBe(false);
    await pointer(window, "pointerup", 10, 115);
    expect(options.b.link!.onDrop).not.toHaveBeenCalled();
    expect(options.a.onDragEnd).toHaveBeenLastCalledWith("a1", 10, 115, false, {
      screenX: 0,
      screenY: 0,
    });
    // b2 refuses a2.
    await lift("a2");
    await hold(150, 115);
    await pointer(window, "pointerup", 150, 115);
    expect(options.b.link!.onDrop).not.toHaveBeenCalled();
  });

  it("ends the other bar's preview on Escape, dropping nothing", async () => {
    await lift();
    await hold(50, 115);
    now += 200;
    await hold(50, 115);
    expect(bars.b.dropTarget?.id).toBe("b1");
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(options.b.link!.onDrop).not.toHaveBeenCalled();
    expect(bars.b.dropTarget).toBeNull();
    expect(bars.b.incoming).toBeNull();
  });
});
