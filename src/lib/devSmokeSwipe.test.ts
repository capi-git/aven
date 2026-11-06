import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { smokeScroll, swipeSteps } from "./devSmokeSwipe";

describe("the speed test's two-finger swipe", () => {
  it("moves the fingers the whole distance, then lifts them and lets momentum run out", () => {
    const steps = swipeSteps(110, 10);
    const fingers = steps.slice(0, 10);
    expect(fingers[0].phase).toBe("began");
    expect(fingers.slice(1).every((step) => step.phase === "changed")).toBe(
      true,
    );
    expect(fingers.reduce((sum, step) => sum + step.dx, 0)).toBeCloseTo(110);
    // Fastest in the middle, slower at the touch and at the lift.
    expect(fingers[4].dx).toBeGreaterThan(fingers[0].dx);
    expect(fingers[4].dx).toBeGreaterThan(fingers[9].dx);
    expect(steps[10]).toEqual({ phase: "ended", dx: 0 });
    expect(steps[11].phase).toBe("momentum-begin");
    const momentum = steps.slice(12, -1);
    expect(momentum.every((step) => step.phase === "momentum")).toBe(true);
    for (let index = 1; index < momentum.length; index += 1)
      expect(momentum[index].dx).toBeLessThan(momentum[index - 1].dx);
    expect(steps.at(-1)).toEqual({ phase: "momentum-end", dx: 0 });
  });

  it("swipes back the same way, mirrored", () => {
    expect(swipeSteps(-110, 10)).toEqual(
      swipeSteps(110, 10).map((step) => ({
        ...step,
        dx: step.dx === 0 ? 0 : -step.dx,
      })),
    );
  });

  it("sends each step to the web view as one trackpad event", async () => {
    await smokeScroll({ x: 120, y: 400 }, { phase: "changed", dx: 7.5 });
    expect(invoke).toHaveBeenLastCalledWith("dev_smoke_scroll", {
      x: 120,
      y: 400,
      zoom: expect.any(Number),
      dx: 7.5,
      phase: "changed",
    });
  });
});
