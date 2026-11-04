import {
  formatResetDuration,
  formatUsagePercent,
  type ProviderRateLimits,
  type RateLimitWindow,
} from "./rateLimits";
import {
  forecastSentence,
  PROVIDER_NAME,
  USAGE_WINDOW_KINDS,
  USAGE_WINDOW_NAME,
  type UsageOutlook,
  type UsageWindowKind,
} from "./usageForecast";
import { contextPercent, formatTokens } from "./contextUsage";

export type UsageReading = { kind: UsageWindowKind; window: RateLimitWindow };

/** The account's reported windows, shortest first. */
export function usageReadings(limits: ProviderRateLimits): UsageReading[] {
  return USAGE_WINDOW_KINDS.flatMap((kind) => {
    const window = limits[kind];
    return window ? [{ kind, window }] : [];
  });
}

/**
 * The limit the account is closest to: the window with the most of it used.
 * A tie keeps the shorter window, which resets and refills sooner.
 */
export function closestUsageReading(
  limits: ProviderRateLimits,
): UsageReading | null {
  let closest: UsageReading | null = null;
  for (const reading of usageReadings(limits)) {
    if (
      !closest ||
      clamp(reading.window.usedPercent) > clamp(closest.window.usedPercent)
    )
      closest = reading;
  }
  return closest;
}

/** Whole-percent fill for a meter, or null when nothing is known yet. */
export function usageMeterFill(reading: UsageReading | null): number | null {
  return reading ? Math.round(clamp(reading.window.usedPercent)) : null;
}

function clamp(value: number) {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

function resetPhrase(window: RateLimitWindow, now: number) {
  if (window.resetsAt == null || !Number.isFinite(window.resetsAt)) return "";
  const reset = formatResetDuration(window.resetsAt - now);
  return reset === "now" ? ", resets now" : `, resets in ${reset}`;
}

/**
 * Everything the footer used to print about an account, in plain words:
 * "Claude: 12% of your 5-hour limit used, resets in 1h 30m · 15% of your
 * weekly limit, resets in 5d 23h", then one line for each window whose limit
 * comes before its reset at the current pace.
 */
export function usageMeterTitle(
  limits: ProviderRateLimits,
  now: number,
  outlooks: readonly { kind: UsageWindowKind; outlook: UsageOutlook }[] = [],
): string {
  const name = PROVIDER_NAME[limits.provider];
  const readings = usageReadings(limits);
  if (!readings.length)
    return `${name}: ${
      limits.status === "fetching" || limits.status === "idle"
        ? "checking usage…"
        : "usage unavailable"
    }`;
  const parts = readings.map(
    ({ kind, window }, index) =>
      `${formatUsagePercent(window.usedPercent)} of your ${USAGE_WINDOW_NAME[kind]} limit${
        index === 0 ? " used" : ""
      }${resetPhrase(window, now)}`,
  );
  const forecasts = outlooks
    .filter(({ outlook }) => outlook.state !== "clear")
    .map(({ kind, outlook }) =>
      forecastSentence(limits.provider, kind, outlook.msToLimit),
    );
  return [`${name}: ${parts.join(" · ")}`, ...forecasts].join("\n");
}

/** "Context: 25% of this chat's context used (50K of 200K tokens)". */
export function contextMeterTitle(context: {
  used: number;
  window?: number;
}): string {
  const percent = contextPercent(context);
  if (percent == null)
    return `Context: ${formatTokens(context.used)} tokens in this chat`;
  return `Context: ${percent}% of this chat's context used (${formatTokens(
    context.used,
  )} of ${formatTokens(context.window ?? 0)} tokens)`;
}
