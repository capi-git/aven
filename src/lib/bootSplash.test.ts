// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { activateWindowAppearance } from "./appearance";
import { useBootSplashReady } from "./bootSplash";

vi.mock("./appearance", () => ({ activateWindowAppearance: vi.fn() }));

let root: Root;
let host: HTMLDivElement;
let recovery: HTMLDivElement;

function View({ ready, native = false }: { ready: boolean; native?: boolean }) {
  useBootSplashReady(ready, native);
  return ready ? createElement("main", null, "Themed workspace") : null;
}

const render = (ready: boolean, native = false) =>
  act(() =>
    root.render(
      createElement(StrictMode, null, createElement(View, { ready, native })),
    ),
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  recovery = document.createElement("div");
  recovery.id = "boot-splash";
  recovery.hidden = true;
  document.body.append(host, recovery);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  recovery.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("leaves recovery hidden while state loads and removes it in the workspace's first commit", () => {
  render(false);
  expect(recovery.hidden).toBe(true);
  expect(recovery.dataset.dismissed).toBeUndefined();
  expect(activateWindowAppearance).not.toHaveBeenCalled();
  render(true);
  expect(host.textContent).toBe("Themed workspace");
  expect(document.getElementById("boot-splash")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  expect(activateWindowAppearance).not.toHaveBeenCalled();
});

it("does not wait for animation frames or a fade to activate native appearance", () => {
  const frame = vi.fn();
  vi.stubGlobal("requestAnimationFrame", frame);
  render(true, true);
  expect(recovery.isConnected).toBe(false);
  expect(activateWindowAppearance).toHaveBeenCalledOnce();
  expect(frame).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("activates native appearance once under StrictMode and repeated ready renders", () => {
  render(true, true);
  render(true, true);
  expect(activateWindowAppearance).toHaveBeenCalledOnce();
});

it("leaves an existing startup failure in control of its appearance", () => {
  recovery.remove();
  render(true, true);
  expect(activateWindowAppearance).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
