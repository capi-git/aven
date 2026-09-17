// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSortable, type SortableOptions } from "./useSortable";

describe("useSortable external drops and cancellation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let sortable: ReturnType<typeof useSortable>;
  let onReorder: ReturnType<typeof vi.fn>;
  let options: SortableOptions;
  let ids: string[];
  let frames: Map<number, FrameRequestCallback>;
  let now: number;
  let restoreClock: () => void;

  function Harness() {
    sortable = useSortable(ids, onReorder, options);
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
              element.getBoundingClientRect = () =>
                options.axis === "y"
                  ? new DOMRect(0, index * 100, 30, 100)
                  : new DOMRect(index * 100, 0, 100, 30);
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

  beforeEach(() => {
    now = 1000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    restoreClock = () => clock.mockRestore();
    ids = ["session-a", "browser-a", "session-b"];
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
    vi.unstubAllGlobals();
  });

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
      { screenX: 0, screenY: 0 },
    );
    expect(document.body.style.cursor).toBe("");
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
      await pointer(window, "pointerup", 20, 15);
      expect(options.onDragEnd).toHaveBeenCalledOnce();
      expect(onReorder).not.toHaveBeenCalled();
    },
  );

  it("does not report a drag or consume a click below the activation threshold", async () => {
    await act(async () => root.render(createElement(Harness)));
    const handle = container.querySelector<HTMLButtonElement>(
      '[data-id="browser-a"]',
    )!;
    await pointer(handle, "pointerdown", 150, 15);
    await pointer(window, "pointermove", 152, 15);
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

  it.each(["pointercancel", "blur", "lostpointercapture", "Escape", "unmount"])(
    "clears an unpainted drag frame on %s",
    async (reason) => {
      const handle = await start(false);
      expect(frames.size).toBe(1);
      await act(async () => {
        if (reason === "unmount") root.render(null);
        else if (reason === "Escape")
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        else if (reason === "lostpointercapture")
          handle.dispatchEvent(new Event(reason));
        else window.dispatchEvent(new Event(reason));
      });
      expect(frames.size).toBe(0);
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
});
