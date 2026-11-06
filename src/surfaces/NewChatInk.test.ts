// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewChatInk } from "./NewChatInk";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let clock: number;
let putImageData: ReturnType<typeof vi.fn>;
let resized: (() => void)[];
let root: Root | null;
let container: HTMLDivElement;

function runFrames(limit = 2000) {
  let ran = 0;
  while (frames.size && ran < limit) {
    const [id, callback] = frames.entries().next().value!;
    frames.delete(id);
    clock += 1000 / 30;
    callback(clock);
    ran++;
  }
  return ran;
}

function Harness({ active, visible }: { active: boolean; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  return createElement(
    "div",
    { ref: host, "data-testid": "host" },
    createElement(NewChatInk, { host, active, visible }),
    createElement("button", { type: "button" }, "Send"),
  );
}

function render(props: { active: boolean; visible: boolean }) {
  act(() => root!.render(createElement(Harness, props)));
}

const host = () => container.querySelector<HTMLElement>("[data-testid=host]")!;
const ink = () => container.querySelector<HTMLElement>(".new-chat-ink");

function pointer(type: string, target: Element, x: number, y: number) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      button: 0,
      pointerType: "mouse",
    }),
  );
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  clock = 0;
  resized = [];
  putImageData = vi.fn();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => frames.delete(id)),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        createImageData: (width: number, height: number) => ({
          width,
          height,
          data: new Uint8ClampedArray(width * height * 4),
        }),
        putImageData,
      }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 600,
    height: 400,
  } as DOMRect);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("new chat ink", () => {
  it("draws on one small canvas, a pixel per 3px cell", () => {
    render({ active: true, visible: true });
    const canvas = container.querySelector("canvas")!;
    expect([canvas.width, canvas.height]).toEqual([200, 133]);
    expect(canvas.style.width).toBe("600px");
    expect(canvas.style.height).toBe("399px");
    expect(ink()?.getAttribute("aria-hidden")).toBe("true");
  });

  it("greets, then stops its frames once the ink is still", () => {
    render({ active: true, visible: true });
    expect(frames.size).toBe(1);
    const ran = runFrames();
    expect(ran).toBeGreaterThan(10);
    expect(ran).toBeLessThan(2000);
    expect(frames.size).toBe(0);
    expect(putImageData).toHaveBeenCalled();
  });

  it("wakes on a move and goes back to sleep by itself", () => {
    render({ active: true, visible: true });
    runFrames();
    pointer("pointermove", host(), 100, 100);
    pointer("pointermove", host(), 260, 140);
    expect(frames.size).toBe(1);
    runFrames();
    expect(frames.size).toBe(0);
  });

  it("leaves the ink alone when a control is pressed", () => {
    render({ active: true, visible: true });
    runFrames();
    pointer("pointerdown", container.querySelector("button")!, 300, 200);
    expect(frames.size).toBe(0);
    pointer("pointerdown", host(), 300, 200);
    expect(frames.size).toBe(1);
  });

  it("holds still while the chat is off screen or the window hidden", () => {
    render({ active: true, visible: false });
    expect(frames.size).toBe(0);
    pointer("pointermove", host(), 100, 100);
    pointer("pointermove", host(), 200, 100);
    expect(frames.size).toBe(0);

    render({ active: true, visible: true });
    expect(frames.size).toBe(1);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    runFrames();
    expect(frames.size).toBe(0);
    pointer("pointermove", host(), 300, 100);
    expect(frames.size).toBe(0);
  });

  it("fades out and goes once the chat has messages", () => {
    render({ active: true, visible: true });
    pointer("pointermove", host(), 100, 100);
    pointer("pointermove", host(), 200, 100);
    render({ active: false, visible: true });
    expect(ink()?.hasAttribute("data-leaving")).toBe(true);
    expect(frames.size).toBe(0);
    pointer("pointermove", host(), 300, 100);
    expect(frames.size).toBe(0);
    act(() => vi.advanceTimersByTime(600));
    expect(ink()).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("never appears for a chat that already has messages", () => {
    render({ active: false, visible: true });
    expect(ink()).toBeNull();
    expect(frames.size).toBe(0);
    expect(resized).toHaveLength(0);
  });
});
