// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { visibleInterval } from "./visibleInterval";
let hidden = false;
let cleanup: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function visibility(value: boolean) {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
}
it("stops every hidden tick and catches up to wall time immediately on resume", () => {
  const start = Date.now();
  const elapsed: number[] = [];
  cleanup = visibleInterval(() => elapsed.push(Date.now() - start), 1000);
  vi.advanceTimersByTime(2000);
  expect(elapsed).toEqual([0, 1000, 2000]);
  visibility(true);
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(60_000);
  expect(elapsed).toEqual([0, 1000, 2000]);
  visibility(false);
  expect(elapsed.at(-1)).toBe(62_000);
  expect(vi.getTimerCount()).toBe(1);
  visibility(false);
  expect(vi.getTimerCount()).toBe(1);
  cleanup();
  expect(vi.getTimerCount()).toBe(0);
  const count = elapsed.length;
  visibility(false);
  vi.advanceTimersByTime(1000);
  expect(elapsed).toHaveLength(count);
});
it("does not create a timer or publish on a hidden mount", () => {
  hidden = true;
  const callback = vi.fn();
  cleanup = visibleInterval(callback, 30_000);
  vi.advanceTimersByTime(60_000);
  expect(callback).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  visibility(false);
  expect(callback).toHaveBeenCalledOnce();
});
