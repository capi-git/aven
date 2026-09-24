// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  STREAM_FLUSH_INTERVAL_MS,
  cancelScheduledFlush,
  scheduleStreamFlush,
} from "./streamFlush";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("aligns an idle stream's first flush with the next frame", () => {
  const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(7);
  const handle = scheduleStreamFlush(() => {}, 0, 1000);
  expect(handle).toEqual({ kind: "raf", id: 7 });
  expect(raf).toHaveBeenCalledOnce();
});

it("waits out the interval after a recent flush instead of every frame", () => {
  const raf = vi.spyOn(window, "requestAnimationFrame");
  const run = vi.fn();
  const handle = scheduleStreamFlush(run, 1000, 1008);
  expect(handle.kind).toBe("timeout");
  expect(raf).not.toHaveBeenCalled();
  vi.advanceTimersByTime(STREAM_FLUSH_INTERVAL_MS - 9);
  expect(run).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(run).toHaveBeenCalledOnce();
});

it("uses a timer while the document is hidden and can be cancelled", () => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  const run = vi.fn();
  const handle = scheduleStreamFlush(run, 0, 1000);
  expect(handle.kind).toBe("timeout");
  cancelScheduledFlush(handle);
  vi.advanceTimersByTime(STREAM_FLUSH_INTERVAL_MS * 2);
  expect(run).not.toHaveBeenCalled();
});
