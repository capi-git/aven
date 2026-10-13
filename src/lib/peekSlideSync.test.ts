import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NATIVE_SLIDE_CLOSE_LEAD_MS, startSharedSlide } from "./peekSlideSync";

class FakeTransition {
  constructor(
    public transitionProperty: string,
    public startTime: number | null = null,
    public playState = "running",
    duration = 240,
    delay = 0,
  ) {
    this.effect = { getComputedTiming: () => ({ duration, delay }) };
  }
  effect: { getComputedTiming: () => { duration: number; delay: number } };
}
class FakeAnimation {
  startTime: number | null = null;
  playState = "running";
}

function element(...animations: object[]) {
  return { getAnimations: () => animations } as unknown as Element;
}

beforeEach(() => {
  vi.stubGlobal("CSSTransition", FakeTransition);
  vi.spyOn(Date, "now").mockReturnValue(1_791_927_275_000);
  vi.spyOn(performance, "now").mockReturnValue(5_000);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("startSharedSlide", () => {
  it("starts a closing panel and its workspace crop together, a moment later", () => {
    const slide = new FakeTransition("transform");
    const visibility = new FakeTransition("visibility");
    const crop = new FakeTransition("clip-path");
    const result = startSharedSlide(
      [element(slide, visibility), element(crop)],
      NATIVE_SLIDE_CLOSE_LEAD_MS,
    );
    expect([slide, visibility, crop].map((row) => row.startTime)).toEqual([
      5_048, 5_048, 5_048,
    ]);
    expect(result).toEqual({ at: 1_791_927_275_048, duration: 240 });
  });

  it("starts an opening panel now and pins its crop animation with it", () => {
    const slide = new FakeTransition("transform", null, "running", 370);
    const crop = new FakeAnimation();
    expect(startSharedSlide([element(slide), element(crop)], 0)).toEqual({
      at: 1_791_927_275_000,
      duration: 370,
    });
    expect(crop.startTime).toBe(5_000);
  });

  it("keeps a start another page already chose, and reports it", () => {
    const slide = new FakeTransition("transform", 5_030);
    const crop = new FakeTransition("clip-path");
    expect(startSharedSlide([element(slide), element(crop)], 48)).toEqual({
      at: 1_791_927_275_030,
      duration: 240,
    });
    expect(slide.startTime).toBe(5_030);
    expect(crop.startTime).toBe(5_030);
  });

  it("reports a reversed slide's shortened duration and any delay", () => {
    const slide = new FakeTransition("transform", null, "running", 120, 10);
    expect(startSharedSlide([element(slide)], 48)).toEqual({
      at: 1_791_927_275_058,
      duration: 120,
    });
  });

  it("leaves everything alone when nothing slides", () => {
    const crop = new FakeTransition("clip-path");
    const idle = new FakeTransition("transform", null, "idle");
    expect(startSharedSlide([element(crop)], 48)).toBeNull();
    expect(startSharedSlide([element(idle), null, undefined], 48)).toBeNull();
    expect(crop.startTime).toBeNull();
    expect(startSharedSlide([{} as Element], 48)).toBeNull();
  });

  it("finds nothing when the engine has no CSS transitions", () => {
    vi.stubGlobal("CSSTransition", undefined);
    const slide = new FakeTransition("transform");
    expect(startSharedSlide([element(slide)], 48)).toBeNull();
    expect(slide.startTime).toBeNull();
  });
});
