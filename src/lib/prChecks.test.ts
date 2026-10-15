import { describe, expect, it } from "vitest";
import {
  PR_CHECKS_EMPTY_READS,
  prChecksDelay,
  prChecksNeedPolling,
  prNumberFromUrl,
  summarizePrChecks,
  type PrCheck,
} from "./prChecks";

const check = (state: PrCheck["state"], name = state): PrCheck => ({
  name,
  state,
  url: "",
});

describe("summarizePrChecks", () => {
  it("puts failures first, then what is still running", () => {
    expect(
      summarizePrChecks([check("fail"), check("pending"), check("pass")]),
    ).toMatchObject({
      state: "failing",
      failed: 1,
      pending: 1,
      label: "1 failed · 1 still running",
    });
    expect(summarizePrChecks([check("fail"), check("pass")]).label).toBe(
      "1 of 2 checks failed",
    );
    expect(summarizePrChecks([check("pending"), check("pass")])).toMatchObject({
      state: "pending",
      label: "1 of 2 checks running",
    });
  });

  it("calls skipped checks passing", () => {
    expect(
      summarizePrChecks([check("pass"), check("pass"), check("skipped")]),
    ).toMatchObject({
      state: "passing",
      label: "All 2 checks passed · 1 skipped",
    });
    expect(summarizePrChecks([check("pass")]).label).toBe("Check passed");
    expect(summarizePrChecks([])).toMatchObject({
      state: "none",
      label: "No checks reported yet",
    });
  });
});

describe("PR checks polling", () => {
  it("backs off from 8 seconds to at most a minute", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(prChecksDelay)).toEqual([
      8000, 12000, 18000, 27000, 40500, 60000, 60000, 60000,
    ]);
  });

  it("polls while checks run, and briefly while none have registered", () => {
    const pending = summarizePrChecks([check("pending")]);
    const done = summarizePrChecks([check("pass")]);
    const none = summarizePrChecks([]);
    expect(prChecksNeedPolling(pending, "open", 50)).toBe(true);
    expect(prChecksNeedPolling(done, "open", 1)).toBe(false);
    expect(prChecksNeedPolling(none, "open", 1)).toBe(true);
    expect(prChecksNeedPolling(none, "open", PR_CHECKS_EMPTY_READS)).toBe(
      false,
    );
    expect(prChecksNeedPolling(pending, "merged", 1)).toBe(false);
    expect(prChecksNeedPolling(null, undefined, 0)).toBe(true);
  });

  it("reads the pull request number from its URL", () => {
    expect(prNumberFromUrl("https://github.com/o/r/pull/42")).toBe(42);
    expect(prNumberFromUrl(" https://github.com/o/r/pull/7/files ")).toBe(7);
    expect(prNumberFromUrl("https://github.com/o/r/issues/7")).toBeNull();
  });
});
