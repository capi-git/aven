// @vitest-environment happy-dom
import { act, createElement, StrictMode, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../lib/session";
import { PromptOutline } from "./PromptOutline";

type Observer = {
  callback: () => void;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

const blocks: Block[] = [
  { id: "first", role: "user", text: "First prompt" },
  { id: "reply", role: "assistant", text: "First reply" },
  { id: "second", role: "user", text: "Second prompt" },
];

describe("retained prompt outline", () => {
  let root: Root;
  let scope: RefObject<HTMLElement | null>;
  let container: HTMLDivElement;
  let scroller: HTMLDivElement;
  let content: HTMLDivElement;
  let observers: Observer[];
  let frames: Map<number, FrameRequestCallback>;
  let frameId: number;
  let firstTop: number;
  let totalHeight: number;
  let viewportHeight: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    observers = [];
    frames = new Map();
    frameId = 0;
    firstTop = 0;
    totalHeight = 800;
    viewportHeight = 400;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        constructor(public callback: () => void) {
          observers.push(this);
        }
      },
    );
    const pane = document.createElement("section");
    scroller = document.createElement("div");
    scroller.className = "agent-transcript";
    scroller.id = "chat-transcript";
    content = document.createElement("div");
    scroller.append(content);
    container = document.createElement("div");
    pane.append(scroller, container);
    document.body.append(pane);
    scope = { current: pane };
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, get: () => totalHeight },
      clientHeight: { configurable: true, get: () => viewportHeight },
    });
    scroller.scrollTop = 400;
    vi.spyOn(scroller, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 100, 600, viewportHeight),
    );
    for (const [index, id] of ["first", "second"].entries()) {
      const turn = document.createElement("div");
      turn.className = "transcript-turn";
      const anchor = document.createElement("div");
      anchor.dataset.promptAnchor = id;
      turn.append(anchor);
      content.append(turn);
      const top = () => 100 + index * 400 + firstTop - scroller.scrollTop;
      vi.spyOn(turn, "getBoundingClientRect").mockImplementation(
        () => new DOMRect(0, top(), 600, 400),
      );
      vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(
        () => new DOMRect(0, top(), 600, 40),
      );
    }
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    scope.current?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function render(visible: boolean, nextBlocks = blocks, strict = false) {
    const outline = createElement(PromptOutline, {
      blocks: nextBlocks,
      scope,
      visible,
    });
    await act(async () =>
      root.render(strict ? createElement(StrictMode, {}, outline) : outline),
    );
  }

  async function frame() {
    const pending = [...frames.values()];
    frames.clear();
    await act(async () => pending.forEach((callback) => callback(0)));
  }

  const bar = (id: string) =>
    container.querySelector<HTMLButtonElement>(`[data-prompt-bar="${id}"]`)!;
  const current = () =>
    container.querySelector<HTMLElement>("[aria-current=true]")?.dataset
      .promptBar;
  const preview = () => document.querySelector("[aria-label='Prompt preview']");
  const outlineObservers = () =>
    observers.filter((observer) =>
      observer.observe.mock.calls.some(([target]) => target === scroller),
    );

  const scrollbar = () =>
    container.querySelector<HTMLElement>("[role=scrollbar]");
  function dragTrack() {
    const rail = container.querySelector<HTMLElement>(".prompt-outline")!;
    vi.spyOn(rail, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(576, 150, 24, 300),
    );
    Object.defineProperty(rail, "clientHeight", {
      configurable: true,
      value: 300,
    });
    const captured = new Set<number>();
    rail.setPointerCapture = vi.fn((id: number) => captured.add(id));
    rail.hasPointerCapture = vi.fn((id: number) => captured.has(id));
    rail.releasePointerCapture = vi.fn((id: number) => captured.delete(id));
    return rail;
  }
  async function pointer(
    target: EventTarget,
    type: string,
    y: number,
    pointerId = 1,
    button = 0,
  ) {
    const event = new PointerEvent(type, {
      clientY: y,
      clientX: 590,
      pointerId,
      button,
      isPrimary: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => target.dispatchEvent(event));
    return event;
  }

  async function wheel(target: EventTarget, init: WheelEventInit) {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    // happy-dom's WheelEvent omits MouseEvent's modifier properties.
    Object.defineProperties(event, {
      ctrlKey: { value: init.ctrlKey ?? false },
      metaKey: { value: init.metaKey ?? false },
    });
    await act(async () => target.dispatchEvent(event));
    return event;
  }

  async function hover(id: string) {
    await act(async () =>
      bar(id).dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    );
  }

  it("does no observer or frame work for hidden streaming chats with retained dimensions", async () => {
    await render(false);
    await render(false, [
      ...blocks,
      { id: "latest", role: "user", text: "Latest prompt" },
    ]);
    scroller.dispatchEvent(new Event("scroll"));
    expect(observers).toHaveLength(0);
    expect(frames.size).toBe(0);
    expect(scroller.getBoundingClientRect).not.toHaveBeenCalled();
    expect(container.childElementCount).toBe(0);

    await render(true, [
      ...blocks,
      { id: "latest", role: "user", text: "Latest prompt" },
    ]);
    expect(outlineObservers()).toHaveLength(1);
    expect(
      outlineObservers()[0].observe.mock.calls.map(([target]) => target),
    ).toEqual([scroller, content]);
    expect(frames.size).toBe(1);
    await frame();
    expect(current()).toBe("latest");
  });

  it("detaches and cancels on hide, then remeasures the current scroll position on show", async () => {
    await render(true);
    await frame();
    expect(current()).toBe("second");
    const observer = outlineObservers()[0];
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll"));
    observer.callback();
    expect(frames.size).toBe(1);
    await render(false);
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    const reads = vi.mocked(scroller.getBoundingClientRect).mock.calls.length;
    scroller.dispatchEvent(new Event("scroll"));
    observer.callback();
    await render(false, [...blocks]);
    expect(frames.size).toBe(0);
    expect(scroller.getBoundingClientRect).toHaveBeenCalledTimes(reads);

    await render(true);
    await frame();
    expect(current()).toBe("first");
    observer.callback();
    expect(frames.size).toBe(0);
    outlineObservers()[1].callback();
    expect(frames.size).toBe(1);
  });

  it("cancels pending hover previews and clears open portalled previews when hidden", async () => {
    await render(true);
    await frame();
    await hover("first");
    expect(vi.getTimerCount()).toBe(1);
    await render(false);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTime(30));
    await render(true);
    expect(preview()).toBeNull();
    await hover("first");
    await act(async () => vi.advanceTimersByTime(30));
    expect(preview()?.textContent).toContain("First reply");
    await render(false);
    expect(preview()).toBeNull();
    await render(true);
    expect(preview()).toBeNull();
  });

  it("preserves prompt navigation but cancels deferred alignment while hidden", async () => {
    firstTop = 80;
    const wheel = vi.fn();
    scroller.addEventListener("wheel", wheel);
    await render(true);
    await frame();
    await act(async () => bar("first").click());
    expect(wheel).toHaveBeenCalledOnce();
    expect((wheel.mock.calls[0][0] as WheelEvent).deltaY).toBe(-1);
    expect(scroller.scrollTop).toBe(72);
    expect(frames.size).toBe(1);
    await render(false);
    firstTop = 120;
    expect(frames.size).toBe(0);
    await frame();
    expect(scroller.scrollTop).toBe(72);

    await render(true);
    await frame();
    await act(async () => bar("first").click());
    expect(scroller.scrollTop).toBe(112);
    firstTop = 160;
    await frame();
    expect(scroller.scrollTop).toBe(152);
  });

  it("retains the keyboard selection across hiding and keeps arrow navigation working", async () => {
    await render(true);
    await frame();
    await act(async () =>
      bar("second").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(bar("first"));
    await render(false);
    await render(true);
    expect(bar("first").tabIndex).toBe(0);
    await act(async () =>
      bar("first").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(bar("second"));
  });

  it("keeps one subscription after Strict Mode replay and cleans up pending work on unmount", async () => {
    await render(true, blocks, true);
    expect(
      outlineObservers().filter(
        (observer) => observer.disconnect.mock.calls.length === 0,
      ),
    ).toHaveLength(1);
    expect(frames.size).toBe(1);
    await frame();
    await hover("first");
    await act(async () => bar("first").click());
    expect(frames.size).toBe(1);
    await act(async () => root.render(null));
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    for (const observer of outlineObservers()) observer.callback();
    expect(frames.size).toBe(0);
  });

  it("keeps click navigation and hover ripples while ignoring sub-threshold pointer movement", async () => {
    firstTop = 80;
    await render(true);
    await frame();
    const rail = dragTrack();
    const intent = vi.fn();
    scroller.addEventListener("aven-transcript-scroll-drag", intent);
    await hover("first");
    await act(async () => vi.advanceTimersByTime(30));
    expect(preview()).not.toBeNull();
    expect(bar("first").firstElementChild?.getAttribute("style")).toContain(
      "width: 24px",
    );
    await pointer(bar("first"), "pointerdown", 200);
    expect((await pointer(window, "pointermove", 198)).defaultPrevented).toBe(
      false,
    );
    await pointer(window, "pointerup", 198);
    expect(intent).not.toHaveBeenCalled();
    expect(rail.setPointerCapture).not.toHaveBeenCalled();
    await act(async () => bar("first").click());
    expect(scroller.scrollTop).toBe(72);
  });

  it("drags smoothly outside the rail, suppresses the release click, and keeps wheel defaults", async () => {
    await render(true);
    await frame();
    const rail = dragTrack();
    const intents: boolean[] = [];
    scroller.addEventListener("aven-transcript-scroll-drag", (event) =>
      intents.push((event as CustomEvent<boolean>).detail),
    );
    await hover("first");
    await act(async () => vi.advanceTimersByTime(30));
    await pointer(bar("first"), "pointerdown", 250);
    const movement = await pointer(window, "pointermove", 175);
    expect(movement.defaultPrevented).toBe(true);
    expect(scroller.scrollTop).toBe(200);
    expect(rail.dataset.dragging).toBe("true");
    expect(rail.setPointerCapture).toHaveBeenCalledWith(1);
    expect(preview()).toBeNull();
    const wheel = new WheelEvent("wheel", {
      deltaY: -50,
      bubbles: true,
      cancelable: true,
    });
    scroller.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    await frame();
    expect(scrollbar()?.getAttribute("aria-valuenow")).toBe("50");
    await pointer(window, "pointerup", 175);
    expect(intents).toEqual([true, false]);
    expect(rail.releasePointerCapture).toHaveBeenCalledWith(1);
    const click = new MouseEvent("click", {
      detail: 1,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => bar("first").dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
    expect(scroller.scrollTop).toBe(200);
    expect(rail.dataset.dragging).toBeUndefined();
  });

  it("ignores other pointers and non-primary buttons and clamps overscroll", async () => {
    await render(true);
    await frame();
    const rail = dragTrack();
    await pointer(rail, "pointerdown", 200, 1, 2);
    await pointer(window, "pointermove", 0);
    expect(scroller.scrollTop).toBe(400);
    await pointer(bar("second"), "pointerdown", 200);
    await pointer(window, "pointermove", 100, 2);
    expect(scroller.scrollTop).toBe(400);
    await pointer(window, "pointermove", -1000);
    expect(scroller.scrollTop).toBe(0);
    await pointer(window, "pointermove", 1000);
    expect(scroller.scrollTop).toBe(400);
  });

  it.each(["pointercancel", "lostpointercapture"])(
    "cleans up %s and stops moving after cancellation",
    async (type) => {
      await render(true);
      await frame();
      const rail = dragTrack();
      const intent = vi.fn();
      scroller.addEventListener("aven-transcript-scroll-drag", intent);
      await pointer(bar("first"), "pointerdown", 200);
      await pointer(window, "pointermove", 125);
      await pointer(type === "lostpointercapture" ? rail : window, type, 125);
      const stopped = scroller.scrollTop;
      await pointer(window, "pointermove", 0);
      expect(scroller.scrollTop).toBe(stopped);
      expect(rail.dataset.dragging).toBeUndefined();
      expect(intent.mock.calls.map(([event]) => event.detail)).toEqual([
        true,
        false,
      ]);
    },
  );

  it("ends dragging and releases capture when the retained chat hides", async () => {
    await render(true);
    await frame();
    const rail = dragTrack();
    const intent = vi.fn();
    scroller.addEventListener("aven-transcript-scroll-drag", intent);
    await pointer(bar("first"), "pointerdown", 200);
    await pointer(window, "pointermove", 125);
    await render(false);
    const stopped = scroller.scrollTop;
    await pointer(window, "pointermove", 0);
    expect(scroller.scrollTop).toBe(stopped);
    expect(rail.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(intent.mock.calls.map(([event]) => event.detail)).toEqual([
      true,
      false,
    ]);
    expect(frames.size).toBe(0);
  });

  it("shows a real scroll control for overflowing chats with zero or one prompt", async () => {
    await render(true, [blocks[0], blocks[1]]);
    await frame();
    expect(scrollbar()?.getAttribute("aria-controls")).toBe("chat-transcript");
    expect(scrollbar()?.getAttribute("aria-valuenow")).toBe("100");
    expect(scrollbar()?.style.height).toBe("150px");
    await render(true, [blocks[1]]);
    await frame();
    expect(scrollbar()).not.toBeNull();
    expect(container.querySelectorAll("[data-prompt-bar]")).toHaveLength(0);
    totalHeight = viewportHeight;
    scroller.scrollTop = 0;
    outlineObservers()[0].callback();
    await frame();
    expect(scrollbar()).toBeNull();
    expect(container.childElementCount).toBe(0);
  });

  it("recomputes position and thumb size after content growth and viewport resize", async () => {
    await render(true);
    await frame();
    totalHeight = 1600;
    outlineObservers()[0].callback();
    await frame();
    expect(scrollbar()?.style.height).toBe("75px");
    expect(scrollbar()?.getAttribute("aria-valuenow")).toBe("33");
    viewportHeight = 200;
    outlineObservers()[0].callback();
    await frame();
    expect(scrollbar()?.style.height).toBe("24px");
    expect(
      container.querySelector<HTMLElement>(".prompt-outline")?.style.height,
    ).toBe("150px");
    scroller.scrollTop = 1400;
    scroller.dispatchEvent(new Event("scroll"));
    await frame();
    expect(scrollbar()?.getAttribute("aria-valuenow")).toBe("100");
    expect(scrollbar()?.style.top).toBe("126px");
  });

  it("uses logical height for its track and painted pointer distances at CSS zoom", async () => {
    vi.mocked(scroller.getBoundingClientRect).mockImplementation(
      () => new DOMRect(0, 100, 900, viewportHeight * 1.5),
    );
    await render(true);
    await frame();
    const rail = dragTrack();
    rail.style.zoom = "1.5";
    vi.mocked(rail.getBoundingClientRect).mockImplementation(
      () => new DOMRect(876, 150, 36, 450),
    );
    expect(rail.style.height).toBe("300px");
    expect(scrollbar()?.style.height).toBe("150px");
    await pointer(bar("first"), "pointerdown", 300);
    await pointer(window, "pointermove", 187.5);
    expect(scroller.scrollTop).toBe(200);
    await pointer(window, "pointerup", 187.5);
  });

  it("keeps a gesture stable as live content grows and remeasures its thumb", async () => {
    await render(true);
    await frame();
    dragTrack();
    await pointer(bar("first"), "pointerdown", 250);
    await pointer(window, "pointermove", 212.5);
    expect(scroller.scrollTop).toBe(300);
    totalHeight = 1600;
    outlineObservers()[0].callback();
    await frame();
    expect(scrollbar()?.style.height).toBe("75px");
    await pointer(window, "pointermove", 175);
    // Appended output cannot change the pointer-to-scroll ratio mid-gesture.
    expect(scroller.scrollTop).toBe(200);
    await pointer(window, "pointerup", 175);
  });

  it("clears the hover ripple after releasing a drag outside the rail", async () => {
    await render(true);
    await frame();
    const rail = dragTrack();
    await hover("first");
    await pointer(bar("first"), "pointerdown", 200);
    await pointer(window, "pointermove", 125);
    await act(async () =>
      rail.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      ),
    );
    await pointer(window, "pointerup", 125);
    expect(bar("first").firstElementChild?.getAttribute("style")).toContain(
      "width: 11px",
    );
    expect(bar("second").firstElementChild?.getAttribute("style")).toContain(
      "width: 11px",
    );
    expect(preview()).toBeNull();
  });

  it("cancels a drag on window blur and prevents a new pointer from taking it over", async () => {
    await render(true);
    await frame();
    const rail = dragTrack();
    await pointer(bar("first"), "pointerdown", 200);
    await pointer(rail, "pointerdown", 300, 2);
    await pointer(window, "pointermove", 225, 2);
    expect(scroller.scrollTop).toBe(400);
    await pointer(window, "pointermove", 125);
    expect(scroller.scrollTop).toBe(200);
    await act(async () => window.dispatchEvent(new Event("blur")));
    await pointer(window, "pointermove", 0);
    expect(scroller.scrollTop).toBe(200);
    expect(rail.dataset.dragging).toBeUndefined();
  });

  it("supports scrollbar arrow, page, Home and End keys without changing prompt roving focus", async () => {
    await render(true);
    await frame();
    const intents: boolean[] = [];
    scroller.addEventListener("aven-transcript-scroll-drag", (event) =>
      intents.push((event as CustomEvent<boolean>).detail),
    );
    for (const [key, expected] of [
      ["Home", 0],
      ["ArrowDown", 40],
      ["PageDown", 400],
      ["ArrowUp", 360],
      ["PageUp", 0],
      ["End", 400],
    ] as const) {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => scrollbar()!.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      expect(scroller.scrollTop).toBe(expected);
    }
    expect(intents).toEqual(Array(6).fill([true, false]).flat());
    expect(bar("second").tabIndex).toBe(0);
  });

  it("forwards vertical wheel only over the rail and notifies the chat before scrolling upward", async () => {
    await render(true);
    await frame();
    const rail = container.querySelector<HTMLElement>(".prompt-outline")!;
    const positions: number[] = [];
    const deltas: number[] = [];
    const dragIntent = vi.fn();
    scroller.addEventListener("aven-transcript-scroll-drag", dragIntent);
    scroller.addEventListener("wheel", (event) => {
      positions.push(scroller.scrollTop);
      deltas.push((event as WheelEvent).deltaY);
    });
    expect((await wheel(rail, { deltaY: -60 })).defaultPrevented).toBe(true);
    expect(scroller.scrollTop).toBe(340);
    expect(positions).toEqual([400]);
    expect(deltas).toEqual([-60]);
    await frame();
    expect(scrollbar()?.getAttribute("aria-valuenow")).toBe("85");
    expect((await wheel(rail, { deltaY: 1000 })).defaultPrevented).toBe(true);
    expect(scroller.scrollTop).toBe(400);
    expect((await wheel(rail, { deltaY: -1000 })).defaultPrevented).toBe(true);
    expect(scroller.scrollTop).toBe(0);
    expect(dragIntent).not.toHaveBeenCalled();
    expect((await wheel(scroller, { deltaY: -20 })).defaultPrevented).toBe(
      false,
    );
  });

  it("converts line, page, and painted pixel deltas and clamps at the chat edges", async () => {
    await render(true);
    await frame();
    const rail = container.querySelector<HTMLElement>(".prompt-outline")!;
    scroller.style.lineHeight = "23px";
    await wheel(rail, { deltaY: -2, deltaMode: 1 });
    expect(scroller.scrollTop).toBe(354);
    await wheel(rail, { deltaY: -1, deltaMode: 2 });
    expect(scroller.scrollTop).toBe(0);
    await wheel(rail, { deltaY: 1, deltaMode: 2 });
    expect(scroller.scrollTop).toBe(400);
    scroller.style.zoom = "1.5";
    await wheel(rail, { deltaY: -60 });
    expect(scroller.scrollTop).toBe(360);
    scroller.style.lineHeight = "normal";
    await wheel(rail, { deltaY: -2, deltaMode: 1 });
    expect(scroller.scrollTop).toBe(328);
  });

  it("leaves zoom shortcuts and horizontal wheel input untouched", async () => {
    await render(true);
    await frame();
    const rail = container.querySelector<HTMLElement>(".prompt-outline")!;
    const notification = vi.fn();
    scroller.addEventListener("wheel", notification);
    for (const init of [
      { deltaY: -40, ctrlKey: true },
      { deltaY: -40, metaKey: true },
      { deltaX: -40 },
      { deltaX: 80, deltaY: -40 },
    ]) {
      expect((await wheel(rail, init)).defaultPrevented).toBe(false);
    }
    expect(scroller.scrollTop).toBe(400);
    expect(notification).not.toHaveBeenCalled();
  });

  it("removes wheel forwarding when hidden or unmounted and attaches for a newly overflowing one-prompt chat", async () => {
    totalHeight = viewportHeight;
    scroller.scrollTop = 0;
    await render(true, [blocks[0]]);
    await frame();
    expect(container.querySelector(".prompt-outline")).toBeNull();
    totalHeight = 800;
    scroller.scrollTop = 200;
    outlineObservers()[0].callback();
    await frame();
    const rail = container.querySelector<HTMLElement>(".prompt-outline")!;
    expect((await wheel(rail, { deltaY: -20 })).defaultPrevented).toBe(true);
    expect(scroller.scrollTop).toBe(180);
    await render(false, [blocks[0]]);
    expect((await wheel(rail, { deltaY: -20 })).defaultPrevented).toBe(false);
    expect(scroller.scrollTop).toBe(180);
    await render(true, [blocks[0]]);
    await frame();
    const restored = container.querySelector<HTMLElement>(".prompt-outline")!;
    await act(async () => root.render(null));
    expect((await wheel(restored, { deltaY: -20 })).defaultPrevented).toBe(
      false,
    );
    expect(scroller.scrollTop).toBe(180);
    expect(frames.size).toBe(0);
  });
});
