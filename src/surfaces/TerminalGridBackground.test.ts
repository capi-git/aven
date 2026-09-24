// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalGridBackground } from "./TerminalGridBackground";
import { GRID_GAMES, SLIDE_HOLD_MS } from "./gridGames";

vi.mock("./gridGames", async (importOriginal) => {
  const original = await importOriginal<typeof import("./gridGames")>();
  return {
    ...original,
    GRID_GAMES: original.GRID_GAMES.map((game) => ({
      ...game,
      create: vi.fn(() => {
        let controlled = false;
        return {
          resize: vi.fn(),
          step: vi.fn(),
          stamp: vi.fn(),
          controlled: () => controlled,
          takeControl: vi.fn(() => {
            controlled = true;
          }),
          releaseControl: vi.fn(() => {
            controlled = false;
          }),
          setMode: vi.fn(),
          steer: vi.fn(),
          score: () => 0,
          lives: () => 3,
          fade: () => 1,
          logoPickup: () => null,
          sprites: () => [],
          speechBubble: () => null,
        };
      }),
    })),
  };
});

let root: Root;
let host: HTMLDivElement;
let hidden = false;
let reduced = false;
let now = 0;
let nextFrame = 0;
let frames: Map<number, FrameRequestCallback>;
let motion: EventTarget & { readonly matches: boolean };
let resize: ResizeObserverCallback;

const board = (index: number) =>
  vi.mocked(GRID_GAMES[index]!.create).mock.results[0]!.value;
const render = async (visible: boolean) => {
  await act(async () =>
    root.render(createElement(TerminalGridBackground, { visible })),
  );
};
const frame = async (time: number) => {
  now = time;
  const pending = [...frames.values()];
  frames.clear();
  await act(async () => pending.forEach((callback) => callback(time)));
};
const setHidden = async (value: boolean) => {
  hidden = value;
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
};
const selectGame = async (index: number) => {
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        `[aria-label="${GRID_GAMES[index]!.label}"]`,
      )!
      .click(),
  );
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hidden = false;
  reduced = false;
  now = 0;
  nextFrame = 0;
  frames = new Map();
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  motion = Object.assign(new EventTarget(), {
    get matches() {
      return reduced;
    },
  });
  Object.defineProperty(motion, "matches", { get: () => reduced });
  vi.stubGlobal("matchMedia", () => motion);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 140,
    height: 70,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 140,
    bottom: 70,
    toJSON: () => ({}),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        setTransform: vi.fn(),
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
      }) as unknown as CanvasRenderingContext2D,
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("retained workspace arcade rendering", () => {
  it("does no work while hidden and resumes the same boards without resizing or catching up elapsed time", async () => {
    await render(false);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(board(0).resize).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(SLIDE_HOLD_MS * 2));
    expect(board(0).step).not.toHaveBeenCalled();

    await render(true);
    await frame(33);
    const active = board(0);
    expect(active.step).toHaveBeenCalledExactlyOnceWith(33);
    expect(active.resize).toHaveBeenCalledTimes(1);
    expect(board(1).step).not.toHaveBeenCalled();
    expect(board(1).resize).not.toHaveBeenCalled();
    expect(host.querySelectorAll("canvas")[1]!.width).toBe(300);
    const canvas = host.querySelector("canvas");

    await render(false);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => resize([], {} as ResizeObserver));
    await setHidden(true);
    await setHidden(false);
    expect(frames.size).toBe(0);
    await act(async () => vi.advanceTimersByTime(SLIDE_HOLD_MS * 2));
    expect(active.step).toHaveBeenCalledTimes(1);
    expect(active.resize).toHaveBeenCalledTimes(1);

    await render(true);
    await frame(100_000);
    expect(host.querySelector("canvas")).toBe(canvas);
    expect(GRID_GAMES[0]!.create).toHaveBeenCalledTimes(1);
    expect(active.resize).toHaveBeenCalledTimes(1);
    expect(active.step).toHaveBeenLastCalledWith(33);
    expect(active.step).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(1);
  });

  it("pauses both animation and carousel when the document hides, then restarts them once", async () => {
    await render(true);
    await frame(33);
    expect(vi.getTimerCount()).toBe(1);
    await setHidden(true);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTime(SLIDE_HOLD_MS * 2));
    expect(
      host.querySelector('[aria-pressed="true"]')?.getAttribute("aria-label"),
    ).toBe(GRID_GAMES[0]!.label);
    await setHidden(false);
    await setHidden(false);
    expect(frames.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    await frame(40_000);
    expect(board(0).step).toHaveBeenLastCalledWith(33);
    await act(async () => vi.advanceTimersByTime(SLIDE_HOLD_MS));
    expect(
      host.querySelector('[aria-pressed="true"]')?.getAttribute("aria-label"),
    ).toBe(GRID_GAMES[1]!.label);
  });

  it("paints only the current board and both visible boards during a slide", async () => {
    await render(true);
    await frame(33);
    expect(board(0).step).toHaveBeenCalledTimes(1);
    expect(board(1).step).not.toHaveBeenCalled();
    await selectGame(1);
    await frame(66);
    expect(board(0).step).toHaveBeenCalledTimes(2);
    expect(board(1).step).toHaveBeenCalledTimes(1);
    await frame(800);
    expect(board(0).step).toHaveBeenCalledTimes(2);
    expect(board(1).step).toHaveBeenCalledTimes(2);
    const firstStamp = vi.mocked(board(1).stamp).mock.calls[0]![0];
    expect(vi.mocked(board(1).stamp).mock.calls[1]![0]).toBe(firstStamp);
  });

  it("keeps idle reduced-motion artwork static while explicit play remains interactive and pauses offscreen", async () => {
    reduced = true;
    await render(true);
    await frame(33);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await selectGame(1);
    await frame(66);
    expect(board(0).step).toHaveBeenCalledTimes(1);
    expect(board(1).step).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);

    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("take control"))!
        .click(),
    );
    await frame(99);
    expect(board(1).takeControl).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);
    await render(false);
    expect(frames.size).toBe(0);
    await render(true);
    await frame(10_000);
    expect(board(1).takeControl).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    await frame(10_033);
    expect(board(1).releaseControl).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it("responds to a changed motion preference without waking a hidden workspace", async () => {
    await render(true);
    await frame(33);
    reduced = true;
    await act(async () => motion.dispatchEvent(new Event("change")));
    await frame(66);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await render(false);
    reduced = false;
    await act(async () => motion.dispatchEvent(new Event("change")));
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await render(true);
    expect(frames.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
  });
});
