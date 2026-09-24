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

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    observers = [];
    frames = new Map();
    frameId = 0;
    firstTop = 0;
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
    content = document.createElement("div");
    scroller.append(content);
    container = document.createElement("div");
    pane.append(scroller, container);
    document.body.append(pane);
    scope = { current: pane };
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 400 },
    });
    scroller.scrollTop = 400;
    vi.spyOn(scroller, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 100, 600, 400),
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
});
