import {
  formatResetDuration,
  MONTHLY_WINDOW_MINUTES,
  SESSION_WINDOW_MINUTES,
  WEEKLY_WINDOW_MINUTES,
  type RateLimitProvider,
} from "./rateLimits";

/**
 * Usage forecasting: from a few timestamped readings of one provider window,
 * how fast is it filling, and will it run out before it resets?
 *
 * Readings arrive only when the app already checks usage (the footer's
 * background check, opening the usage details, a manual refresh), so they are
 * minutes apart and uneven. The rules below are deliberately conservative:
 * they need several readings that rise more than once, and they never warn
 * from a single jump, an idle stretch or old numbers.
 */

export type UsageWindowKind = "session" | "weekly" | "monthly";

export const USAGE_WINDOW_KINDS: readonly UsageWindowKind[] = [
  "session",
  "weekly",
  "monthly",
];

export type UsageSample = {
  /** When the provider reported this reading (Unix ms). */
  at: number;
  /** Percentage of the window used, 0–100. */
  used: number;
  /** When the window resets (Unix ms), if the provider said. */
  resetsAt: number | null;
};

/** How fast one window is filling, measured from recent readings. */
export type UsagePace = {
  kind: UsageWindowKind;
  /** The latest reading's percentage. */
  used: number;
  /** Percentage points per hour. */
  perHour: number;
  /** When the window reaches 100% at this pace (Unix ms). */
  hitAt: number;
  resetsAt: number | null;
  /** First and last reading the pace was measured over. */
  from: number;
  to: number;
  /** The last reading that went up. */
  lastRiseAt: number;
  samples: number;
};

export type UsageOutlookState =
  /** The limit comes before the reset, and soon: warn. */
  | "warning"
  /** The limit comes before the reset, but not soon enough to warn. */
  | "ahead"
  /** At this pace the window resets first. */
  | "clear";

export type UsageOutlook = {
  state: UsageOutlookState;
  /** Time from now until 100% at this pace; 0 when it is due already. */
  msToLimit: number;
  /** Time from now until the window resets, if known. */
  msToReset: number | null;
};

type ForecastRule = {
  /** Window length, for pruning readings that cannot belong to it. */
  windowMs: number;
  /** Only readings this recent (before the latest) measure the pace. */
  lookbackMs: number;
  /** The readings used must cover at least this long. */
  minSpanMs: number;
  /**
   * The pace is never measured over less than this. Long windows include
   * nights and breaks, so a busy afternoon is spread over a whole day.
   */
  minPaceSpanMs: number;
  /** A longer silence between readings ends the stretch of active use. */
  maxGapMs: number;
  /** No pace once usage has stopped rising for this long. */
  idleAfterMs: number;
  /** Readings older than this are too old to say anything. */
  staleAfterMs: number;
  /** Warn only when the limit is at most this far away. */
  horizonMs: number;
  /** ...and comes at least this long before the window resets. */
  resetMarginMs: number;
  /** Reported reset times this close belong to the same window. */
  resetToleranceMs: number;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const FORECAST_RULES: Record<UsageWindowKind, ForecastRule> = {
  session: {
    windowMs: SESSION_WINDOW_MINUTES * MINUTE,
    lookbackMs: 60 * MINUTE,
    minSpanMs: 20 * MINUTE,
    minPaceSpanMs: 0,
    // The footer checks every 15 minutes while Aven is on screen.
    maxGapMs: 35 * MINUTE,
    idleAfterMs: 40 * MINUTE,
    staleAfterMs: 40 * MINUTE,
    horizonMs: 90 * MINUTE,
    resetMarginMs: 5 * MINUTE,
    resetToleranceMs: 10 * MINUTE,
  },
  weekly: {
    windowMs: WEEKLY_WINDOW_MINUTES * MINUTE,
    lookbackMs: DAY,
    minSpanMs: 2 * HOUR,
    minPaceSpanMs: DAY,
    maxGapMs: Infinity,
    idleAfterMs: Infinity,
    staleAfterMs: 6 * HOUR,
    horizonMs: 2 * DAY,
    resetMarginMs: HOUR,
    resetToleranceMs: 2 * HOUR,
  },
  monthly: {
    windowMs: MONTHLY_WINDOW_MINUTES * MINUTE,
    lookbackMs: 3 * DAY,
    minSpanMs: 6 * HOUR,
    minPaceSpanMs: 3 * DAY,
    maxGapMs: Infinity,
    idleAfterMs: Infinity,
    staleAfterMs: 12 * HOUR,
    horizonMs: 4 * DAY,
    resetMarginMs: 6 * HOUR,
    resetToleranceMs: 6 * HOUR,
  },
};

/** Enough readings to see a trend rather than a moment. */
export const MIN_FORECAST_SAMPLES = 3;
/** Usage must have gone up at least twice. */
const MIN_RISING_STEPS = 2;
/** Total rise, in points; whole-percent rounding makes less unreliable. */
const MIN_RISE = 3;
/** No single step may carry more than this share of the rise. */
const MAX_JUMP_SHARE = 0.75;
/** Rounding noise: a smaller dip is not a decrease, a smaller step not a rise. */
export const USAGE_DROP_TOLERANCE = 1;
const RISE_EPSILON = 0.25;

function validSample(sample: UsageSample): boolean {
  return (
    Number.isFinite(sample.at) &&
    sample.at > 0 &&
    Number.isFinite(sample.used) &&
    (sample.resetsAt == null || Number.isFinite(sample.resetsAt))
  );
}

/**
 * True when `later` continues the window `earlier` was read from. A reset
 * shows as a reported reset time that moved, a reset time that has passed,
 * or usage that fell.
 */
export function sameUsageWindow(
  earlier: UsageSample,
  later: UsageSample,
  kind: UsageWindowKind,
): boolean {
  if (earlier.resetsAt != null && later.at >= earlier.resetsAt) return false;
  if (
    earlier.resetsAt != null &&
    later.resetsAt != null &&
    Math.abs(later.resetsAt - earlier.resetsAt) >
      FORECAST_RULES[kind].resetToleranceMs
  )
    return false;
  return later.used >= earlier.used - USAGE_DROP_TOLERANCE;
}

/**
 * The pace of the latest stretch of use in the current window, or null when
 * the readings do not show a clear, steady rise.
 */
export function measurePace(
  samples: readonly UsageSample[],
  kind: UsageWindowKind,
): UsagePace | null {
  const rule = FORECAST_RULES[kind];
  const sorted = samples.filter(validSample).sort((a, b) => a.at - b.at);
  if (sorted.length < MIN_FORECAST_SAMPLES) return null;
  const last = sorted[sorted.length - 1];
  if (last.used >= 100) return null;

  // Walk back from the latest reading while it is the same window, the same
  // stretch of use, and recent enough.
  let first = sorted.length - 1;
  for (let index = sorted.length - 2; index >= 0; index--) {
    const earlier = sorted[index];
    const later = sorted[index + 1];
    if (!sameUsageWindow(earlier, later, kind)) break;
    if (later.at - earlier.at > rule.maxGapMs) break;
    if (last.at - earlier.at > rule.lookbackMs) break;
    first = index;
  }
  const run = sorted.slice(first);
  if (run.length < MIN_FORECAST_SAMPLES) return null;

  const head = run[0];
  const span = last.at - head.at;
  const rise = last.used - head.used;
  if (span < rule.minSpanMs || rise < MIN_RISE) return null;

  let rising = 0;
  let biggest = 0;
  let lastRiseAt = head.at;
  for (let index = 1; index < run.length; index++) {
    const step = run[index].used - run[index - 1].used;
    if (step <= RISE_EPSILON) continue;
    rising += 1;
    biggest = Math.max(biggest, step);
    lastRiseAt = run[index].at;
  }
  if (rising < MIN_RISING_STEPS || biggest > rise * MAX_JUMP_SHARE) return null;

  const perMs = rise / Math.max(span, rule.minPaceSpanMs);
  return {
    kind,
    used: last.used,
    perHour: perMs * HOUR,
    hitAt: last.at + (100 - last.used) / perMs,
    resetsAt: last.resetsAt,
    from: head.at,
    to: last.at,
    lastRiseAt,
    samples: run.length,
  };
}

/**
 * What a pace means at `now`, or null when it no longer says anything: the
 * window reset, the readings are old, or use has stopped.
 */
export function usageOutlook(
  pace: UsagePace | null | undefined,
  now: number,
): UsageOutlook | null {
  if (!pace) return null;
  const rule = FORECAST_RULES[pace.kind];
  if (pace.resetsAt != null && now >= pace.resetsAt) return null;
  if (now - pace.to > rule.staleAfterMs) return null;
  if (now - pace.lastRiseAt > rule.idleAfterMs) return null;
  const msToLimit = Math.max(0, pace.hitAt - now);
  const msToReset = pace.resetsAt == null ? null : pace.resetsAt - now;
  if (pace.resetsAt != null && pace.hitAt >= pace.resetsAt)
    return { state: "clear", msToLimit, msToReset };
  // Without a reset time there is nothing to compare against: never warn.
  const warning =
    pace.resetsAt != null &&
    pace.hitAt <= pace.resetsAt - rule.resetMarginMs &&
    msToLimit <= rule.horizonMs;
  return { state: warning ? "warning" : "ahead", msToLimit, msToReset };
}

/**
 * The next moment an outlook can change without new readings: it goes stale
 * or idle, the window resets, or the limit comes within the warning horizon.
 */
export function nextOutlookChange(pace: UsagePace, now: number): number | null {
  const rule = FORECAST_RULES[pace.kind];
  const moments = [
    pace.to + rule.staleAfterMs,
    pace.lastRiseAt + rule.idleAfterMs,
    pace.resetsAt ?? Infinity,
    pace.hitAt - rule.horizonMs,
  ].filter((moment) => Number.isFinite(moment) && moment > now);
  return moments.length ? Math.min(...moments) : null;
}

/** "Claude", "Codex": how the sentence names an account. */
const PROVIDER_NAME: Record<RateLimitProvider, string> = {
  claude: "Claude",
  codex: "Codex",
};

/** "5-hour", "weekly", "30-day": how the sentence names a window. */
export const USAGE_WINDOW_NAME: Record<UsageWindowKind, string> = {
  session: "5-hour",
  weekly: "weekly",
  monthly: "30-day",
};

/** "~40m to limit at this pace" */
export function formatForecastShort(outlook: UsageOutlook): string {
  return `~${formatResetDuration(Math.max(outlook.msToLimit, MINUTE))} to limit at this pace`;
}

/** "~40m to limit at this pace · resets in 2h 10m" */
export function formatForecastDetail(outlook: UsageOutlook): string {
  const short = formatForecastShort(outlook);
  if (outlook.msToReset == null) return short;
  const reset = formatResetDuration(outlook.msToReset);
  return `${short} · ${reset === "now" ? "resets now" : `resets in ${reset}`}`;
}

/** "in about 40 minutes", rounded the way a person would say it. */
export function aboutDuration(ms: number): string {
  const minutes = ms / MINUTE;
  if (minutes < 2) return "any minute now";
  if (minutes < 10) return "in a few minutes";
  if (minutes < 55) return `in about ${Math.round(minutes / 5) * 5} minutes`;
  if (minutes < 90) return "in about an hour";
  const hours = minutes / 60;
  if (hours < 20) return `in about ${Math.round(hours)} hours`;
  if (hours < 36) return "in about a day";
  return `in about ${Math.round(hours / 24)} days`;
}

/** "At this pace you'll hit Claude's 5-hour limit in about 40 minutes." */
export function forecastSentence(
  provider: RateLimitProvider,
  kind: UsageWindowKind,
  msToLimit: number,
): string {
  return `At this pace you'll hit ${PROVIDER_NAME[provider]}'s ${USAGE_WINDOW_NAME[kind]} limit ${aboutDuration(msToLimit)}.`;
}
