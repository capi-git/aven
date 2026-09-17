// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { activateWindowAppearance } from "./appearance";
import { useBootSplashReady } from "./bootSplash";

vi.mock("./appearance", () => ({ activateWindowAppearance: vi.fn() }));

let root: Root;
let host: HTMLDivElement;
let splash: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

function View({ ready, native = false }: { ready: boolean; native?: boolean }) {
  useBootSplashReady(ready, native);
  return createElement("main", null, ready ? "Themed content" : "Loading");
}

const render = (ready: boolean, native = false) =>
  act(() =>
    root.render(
      createElement(StrictMode, null, createElement(View, { ready, native })),
    ),
  );

const paint = () => {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(performance.now()));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  host = document.createElement("div");
  splash = document.createElement("div");
  splash.id = "boot-splash";
  document.body.append(host, splash);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  splash.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps the cover while state is loading, then reveals committed content after two frames", () => {
  render(false);
  vi.advanceTimersByTime(1000);
  expect(splash.dataset.dismissed).toBeUndefined();
  expect(frames.size).toBe(0);
  render(true);
  expect(host.textContent).toBe("Themed content");
  expect(splash.classList.contains("boot-splash-out")).toBe(false);
  paint();
  expect(splash.classList.contains("boot-splash-out")).toBe(false);
  paint();
  expect(splash.classList.contains("boot-splash-out")).toBe(true);
  vi.advanceTimersByTime(180);
  expect(document.getElementById("boot-splash")).toBeNull();
  expect(activateWindowAppearance).not.toHaveBeenCalled();
});

it("bounds the wait when an inactive child receives no animation frames", () => {
  render(true);
  vi.advanceTimersByTime(249);
  expect(splash.classList.contains("boot-splash-out")).toBe(false);
  vi.advanceTimersByTime(1);
  expect(splash.classList.contains("boot-splash-out")).toBe(true);
  expect(frames.size).toBe(0);
  vi.advanceTimersByTime(180);
  expect(splash.isConnected).toBe(false);
  expect(activateWindowAppearance).not.toHaveBeenCalled();
});

it("preserves main-window native activation once under StrictMode and repeated ready renders", () => {
  render(true, true);
  expect(activateWindowAppearance).not.toHaveBeenCalled();
  expect(frames.size).toBe(1);
  render(true, true);
  paint();
  paint();
  vi.advanceTimersByTime(1000);
  expect(activateWindowAppearance).toHaveBeenCalledOnce();
});

it("does not activate native appearance when startup failure already removed the cover", () => {
  splash.remove();
  render(true, true);
  vi.advanceTimersByTime(1000);
  expect(frames.size).toBe(0);
  expect(activateWindowAppearance).not.toHaveBeenCalled();
});
