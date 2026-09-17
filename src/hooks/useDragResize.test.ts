// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDragResize } from "./useDragResize";

describe("pane resize lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onCommit: ReturnType<typeof vi.fn>;
  let renders: ReturnType<typeof vi.fn>;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let geometry: ReturnType<typeof vi.fn>;
  function Pane({
    enabled = true,
    direction = "right",
  }: {
    enabled?: boolean;
    direction?: "left" | "right";
  }) {
    renders();
    const resize = useDragResize({
      enabled,
      direction,
      min: 260,
      max: () => 380,
      defaultWidth: 280,
      initial: 280,
      onCommit,
    });
    return createElement(
      "aside",
      { ref: resize.setPaneRef },
      createElement("div", {
        role: "separator",
        tabIndex: 0,
        onPointerDown: resize.onPointerDown,
      }),
    );
  }
  const handle = () =>
    container.querySelector<HTMLElement>('[role="separator"]')!;
  const width = () => container.querySelector("aside")!.style.width;
  const pointer = (type: string, clientX: number) =>
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      pointerId: 1,
      clientX,
    });
  const start = () =>
    act(() => handle().dispatchEvent(pointer("pointerdown", 400)));
  const flushFrame = () =>
    act(() => {
      const queued = [...frames.values()];
      frames.clear();
      queued.forEach((callback) => callback(0));
    });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    frames = new Map();
    nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.spyOn(HTMLElement.prototype, "setPointerCapture").mockImplementation(
      () => {},
    );
    vi.spyOn(HTMLElement.prototype, "releasePointerCapture").mockImplementation(
      () => {},
    );
    onCommit = vi.fn();
    renders = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    geometry = vi.fn(() => width());
    window.addEventListener("supermono:workspace-layout", geometry);
  });
  afterEach(() => {
    act(() => root.unmount());
    window.removeEventListener("supermono:workspace-layout", geometry);
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["left", "right"] as const)(
    "resizes toward the %s without rendering on every pointer move",
    async (direction) => {
      await act(async () => root.render(createElement(Pane, { direction })));
      start();
      renders.mockClear();
      const target = direction === "left" ? 350 : 450;
      act(() => window.dispatchEvent(pointer("pointermove", target)));
      flushFrame();
      expect(width()).toBe("330px");
      expect(renders).not.toHaveBeenCalled();
      expect(document.documentElement.classList.contains("is-resizing")).toBe(
        true,
      );
      act(() => window.dispatchEvent(pointer("pointerup", target)));
      expect(onCommit).toHaveBeenCalledExactlyOnceWith(330);
      expect(document.documentElement.classList.contains("is-resizing")).toBe(
        false,
      );
    },
  );

  it("coalesces pointer bursts and publishes painted geometry within 16ms when RAF stalls", async () => {
    await act(async () => root.render(createElement(Pane)));
    start();
    renders.mockClear();
    act(() => {
      for (let x = 401; x <= 470; x++)
        window.dispatchEvent(pointer("pointermove", x));
    });
    expect(width()).toBe("280px");
    expect(frames.size).toBe(1);
    expect(geometry).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(15));
    expect(width()).toBe("280px");
    act(() => vi.advanceTimersByTime(1));
    expect(width()).toBe("350px");
    expect(geometry).toHaveReturnedWith("350px");
    expect(geometry).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    expect(renders).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(100));
    expect(geometry).toHaveBeenCalledOnce();
  });

  it("cancels the timer when RAF wins and avoids repeated writes at a clamped width", async () => {
    await act(async () => root.render(createElement(Pane)));
    start();
    act(() => window.dispatchEvent(pointer("pointermove", 900)));
    flushFrame();
    expect(width()).toBe("380px");
    expect(geometry).toHaveBeenCalledOnce();
    act(() => {
      for (let x = 901; x < 950; x++)
        window.dispatchEvent(pointer("pointermove", x));
      vi.advanceTimersByTime(100);
    });
    expect(frames.size).toBe(0);
    expect(geometry).toHaveBeenCalledOnce();
  });

  it.each(["left", "right"] as const)(
    "commits the final %s release position even before a frame paints",
    async (direction) => {
      await act(async () => root.render(createElement(Pane, { direction })));
      start();
      const move = direction === "left" ? 390 : 410;
      const release = direction === "left" ? 330 : 470;
      act(() => window.dispatchEvent(pointer("pointermove", move)));
      act(() => window.dispatchEvent(pointer("pointerup", release)));
      expect(width()).toBe("350px");
      expect(onCommit).toHaveBeenCalledExactlyOnceWith(350);
      expect(geometry).toHaveReturnedWith("350px");
      expect(frames.size).toBe(0);
      act(() => vi.advanceTimersByTime(100));
      expect(geometry).toHaveBeenCalledOnce();
      expect(onCommit).toHaveBeenCalledOnce();
    },
  );

  it("cancels pending work without using pointercancel's synthetic coordinates", async () => {
    await act(async () => root.render(createElement(Pane)));
    start();
    act(() => window.dispatchEvent(pointer("pointermove", 450)));
    act(() => window.dispatchEvent(pointer("pointercancel", 0)));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(330);
    expect(width()).toBe("330px");
    expect(frames.size).toBe(0);
    act(() => {
      window.dispatchEvent(pointer("pointermove", 500));
      vi.advanceTimersByTime(100);
    });
    expect(geometry).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it("releases capture and pending callbacks when the pane unmounts", async () => {
    await act(async () => root.render(createElement(Pane)));
    start();
    act(() => window.dispatchEvent(pointer("pointermove", 450)));
    await act(async () => root.render(null));
    expect(frames.size).toBe(0);
    expect(document.documentElement.classList.contains("is-resizing")).toBe(
      false,
    );
    expect(HTMLElement.prototype.releasePointerCapture).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(330);
    geometry.mockClear();
    act(() => {
      vi.advanceTimersByTime(100);
      window.dispatchEvent(pointer("pointermove", 500));
      window.dispatchEvent(pointer("pointerup", 500));
    });
    expect(geometry).not.toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it.each(["blur", "lostpointercapture"])(
    "cleans up after %s so WebKit is not left paused",
    async (event) => {
      await act(async () => root.render(createElement(Pane)));
      start();
      act(() => window.dispatchEvent(pointer("pointermove", 450)));
      act(() =>
        (event === "blur" ? window : handle()).dispatchEvent(new Event(event)),
      );
      expect(document.documentElement.classList.contains("is-resizing")).toBe(
        false,
      );
      expect(document.documentElement.classList.contains("is-reordering")).toBe(
        false,
      );
      expect(onCommit).toHaveBeenCalledExactlyOnceWith(330);
      act(() => window.dispatchEvent(pointer("pointermove", 500)));
      expect(width()).toBe("330px");
      expect(onCommit).toHaveBeenCalledOnce();
    },
  );

  it("stops an active gesture when its panel closes", async () => {
    await act(async () => root.render(createElement(Pane)));
    start();
    act(() => window.dispatchEvent(pointer("pointermove", 500)));
    await act(async () => root.render(createElement(Pane, { enabled: false })));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(380);
    expect(document.documentElement.classList.contains("is-resizing")).toBe(
      false,
    );
    start();
    act(() => window.dispatchEvent(pointer("pointermove", 300)));
    expect(width()).toBe("380px");
    expect(onCommit).toHaveBeenCalledOnce();
  });
});
