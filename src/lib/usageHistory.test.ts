import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderRateLimits } from "./rateLimits";
import {
  appendUsageSample,
  buildUsageForecasts,
  getUsageForecasts,
  isNewUsageWarning,
  loadUsageHistory,
  markUsageWarningSeen,
  MAX_USAGE_SAMPLES,
  recordUsage,
  resetUsageForecasts,
  subscribeUsageForecasts,
  USAGE_HISTORY_KEY,
  USAGE_WARNINGS_SEEN_KEY,
} from "./usageHistory";
import { measurePace, type UsageSample } from "./usageForecast";

const T0 = new Date("2026-10-15T09:00:00Z").getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const at = (minutes: number) => T0 + minutes * MINUTE;
const sample = (
  minute: number,
  used: number,
  resetMinute: number | null = 300,
): UsageSample => ({
  at: at(minute),
  used,
  resetsAt: resetMinute == null ? null : at(resetMinute),
});

function claude(
  minute: number,
  session: number,
  weekly = 20,
  status: ProviderRateLimits["status"] = "ok",
): ProviderRateLimits {
  return {
    provider: "claude",
    session: { usedPercent: session, windowMinutes: 300, resetsAt: at(300) },
    weekly: {
      usedPercent: weekly,
      windowMinutes: 10_080,
      resetsAt: at(5 * 24 * 60),
    },
    updatedAt: at(minute),
    error: null,
    status,
  };
}

let stored: Map<string, string>;
let windowListeners: Map<string, Set<(event: StorageEvent) => void>>;

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  windowListeners = new Map();
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: (event: StorageEvent) => void) =>
      windowListeners.set(
        type,
        new Set([...(windowListeners.get(type) ?? []), listener]),
      ),
    removeEventListener: (
      type: string,
      listener: (event: StorageEvent) => void,
    ) => windowListeners.get(type)?.delete(listener),
  });
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  resetUsageForecasts();
});

afterEach(() => {
  resetUsageForecasts();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the reading history", () => {
  it("adds newer readings and ignores replays", () => {
    const one = appendUsageSample([], sample(0, 10), "session");
    expect(one).toEqual([sample(0, 10)]);
    const two = appendUsageSample(one, sample(15, 14), "session");
    expect(two).toHaveLength(2);
    // The same snapshot again, or an older one, changes nothing.
    expect(appendUsageSample(two, sample(15, 14), "session")).toBe(two);
    expect(appendUsageSample(two, sample(5, 12), "session")).toBe(two);
  });

  it("drops a second check of the same number moments later", () => {
    const series = [sample(0, 10)];
    const again = { ...sample(0, 10), at: at(0) + 30_000 };
    expect(appendUsageSample(series, again, "session")).toBe(series);
    // A different number is real news, however soon.
    expect(
      appendUsageSample(series, { ...again, used: 11 }, "session"),
    ).toHaveLength(2);
  });

  it("keeps only the ends of a run of equal readings", () => {
    let series: readonly UsageSample[] = [sample(0, 10), sample(15, 20)];
    series = appendUsageSample(series, sample(30, 20), "session");
    series = appendUsageSample(series, sample(45, 20), "session");
    series = appendUsageSample(series, sample(60, 20), "session");
    expect(series.map((item) => item.at)).toEqual([at(0), at(15), at(60)]);
  });

  it("starts again when the window resets", () => {
    const series = [sample(0, 70, 60), sample(15, 80, 60)];
    expect(appendUsageSample(series, sample(65, 3, 365), "session")).toEqual([
      sample(65, 3, 365),
    ]);
    // Falling usage is a reset even without a reported reset time.
    const unknown = [sample(0, 40, null), sample(15, 45, null)];
    expect(
      appendUsageSample(unknown, sample(30, 2, null), "session"),
    ).toHaveLength(1);
  });

  it("is a capped ring buffer that forgets readings older than the window", () => {
    let series: readonly UsageSample[] = [];
    for (let index = 0; index < MAX_USAGE_SAMPLES + 10; index++)
      series = appendUsageSample(
        series,
        sample(index, index / 2, 100_000),
        "weekly",
      );
    expect(series).toHaveLength(MAX_USAGE_SAMPLES);
    expect(series[0].at).toBe(at(10));
    const old = [sample(0, 10, 600), sample(10, 12, 600)];
    expect(
      appendUsageSample(old, sample(304, 30, 600), "session").map(
        (item) => item.at,
      ),
    ).toEqual([at(10), at(304)]);
  });
});

describe("recording usage", () => {
  it("records each window of a fresh answer and survives a restart", () => {
    recordUsage(claude(0, 10, 20));
    recordUsage(claude(15, 14, 21));
    resetUsageForecasts();
    const history = loadUsageHistory();
    expect(history["claude.session"]?.map((item) => item.used)).toEqual([
      10, 14,
    ]);
    expect(history["claude.weekly"]?.map((item) => item.used)).toEqual([
      20, 21,
    ]);
    expect(JSON.parse(stored.get(USAGE_HISTORY_KEY)!).v).toBe(1);
  });

  it("records an answer once, whichever window passes it on", () => {
    const answer = claude(0, 10);
    recordUsage(answer);
    recordUsage(answer);
    recordUsage({ ...answer, updatedAt: answer.updatedAt + 20_000 });
    expect(loadUsageHistory()["claude.session"]).toHaveLength(1);
  });

  it("ignores failed, unavailable and in-flight answers", () => {
    recordUsage(claude(0, 10, 20, "error"));
    recordUsage(claude(0, 10, 20, "fetching"));
    recordUsage(claude(0, 10, 20, "unavailable"));
    expect(stored.has(USAGE_HISTORY_KEY)).toBe(false);
  });

  it("forgets windows that have reset", () => {
    recordUsage(claude(0, 10));
    recordUsage({ ...claude(0, 10), weekly: null, updatedAt: at(1) }, at(301));
    expect(loadUsageHistory()["claude.session"]).toBeUndefined();
    expect(loadUsageHistory()["claude.weekly"]).toHaveLength(1);
  });

  it("reads damaged storage as no history", () => {
    stored.set(USAGE_HISTORY_KEY, "{not json");
    expect(loadUsageHistory()).toEqual({});
    stored.set(
      USAGE_HISTORY_KEY,
      JSON.stringify({
        v: 1,
        windows: {
          "claude.session": [[at(0), 10, at(300)], ["x"], [at(5), "y"]],
          "other.session": [[at(0), 10, null]],
        },
      }),
    );
    expect(loadUsageHistory()).toEqual({ "claude.session": [sample(0, 10)] });
  });
});

describe("warnings", () => {
  const steady = [
    sample(0, 40),
    sample(10, 45),
    sample(20, 50),
    sample(30, 55),
    sample(40, 60),
  ];

  it("picks each account's most urgent window", () => {
    const snapshot = buildUsageForecasts(
      {
        "claude.session": steady,
        "claude.weekly": [sample(0, 20, 10_000)],
        "codex.session": [sample(0, 5)],
      },
      {},
      at(41),
    );
    expect(snapshot.warnings.claude).toMatchObject({
      provider: "claude",
      kind: "session",
      unseen: true,
    });
    expect(snapshot.warnings.codex).toBeUndefined();
    expect(snapshot.providers.codex?.latest.session?.used).toBe(5);
    expect(snapshot.providers.claude?.paces.session?.used).toBe(60);
  });

  it("is news once per window, and again only when the pace speeds up", () => {
    const pace = measurePace(steady, "session")!;
    expect(isNewUsageWarning(pace, undefined)).toBe(true);
    const seen = { resetsAt: pace.resetsAt, perHour: pace.perHour };
    expect(isNewUsageWarning(pace, seen)).toBe(false);
    expect(
      isNewUsageWarning({ ...pace, perHour: pace.perHour * 1.4 }, seen),
    ).toBe(false);
    expect(
      isNewUsageWarning({ ...pace, perHour: pace.perHour * 1.5 }, seen),
    ).toBe(true);
    expect(
      isNewUsageWarning({ ...pace, resetsAt: pace.resetsAt! + 5 * HOUR }, seen),
    ).toBe(true);
  });

  it("keeps an unchanged warning's identity", () => {
    const history = { "claude.session": steady };
    const first = buildUsageForecasts(history, {}, at(41));
    const second = buildUsageForecasts(history, {}, at(42), first);
    expect(second.warnings.claude).toBe(first.warnings.claude);
  });
});

describe("the forecast store", () => {
  function recordSteady() {
    for (const [minute, used] of [
      [0, 40],
      [10, 45],
      [20, 50],
      [30, 55],
      [40, 60],
    ]) {
      vi.setSystemTime(at(minute));
      recordUsage(claude(minute, used));
    }
    vi.setSystemTime(at(41));
  }

  it("tells subscribers about new readings", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUsageForecasts(listener);
    expect(getUsageForecasts().warnings.claude).toBeUndefined();
    recordSteady();
    expect(listener).toHaveBeenCalled();
    expect(getUsageForecasts().warnings.claude?.kind).toBe("session");
    unsubscribe();
  });

  it("follows readings and seen warnings from other windows", () => {
    recordSteady();
    resetUsageForecasts();
    const listener = vi.fn();
    const unsubscribe = subscribeUsageForecasts(listener);
    const warning = getUsageForecasts().warnings.claude!;
    expect(warning.unseen).toBe(true);
    // Another window marks it seen and tells this one through storage.
    stored.set(
      USAGE_WARNINGS_SEEN_KEY,
      JSON.stringify({
        "claude.session": {
          resetsAt: warning.pace.resetsAt,
          perHour: warning.pace.perHour,
        },
      }),
    );
    for (const handler of windowListeners.get("storage") ?? [])
      handler({ key: USAGE_WARNINGS_SEEN_KEY } as StorageEvent);
    expect(listener).toHaveBeenCalledOnce();
    expect(getUsageForecasts().warnings.claude?.unseen).toBe(false);
    unsubscribe();
    expect(windowListeners.get("storage")?.size).toBe(0);
  });

  it("marks a warning seen until the pace changes", () => {
    const unsubscribe = subscribeUsageForecasts(() => {});
    recordSteady();
    markUsageWarningSeen(getUsageForecasts().warnings.claude!);
    expect(getUsageForecasts().warnings.claude?.unseen).toBe(false);
    unsubscribe();
  });

  it("lets a warning lapse on its own once readings go stale", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUsageForecasts(listener);
    recordSteady();
    listener.mockClear();
    expect(getUsageForecasts().warnings.claude).toBeDefined();
    // Nothing is fetched; one timer re-judges at the next change.
    vi.advanceTimersByTime(41 * MINUTE);
    expect(listener).toHaveBeenCalledOnce();
    expect(getUsageForecasts().warnings.claude).toBeUndefined();
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });
});
