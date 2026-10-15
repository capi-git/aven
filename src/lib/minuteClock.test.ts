import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { minuteClockNow, subscribeMinuteClock } from "./minuteClock";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T12:00:20Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

it("ticks once a minute, on the boundary, while someone listens", () => {
  const listener = vi.fn();
  const stop = subscribeMinuteClock(listener);
  try {
    const before = minuteClockNow();
    expect(before).toBe(Date.now());
    vi.advanceTimersByTime(30_000);
    expect(listener).not.toHaveBeenCalled();
    expect(minuteClockNow()).toBe(before);
    vi.advanceTimersByTime(20_000);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(new Date(minuteClockNow()).getUTCSeconds()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(listener).toHaveBeenCalledTimes(2);
  } finally {
    stop();
  }
  vi.advanceTimersByTime(5 * 60_000);
  expect(listener).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("shares one timer between listeners and catches up when nobody listens", () => {
  const stopA = subscribeMinuteClock(() => {});
  const stopB = subscribeMinuteClock(() => {});
  try {
    expect(vi.getTimerCount()).toBe(1);
  } finally {
    stopA();
    stopB();
  }
  vi.advanceTimersByTime(10 * 60_000);
  expect(minuteClockNow()).toBe(Date.now());
});
