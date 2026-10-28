// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PointerVelocity,
  SPRING_BOUND_SLACK_MS,
  SPRING_MAX_MS,
  SpringAnimator,
  rubberBand,
  springAt,
  springCurve,
  springSettleTime,
  type Spring,
} from "./spring";

const critical: Spring = { damping: 1, response: 0.25 };
const bouncy: Spring = { damping: 0.7, response: 0.25 };
const heavy: Spring = { damping: 1.6, response: 0.25 };

function path(spring: Spring, from: number, to: number, velocity: number) {
  const points: number[] = [];
  for (let t = 0; t <= 1; t += 1 / 240)
    points.push(springAt(spring, from, to, velocity, t).value);
  return points;
}

describe("spring math", () => {
  it("starts where it is told, at the speed it is told", () => {
    for (const spring of [critical, bouncy, heavy]) {
      const start = springAt(spring, 40, 0, 300, 0);
      expect(start).toEqual({ value: 40, velocity: 300 });
      // The reported velocity is the slope of the reported value.
      const h = 1e-5;
      for (const t of [0.01, 0.05, 0.12, 0.3]) {
        const a = springAt(spring, 40, 0, 300, t - h).value;
        const b = springAt(spring, 40, 0, 300, t + h).value;
        expect(springAt(spring, 40, 0, 300, t).velocity).toBeCloseTo(
          (b - a) / (2 * h),
          2,
        );
      }
    }
  });

  it("converges on the target for every damping", () => {
    for (const spring of [critical, bouncy, heavy]) {
      const end = springAt(spring, 120, 20, -800, 2);
      expect(end.value).toBeCloseTo(20, 3);
      expect(end.velocity).toBeCloseTo(0, 2);
    }
  });

  it("never overshoots when critically damped from rest, and does when below 1", () => {
    expect(Math.max(...path(critical, 0, 100, 0))).toBeLessThanOrEqual(
      100 + 1e-9,
    );
    expect(Math.max(...path(bouncy, 0, 100, 0))).toBeGreaterThan(101);
  });

  it("reaches most of the way in about its response", () => {
    // Critically damped: 1 − (1 + 2π)e^(−2π) ≈ 98.7% after one response.
    const at = springAt(critical, 0, 1, 0, critical.response).value;
    expect(at).toBeGreaterThan(0.98);
    expect(
      springAt(critical, 0, 1, 0, critical.response / 4).value,
    ).toBeLessThan(0.6);
  });

  it("is interruptible: retargeting from the live state keeps value and velocity continuous", () => {
    const t = 0.07;
    const live = springAt(critical, 0, 100, 0, t);
    // A new target mid-flight starts from the drawn value and its speed.
    const next = springAt(critical, live.value, -50, live.velocity, 0);
    expect(next.value).toBe(live.value);
    expect(next.velocity).toBe(live.velocity);
    // A reversal curves: it keeps moving forward briefly before coming back.
    const after = springAt(critical, live.value, -50, live.velocity, 1 / 120);
    expect(live.velocity).toBeGreaterThan(0);
    expect(after.value).toBeGreaterThan(live.value);
    // Restarting with the same target continues the same path.
    const same = springAt(critical, live.value, 100, live.velocity, 0.05);
    expect(same.value).toBeCloseTo(
      springAt(critical, 0, 100, 0, t + 0.05).value,
      9,
    );
  });

  it("hands a release velocity on: a throw carries past a target behind it, then returns", () => {
    // Released 10px short of the slot, moving 1200px/s away from it.
    const points = path(critical, 10, 0, 1200);
    expect(Math.max(...points)).toBeGreaterThan(20);
    expect(points[points.length - 1]).toBeCloseTo(0, 3);
  });

  it("settles in a bounded time that grows with distance and speed", () => {
    const near = springSettleTime(critical, 10, 0, 0, 0.25);
    const far = springSettleTime(critical, 300, 0, 0, 0.25);
    const thrown = springSettleTime(critical, 10, 0, 3000, 0.25);
    expect(near).toBeGreaterThan(0.05);
    expect(far).toBeGreaterThan(near);
    expect(thrown).toBeGreaterThan(near);
    expect(springSettleTime(critical, 0, 0, 0, 0.25)).toBe(0);
    expect(
      springSettleTime({ damping: 0.05, response: 1 }, 500, 0, 0, 0.25),
    ).toBe(SPRING_MAX_MS / 1000);
  });

  it("samples a CSS linear() curve that starts at 0 and ends at 1", () => {
    const curve = springCurve(critical);
    expect(curve.easing.startsWith("linear(0, ")).toBe(true);
    expect(curve.easing.endsWith(", 1)")).toBe(true);
    expect(curve.ms).toBeGreaterThan(200);
    expect(curve.ms).toBeLessThan(SPRING_MAX_MS);
  });

  it("rubber-bands: follows less the further it goes, never past its dimension", () => {
    const a = rubberBand(8, 32);
    const b = rubberBand(16, 32);
    const c = rubberBand(400, 32);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(8);
    expect(b - a).toBeLessThan(a);
    expect(c).toBeLessThan(32);
    expect(rubberBand(-16, 32)).toBe(-b);
    expect(rubberBand(0, 32)).toBe(0);
  });
});

describe("pointer velocity", () => {
  it("measures the last few moves and forgets a pause", () => {
    const tracker = new PointerVelocity(80);
    for (let i = 0; i <= 10; i++) tracker.add(i * 8, 0, i * 8);
    expect(tracker.velocity(80).x).toBeCloseTo(1000, 6);
    expect(tracker.velocity(80).y).toBe(0);
    // Held still for longer than the window before letting go.
    expect(tracker.velocity(200)).toEqual({ x: 0, y: 0 });
  });
});

describe("SpringAnimator", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  function fakeAnimate(element: HTMLElement) {
    const created: Array<{
      frames: Keyframe[];
      options: KeyframeAnimationOptions;
      animation: Animation & { currentTime: number };
    }> = [];
    element.animate = vi.fn(
      (frames: Keyframe[], options: KeyframeAnimationOptions) => {
        const animation = {
          currentTime: 0,
          pending: false,
          cancel: vi.fn(),
          finished: Promise.resolve(),
          onfinish: null,
        } as unknown as Animation & { currentTime: number };
        created.push({ frames, options, animation });
        return animation;
      },
    ) as unknown as HTMLElement["animate"];
    return created;
  }

  it("holds the target in the element's own style and animates from the drawn value", () => {
    vi.useFakeTimers();
    const element = document.createElement("div");
    const created = fakeAnimate(element);
    const springs = new SpringAnimator(
      { x: { spring: critical, precision: 0.25 } },
      { x: 0 },
      ({ x }) => [[element, { transform: `translateX(${x}px)` }]],
    );
    springs.to({ x: 100 });
    expect(element.style.transform).toBe("translateX(100px)");
    expect(created).toHaveLength(1);
    expect(created[0].frames[0].transform).toBe("translateX(0px)");
    expect(created[0].frames.at(-1)!.transform).toBe("translateX(100px)");
    // Mid-flight a new target starts from where the compositor draws it.
    created[0].animation.currentTime = 60;
    const drawn = springAt(critical, 0, 100, 0, 0.06);
    springs.to({ x: -40 });
    expect(created[0].animation.cancel).toHaveBeenCalled();
    expect(created[1].frames[0].transform).toBe(`translateX(${drawn.value}px)`);
    expect(springs.state().x.velocity).toBeCloseTo(drawn.velocity, 6);
    expect(element.style.transform).toBe("translateX(-40px)");
  });

  it("ends by timer even when the animation never reports finishing", () => {
    vi.useFakeTimers();
    const element = document.createElement("div");
    const created = fakeAnimate(element);
    const settled = vi.fn();
    const springs = new SpringAnimator(
      { x: { spring: critical, precision: 0.25 } },
      { x: 0 },
      ({ x }) => [[element, { transform: `translateX(${x}px)` }]],
    );
    springs.to({ x: 50 }, { velocity: { x: 900 } });
    springs.onSettle(settled);
    expect(springs.running).toBe(true);
    const ms = created[0].options.duration as number;
    vi.advanceTimersByTime(ms + SPRING_BOUND_SLACK_MS);
    expect(springs.running).toBe(false);
    expect(created[0].animation.cancel).toHaveBeenCalled();
    expect(settled).toHaveBeenCalledOnce();
    expect(element.style.transform).toBe("translateX(50px)");
  });

  it("jumps and finishes without animating", () => {
    const element = document.createElement("div");
    const created = fakeAnimate(element);
    const springs = new SpringAnimator(
      {
        x: { spring: critical, precision: 0.25 },
        o: { spring: critical, precision: 0.002 },
      },
      { x: 0, o: 1 },
      ({ x, o }) => [
        [element, { transform: `translateX(${x}px)`, opacity: String(o) }],
      ],
    );
    springs.to({ x: 30 }, { instant: true });
    expect(created).toHaveLength(0);
    expect(element.style.transform).toBe("translateX(30px)");
    springs.to({ o: 0 });
    springs.finish();
    expect(element.style.opacity).toBe("0");
    springs.jump({ x: 5 });
    expect(element.style.transform).toBe("translateX(5px)");
    expect(springs.state().x).toEqual({ value: 5, velocity: 0 });
  });

  it("animates only the elements whose values move", () => {
    const moving = document.createElement("div");
    const still = document.createElement("div");
    const movingRuns = fakeAnimate(moving);
    const stillRuns = fakeAnimate(still);
    const springs = new SpringAnimator(
      {
        x: { spring: critical, precision: 0.25 },
        o: { spring: critical, precision: 0.002 },
      },
      { x: 0, o: 1 },
      ({ x, o }) => [
        [moving, { transform: `translateX(${x}px)` }],
        [still, { opacity: String(o) }],
      ],
    );
    springs.to({ x: 40 });
    expect(movingRuns).toHaveLength(1);
    expect(stillRuns).toHaveLength(0);
    expect(still.style.opacity).toBe("1");
    springs.cancel();
  });
});
