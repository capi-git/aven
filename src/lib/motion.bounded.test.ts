// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOTION_BOUND_SLACK_MS, playBounded } from "./motion";

let animation: {
  onfinish: (() => void) | null;
  cancel: ReturnType<typeof vi.fn>;
};
let element: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  element = document.createElement("div");
  animation = { onfinish: null, cancel: vi.fn() };
  Object.defineProperty(element, "animate", {
    value: vi.fn(() => animation),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("bounded motion", () => {
  it("ends at its duration even when the timeline never runs", () => {
    const onEnd = vi.fn();
    playBounded(
      element,
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: 150 },
      onEnd,
    );
    vi.advanceTimersByTime(150 + MOTION_BOUND_SLACK_MS - 1);
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(animation.cancel).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("ends once, early, when the animation finishes", () => {
    const onEnd = vi.fn();
    playBounded(element, [], { duration: 150 }, onEnd);
    animation.onfinish?.();
    vi.advanceTimersByTime(1000);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("stops without its end, and ends without an animation API", () => {
    const onEnd = vi.fn();
    playBounded(element, [], { duration: 150 }, onEnd).stop();
    vi.advanceTimersByTime(1000);
    expect(onEnd).not.toHaveBeenCalled();
    expect(animation.cancel).toHaveBeenCalledTimes(1);
    const bare = document.createElement("div");
    Object.defineProperty(bare, "animate", { value: undefined });
    const later = vi.fn();
    expect(
      playBounded(bare, [], { duration: 150 }, later).animation,
    ).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(later).toHaveBeenCalledTimes(1);
  });
});
