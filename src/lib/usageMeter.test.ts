import { describe, expect, it } from "vitest";
import type { ProviderRateLimits } from "./rateLimits";
import {
  closestUsageReading,
  contextMeterTitle,
  usageMeterFill,
  usageMeterTitle,
} from "./usageMeter";

const NOW = Date.UTC(2026, 9, 3, 12);
const minutes = (value: number) => NOW + value * 60_000;
const limits = (patch: Partial<ProviderRateLimits>): ProviderRateLimits => ({
  provider: "claude",
  session: null,
  weekly: null,
  updatedAt: NOW,
  error: null,
  status: "ok",
  ...patch,
});
const window = (usedPercent: number, resetsAt: number | null = null) => ({
  usedPercent,
  windowMinutes: 300,
  resetsAt,
});

describe("closestUsageReading", () => {
  it("picks the window with the most of its limit used", () => {
    const account = limits({ session: window(12), weekly: window(15) });
    expect(closestUsageReading(account)?.kind).toBe("weekly");
    expect(usageMeterFill(closestUsageReading(account))).toBe(15);
    expect(
      closestUsageReading(limits({ session: window(80), weekly: window(15) }))
        ?.kind,
    ).toBe("session");
  });

  it("keeps the shorter window on a tie and reads a lone 30-day window", () => {
    expect(
      closestUsageReading(limits({ session: window(40), weekly: window(40) }))
        ?.kind,
    ).toBe("session");
    expect(
      closestUsageReading(limits({ provider: "codex", monthly: window(7) }))
        ?.kind,
    ).toBe("monthly");
  });

  it("clamps impossible readings and has nothing before a reading arrives", () => {
    const account = limits({
      session: window(140),
      weekly: window(Number.NaN),
    });
    expect(usageMeterFill(closestUsageReading(account))).toBe(100);
    expect(closestUsageReading(limits({}))).toBeNull();
    expect(usageMeterFill(null)).toBeNull();
  });
});

describe("usageMeterTitle", () => {
  it("names every window in plain words with when it resets", () => {
    expect(
      usageMeterTitle(
        limits({
          session: window(12, minutes(90)),
          weekly: window(15, minutes((5 * 24 + 23) * 60)),
        }),
        NOW,
      ),
    ).toBe(
      "Claude: 12% of your 5-hour limit used, resets in 1h 30m · 15% of your weekly limit, resets in 5d 23h",
    );
    expect(
      usageMeterTitle(
        limits({ provider: "codex", weekly: window(4), session: null }),
        NOW,
      ),
    ).toBe("Codex: 4% of your weekly limit used");
  });

  it("adds the forecast for limits that come before their reset", () => {
    expect(
      usageMeterTitle(limits({ session: window(60, minutes(237)) }), NOW, [
        {
          kind: "session",
          outlook: {
            state: "warning",
            msToLimit: 80 * 60_000,
            msToReset: 237 * 60_000,
          },
        },
        {
          kind: "weekly",
          outlook: { state: "clear", msToLimit: 0, msToReset: null },
        },
      ]),
    ).toBe(
      "Claude: 60% of your 5-hour limit used, resets in 3h 57m\nAt this pace you'll hit Claude's 5-hour limit in about an hour.",
    );
  });

  it("says when usage is still being checked or cannot be read", () => {
    expect(usageMeterTitle(limits({ status: "fetching" }), NOW)).toBe(
      "Claude: checking usage…",
    );
    expect(usageMeterTitle(limits({ status: "error" }), NOW)).toBe(
      "Claude: usage unavailable",
    );
  });
});

describe("contextMeterTitle", () => {
  it("describes how full the chat's context window is", () => {
    expect(contextMeterTitle({ used: 58_000, window: 200_000 })).toBe(
      "Context: 29% of this chat's context used (58K of 200K tokens)",
    );
    expect(contextMeterTitle({ used: 1_200 })).toBe(
      "Context: 1.2K tokens in this chat",
    );
  });
});
