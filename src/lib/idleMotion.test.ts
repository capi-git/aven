// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installIdleStill } from "./idleMotion";

describe("ambient motion settles when Aven is left alone", () => {
  let clock = 0;
  let stop: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
    stop = installIdleStill(
      document.documentElement,
      window,
      60_000,
      () => clock,
    );
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });
  const pass = (ms: number) => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  };
  const still = () => document.documentElement.hasAttribute("data-still");

  it("settles after a minute untouched, and wakes at the next input", () => {
    pass(59_000);
    expect(still()).toBe(false);
    pass(1_000);
    expect(still()).toBe(true);
    window.dispatchEvent(new Event("pointermove"));
    expect(still()).toBe(false);
    pass(60_000);
    expect(still()).toBe(true);
    document.dispatchEvent(new Event("scroll"));
    expect(still()).toBe(false);
  });

  it("counts the minute from the last input", () => {
    pass(50_000);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    pass(50_000);
    expect(still()).toBe(false);
    pass(10_000);
    expect(still()).toBe(true);
  });

  it("leaves the window moving once removed", () => {
    pass(60_000);
    stop();
    expect(still()).toBe(false);
    stop = () => {};
  });
});
