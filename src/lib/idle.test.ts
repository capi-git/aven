// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { whenIdle } from "./idle";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("waits for startup to settle where WebKit has no idle callback", () => {
  vi.stubGlobal("requestIdleCallback", undefined);
  const task = vi.fn();
  whenIdle(task);
  vi.advanceTimersByTime(1_499);
  expect(task).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(task).toHaveBeenCalledTimes(1);

  const cancelled = vi.fn();
  whenIdle(cancelled)();
  vi.advanceTimersByTime(5_000);
  expect(cancelled).not.toHaveBeenCalled();
});

it("then waits for idle time where the browser reports it", () => {
  const idle: (() => void)[] = [];
  const requestIdleCallback = vi.fn((callback: () => void) => {
    idle.push(callback);
    return idle.length;
  });
  const cancelIdleCallback = vi.fn();
  vi.stubGlobal("requestIdleCallback", requestIdleCallback);
  vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
  const task = vi.fn();
  const cancel = whenIdle(task);
  vi.advanceTimersByTime(1_500);
  expect(requestIdleCallback).toHaveBeenCalledWith(task, { timeout: 1_500 });
  expect(task).not.toHaveBeenCalled();
  idle[0]!();
  expect(task).toHaveBeenCalledTimes(1);

  cancel();
  expect(cancelIdleCallback).toHaveBeenCalledWith(1);
});
