import { describe, expect, it } from "vitest";
import {
  aboutDuration,
  forecastSentence,
  formatForecastDetail,
  formatForecastShort,
  measurePace,
  nextOutlookChange,
  sameUsageWindow,
  usageOutlook,
  type UsageSample,
} from "./usageForecast";

const T0 = new Date("2026-10-15T09:00:00Z").getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const at = (minutes: number) => T0 + minutes * MINUTE;

/** Readings `[minute, used]` in one window that resets at `resetMinute`. */
function readings(
  points: [number, number][],
  resetMinute: number | null = 300,
): UsageSample[] {
  return points.map(([minute, used]) => ({
    at: at(minute),
    used,
    resetsAt: resetMinute == null ? null : at(resetMinute),
  }));
}

describe("measuring the pace", () => {
  it("projects a steady burn to the limit", () => {
    // 5 points every 10 minutes: 30 points an hour.
    const pace = measurePace(
      readings([
        [0, 40],
        [10, 45],
        [20, 50],
        [30, 55],
        [40, 60],
      ]),
      "session",
    )!;
    expect(pace.perHour).toBeCloseTo(30);
    expect(pace.used).toBe(60);
    // 40 points left at half a point a minute.
    expect(pace.hitAt).toBe(at(120));
    expect(pace.samples).toBe(5);
    expect(pace.lastRiseAt).toBe(at(40));
    const outlook = usageOutlook(pace, at(41))!;
    expect(outlook.state).toBe("warning");
    expect(outlook.msToLimit).toBe(79 * MINUTE);
    expect(outlook.msToReset).toBe(259 * MINUTE);
  });

  it("averages bursty use across the quiet checks between bursts", () => {
    const pace = measurePace(
      readings([
        [0, 60],
        [15, 68],
        [30, 68],
        [45, 76],
        [60, 76],
      ]),
      "session",
    )!;
    // 16 points over an hour, flat checks included.
    expect(pace.perHour).toBeCloseTo(16);
    expect(pace.hitAt).toBe(at(60 + 90));
    expect(pace.lastRiseAt).toBe(at(45));
    expect(usageOutlook(pace, at(61))?.state).toBe("warning");
  });

  it("never warns from one jump", () => {
    expect(
      measurePace(
        readings([
          [0, 20],
          [15, 21],
          [30, 45],
          [45, 46],
        ]),
        "session",
      ),
    ).toBeNull();
    // One rise and then flat readings is still one jump.
    expect(
      measurePace(
        readings([
          [0, 20],
          [15, 40],
          [30, 40],
          [45, 40],
        ]),
        "session",
      ),
    ).toBeNull();
  });

  it("needs three readings over at least twenty minutes and a real rise", () => {
    expect(
      measurePace(
        readings([
          [0, 40],
          [15, 50],
        ]),
        "session",
      ),
    ).toBeNull();
    expect(
      measurePace(
        readings([
          [0, 40],
          [5, 45],
          [10, 50],
        ]),
        "session",
      ),
    ).toBeNull();
    // Rounding-sized steps are not a trend.
    expect(
      measurePace(
        readings([
          [0, 40],
          [15, 41],
          [30, 42],
        ]),
        "session",
      ),
    ).toBeNull();
  });

  it("returns nothing without data", () => {
    expect(measurePace([], "session")).toBeNull();
    expect(measurePace([], "weekly")).toBeNull();
    expect(usageOutlook(null, T0)).toBeNull();
    expect(usageOutlook(undefined, T0)).toBeNull();
  });

  it("ignores readings with broken numbers", () => {
    const samples = [
      ...readings([
        [0, 40],
        [10, 45],
        [20, 50],
      ]),
      { at: Number.NaN, used: 99, resetsAt: null },
      { at: at(25), used: Number.POSITIVE_INFINITY, resetsAt: null },
    ];
    expect(measurePace(samples, "session")?.used).toBe(50);
  });

  it("sorts readings that arrive out of order", () => {
    const pace = measurePace(
      readings([
        [20, 50],
        [0, 40],
        [10, 45],
      ]),
      "session",
    );
    expect(pace?.used).toBe(50);
    expect(pace?.from).toBe(at(0));
  });

  it("starts again after a reset in between", () => {
    const before = readings(
      [
        [0, 70],
        [15, 80],
        [30, 90],
      ],
      60,
    );
    const after = readings(
      [
        [75, 5],
        [90, 12],
      ],
      360,
    );
    // Two readings in the new window are not enough, whatever came before.
    expect(measurePace([...before, ...after], "session")).toBeNull();
    const more = readings([[105, 19]], 360);
    const pace = measurePace([...before, ...after, ...more], "session")!;
    expect(pace.from).toBe(at(75));
    expect(pace.used).toBe(19);
    expect(pace.resetsAt).toBe(at(360));
    expect(pace.perHour).toBeCloseTo(28);
  });

  it("treats falling numbers as a new start, and a rounding dip as noise", () => {
    expect(
      measurePace(
        readings([
          [0, 50],
          [15, 45],
          [30, 40],
        ]),
        "session",
      ),
    ).toBeNull();
    const pace = measurePace(
      readings([
        [0, 30],
        [10, 40],
        [20, 35],
        [30, 38],
        [40, 41],
        [50, 44],
      ]),
      "session",
    )!;
    expect(pace.from).toBe(at(20));
    expect(pace.perHour).toBeCloseTo(18);
    const dip = measurePace(
      readings([
        [0, 30],
        [10, 35],
        [20, 34.5],
        [30, 40],
      ]),
      "session",
    )!;
    expect(dip.from).toBe(at(0));
  });

  it("ends the stretch of use at a long silence", () => {
    const pace = measurePace(
      readings([
        [0, 10],
        [15, 20],
        [135, 30],
        [150, 33],
        [165, 36],
      ]),
      "session",
    )!;
    expect(pace.from).toBe(at(135));
    expect(pace.perHour).toBeCloseTo(12);
  });

  it("does not let idle time before the work slow the pace", () => {
    const pace = measurePace(
      readings([
        [0, 30],
        [15, 30],
        [30, 30],
        [45, 38],
        [60, 46],
      ]),
      "session",
    )!;
    // From where the work started, not from the start of the hour.
    expect(pace.from).toBe(at(30));
    expect(pace.perHour).toBeCloseTo(32);
    // Nothing but idle readings is no pace at all.
    expect(
      measurePace(
        readings([
          [0, 30],
          [15, 30],
          [30, 30],
        ]),
        "session",
      ),
    ).toBeNull();
  });

  it("only looks back an hour in a five-hour window", () => {
    const pace = measurePace(
      readings([
        [0, 5],
        [15, 25],
        [30, 26],
        [45, 27],
        [60, 30],
        [75, 33],
        [90, 36],
      ]),
      "session",
    )!;
    expect(pace.from).toBe(at(30));
    expect(pace.perHour).toBeCloseTo(10);
  });

  it("is nothing to forecast once the window is full", () => {
    expect(
      measurePace(
        readings([
          [0, 80],
          [10, 90],
          [20, 100],
        ]),
        "session",
      ),
    ).toBeNull();
  });
});

describe("the outlook", () => {
  const steady = (resetMinute: number | null = 300) =>
    measurePace(
      readings(
        [
          [0, 40],
          [10, 45],
          [20, 50],
          [30, 55],
          [40, 60],
        ],
        resetMinute,
      ),
      "session",
    )!;

  it("does not warn while the limit is further away than the horizon", () => {
    // 30 points an hour from 10%: three hours to go, with four left.
    const pace = measurePace(
      readings(
        [
          [0, 0],
          [10, 5],
          [20, 10],
        ],
        260,
      ),
      "session",
    )!;
    expect(usageOutlook(pace, at(21))?.state).toBe("ahead");
    expect(usageOutlook(pace, at(25))?.msToLimit).toBe(175 * MINUTE);
  });

  it("is clear when the window resets before the limit", () => {
    expect(usageOutlook(steady(100), at(41))?.state).toBe("clear");
  });

  it("does not warn when the limit lands right at the reset", () => {
    expect(usageOutlook(steady(122), at(41))?.state).toBe("ahead");
    expect(usageOutlook(steady(126), at(41))?.state).toBe("warning");
  });

  it("never warns without a reset time to compare against", () => {
    expect(usageOutlook(steady(null), at(41))?.state).toBe("ahead");
  });

  it("goes quiet when readings are old, use stopped or the window reset", () => {
    const pace = steady();
    expect(usageOutlook(pace, at(80))?.state).toBe("warning");
    expect(usageOutlook(pace, at(81))).toBeNull();
    expect(usageOutlook(pace, at(300))).toBeNull();
    // Flat readings since minute 40 mean nobody is using it now.
    const idle = measurePace(
      readings([
        [0, 40],
        [10, 45],
        [20, 50],
        [30, 55],
        [40, 60],
        [50, 60],
        [60, 60],
      ]),
      "session",
    )!;
    expect(idle.lastRiseAt).toBe(at(40));
    expect(usageOutlook(idle, at(79))?.state).toBe("ahead");
    expect(usageOutlook(idle, at(81))).toBeNull();
  });

  it("says the limit is due when the projection has already passed", () => {
    const pace = measurePace(
      readings([
        [0, 85],
        [10, 90],
        [20, 95],
      ]),
      "session",
    )!;
    const outlook = usageOutlook(pace, at(35))!;
    expect(outlook.state).toBe("warning");
    expect(outlook.msToLimit).toBe(0);
  });

  it("spreads a busy afternoon over a day in a weekly window", () => {
    const week = 7 * 24 * 60;
    // 10 points in four hours reads as 10 points a day, not 2.5 an hour.
    const pace = measurePace(
      readings(
        [
          [0, 40],
          [60, 43],
          [120, 46],
          [180, 48],
          [240, 50],
        ],
        week,
      ),
      "weekly",
    )!;
    expect(pace.perHour).toBeCloseTo(10 / 24);
    expect(usageOutlook(pace, at(241))?.state).toBe("ahead");
    // A day of heavy use near the top warns two days out.
    const heavy = measurePace(
      readings(
        [
          [0, 45],
          [6 * 60, 55],
          [12 * 60, 62],
          [18 * 60, 68],
          [24 * 60, 75],
        ],
        3 * 24 * 60,
      ),
      "weekly",
    )!;
    expect(heavy.perHour).toBeCloseTo(30 / 24);
    const outlook = usageOutlook(heavy, at(24 * 60 + 5))!;
    expect(outlook.state).toBe("warning");
    expect(Math.round(outlook.msToLimit / HOUR)).toBe(20);
  });

  it("knows when it could next change without new readings", () => {
    const pace = steady();
    // The limit enters the 90-minute horizon at minute 30, before it goes stale.
    expect(nextOutlookChange(pace, at(10))).toBe(at(30));
    expect(nextOutlookChange(pace, at(41))).toBe(at(80));
  });
});

describe("windows", () => {
  const sample = (minute: number, used: number, reset: number | null) => ({
    at: at(minute),
    used,
    resetsAt: reset == null ? null : at(reset),
  });

  it("tells a reset from jitter in the reported reset time", () => {
    expect(
      sameUsageWindow(sample(0, 10, 300), sample(15, 12, 302), "session"),
    ).toBe(true);
    expect(
      sameUsageWindow(sample(0, 10, 300), sample(15, 12, 330), "session"),
    ).toBe(false);
    expect(
      sameUsageWindow(sample(0, 10, 300), sample(301, 12, 302), "session"),
    ).toBe(false);
    expect(
      sameUsageWindow(sample(0, 30, null), sample(15, 10, null), "session"),
    ).toBe(false);
    expect(
      sameUsageWindow(sample(0, 30, null), sample(15, 29.5, null), "session"),
    ).toBe(true);
  });
});

describe("wording", () => {
  it("writes the footer and panel line", () => {
    const outlook = {
      state: "warning" as const,
      msToLimit: 40 * MINUTE + 20_000,
      msToReset: 130 * MINUTE + 5_000,
    };
    expect(formatForecastShort(outlook)).toBe("~40m to limit at this pace");
    expect(formatForecastDetail(outlook)).toBe(
      "~40m to limit at this pace · resets in 2h 10m",
    );
    expect(
      formatForecastDetail({ state: "ahead", msToLimit: 0, msToReset: null }),
    ).toBe("~1m to limit at this pace");
  });

  it("rounds the sentence the way a person would", () => {
    expect(aboutDuration(30_000)).toBe("any minute now");
    expect(aboutDuration(6 * MINUTE)).toBe("in a few minutes");
    expect(aboutDuration(38 * MINUTE)).toBe("in about 40 minutes");
    expect(aboutDuration(70 * MINUTE)).toBe("in about an hour");
    expect(aboutDuration(150 * MINUTE)).toBe("in about 3 hours");
    expect(aboutDuration(26 * HOUR)).toBe("in about a day");
    expect(aboutDuration(44 * HOUR)).toBe("in about 2 days");
    expect(forecastSentence("claude", "session", 40 * MINUTE)).toBe(
      "At this pace you'll hit Claude's 5-hour limit in about 40 minutes.",
    );
    expect(forecastSentence("codex", "weekly", 26 * HOUR)).toBe(
      "At this pace you'll hit Codex's weekly limit in about a day.",
    );
  });
});
