import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SMOKE_BUDGET_MS, smokeStepRunner } from "./devSmoke";

describe("the real-app check's step budget", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("records each step's pass or failure with its detail", async () => {
    const { steps, step } = smokeStepRunner(10_000);
    expect(await step("one", async () => "fine")).toBe(true);
    expect(
      await step("two", async () => {
        throw new Error("not there");
      }),
    ).toBe(false);
    expect(await step("three", async () => undefined)).toBe(true);
    expect(steps).toEqual([
      { name: "one", passed: true, detail: "fine" },
      { name: "two", passed: false, detail: "not there" },
      { name: "three", passed: true },
    ]);
  });

  it("fails a step still running when the budget runs out, and lists the rest as not run", async () => {
    const { steps, step } = smokeStepRunner(10_000);
    vi.advanceTimersByTime(4_000);
    const running = step("slow", () => new Promise<string>(() => undefined));
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await running).toBe(false);
    expect(await step("after", async () => "never")).toBe(false);
    expect(steps).toEqual([
      {
        name: "slow",
        passed: false,
        detail:
          "still running when the check's 10 s budget ran out (6 s were left when it started)",
      },
      {
        name: "after",
        passed: false,
        detail: "not run: the check's 10 s budget was used up",
      },
    ]);
  });

  it("leaves no timer behind once a step ends in time", async () => {
    const { step } = smokeStepRunner(10_000);
    await step("quick", async () => "done");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stays inside the runner's deadline for the app", () => {
    // scripts/dev-aven.py stops the app after SMOKE_TIMEOUT seconds; the
    // check must finish itself first (its test reads this constant).
    expect(SMOKE_BUDGET_MS).toBeLessThanOrEqual(540_000);
  });
});
