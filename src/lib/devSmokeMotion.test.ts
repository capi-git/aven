import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { animationProblem, watchOneShot } from "./devSmokeMotion";

describe("animationProblem", () => {
  it("wants the named animation while motion is allowed", () => {
    expect(
      animationProblem("project-mark-hop", "project-mark-hop", false),
    ).toBe(null);
    expect(animationProblem("none", "project-mark-hop", false)).toBe(
      "its animation is none, expected project-mark-hop",
    );
    expect(animationProblem("", "project-mark-hop", false)).toContain("none");
  });

  it("wants no animation with reduced motion on", () => {
    expect(animationProblem("none", "project-mark-hop", true)).toBe(null);
    expect(animationProblem("project-mark-hop", "project-mark-hop", true)).toBe(
      "animates (project-mark-hop) with reduced motion on",
    );
  });
});

describe("watchOneShot", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const options = {
    what: "The reaction",
    appearMs: 1_000,
    clearMs: 1_500,
    quietMs: 800,
  };

  /** A marker that reads `value` between `from` and `to` ms from now. */
  function timeline(...spans: [number, number, string][]) {
    const start = Date.now();
    return () => {
      const at = Date.now() - start;
      return spans.find(([from, to]) => at >= from && at < to)?.[2] ?? null;
    };
  }

  async function settle(watch: Promise<string>) {
    const result = watch.then(
      (value) => ({ value }),
      (error: Error) => ({ error: error.message }),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    return result;
  }

  it("passes once a marker appears, clears and stays away", async () => {
    expect(
      await settle(watchOneShot(timeline([300, 1_500, "cheer"]), options)),
    ).toEqual({ value: "cheer" });
  });

  it("fails when the marker never appears", async () => {
    expect(await settle(watchOneShot(timeline(), options))).toEqual({
      error: "The reaction never appeared",
    });
  });

  it("fails when the marker never clears", async () => {
    expect(
      await settle(watchOneShot(timeline([100, 9_000, "cheer"]), options)),
    ).toEqual({ error: "The reaction (cheer) never cleared" });
  });

  it("fails when the marker plays again", async () => {
    expect(
      await settle(
        watchOneShot(
          timeline([100, 600, "cheer"], [900, 1_200, "cheer"]),
          options,
        ),
      ),
    ).toEqual({ error: "The reaction came back (cheer) after it cleared" });
  });
});
