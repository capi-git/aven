import {
  clampUsedPercent,
  type ProviderRateLimits,
  type RateLimitProvider,
} from "./rateLimits";
import {
  FORECAST_RULES,
  measurePace,
  nextOutlookChange,
  sameUsageWindow,
  USAGE_WINDOW_KINDS,
  usageOutlook,
  type UsagePace,
  type UsageSample,
  type UsageWindowKind,
} from "./usageForecast";

/** Recent readings per provider window, kept across restarts. */
export const USAGE_HISTORY_KEY = "aven.usageHistory";
/** Warnings already shown, so each window warns once per pace. */
export const USAGE_WARNINGS_SEEN_KEY = "aven.usageWarningsSeen";

/** Readings kept per provider window; the oldest go first. */
export const MAX_USAGE_SAMPLES = 48;
/** The same number again this soon (another window's check, a second click) adds nothing. */
const DUPLICATE_WITHIN_MS = 60_000;
/** A seen warning shows again in the same window only if the pace speeds up this much. */
const PACE_CHANGE = 1.5;
/** setTimeout's ceiling is ~24.8 days; a day is plenty between rechecks. */
const MAX_RECHECK_MS = 24 * 60 * 60 * 1000;

const PROVIDERS: readonly RateLimitProvider[] = ["claude", "codex"];

type SeriesKey = `${RateLimitProvider}.${UsageWindowKind}`;
export type UsageHistory = Partial<Record<SeriesKey, readonly UsageSample[]>>;

const seriesKey = (
  provider: RateLimitProvider,
  kind: UsageWindowKind,
): SeriesKey => `${provider}.${kind}`;

const sameUsed = (a: number, b: number) => Math.abs(a - b) < 0.01;

export function isRateLimitProvider(id: string): id is RateLimitProvider {
  return (PROVIDERS as readonly string[]).includes(id);
}

/**
 * Adds one reading to a window's history. A reading that is not newer than
 * the last one is ignored, so a replayed snapshot or a second window's
 * check never records twice. A reset starts the history again; a run of
 * equal readings keeps only its first and latest.
 */
export function appendUsageSample(
  series: readonly UsageSample[],
  sample: UsageSample,
  kind: UsageWindowKind,
): readonly UsageSample[] {
  const last = series[series.length - 1];
  if (!last) return [sample];
  if (sample.at <= last.at) return series;
  if (!sameUsageWindow(last, sample, kind)) return [sample];
  if (
    sameUsed(last.used, sample.used) &&
    sample.at - last.at < DUPLICATE_WITHIN_MS
  )
    return series;
  const before = series[series.length - 2];
  const plateau =
    before != null &&
    sameUsed(before.used, last.used) &&
    sameUsed(last.used, sample.used);
  const oldest = sample.at - FORECAST_RULES[kind].windowMs;
  const next = [...(plateau ? series.slice(0, -1) : series), sample].filter(
    (item) => item.at > oldest,
  );
  return next.length > MAX_USAGE_SAMPLES
    ? next.slice(-MAX_USAGE_SAMPLES)
    : next;
}

function parseSample(row: unknown): UsageSample[] {
  if (!Array.isArray(row)) return [];
  const [at, used, resetsAt] = row as unknown[];
  if (
    typeof at !== "number" ||
    !Number.isFinite(at) ||
    typeof used !== "number" ||
    !Number.isFinite(used)
  )
    return [];
  return [
    {
      at,
      used,
      resetsAt:
        typeof resetsAt === "number" && Number.isFinite(resetsAt)
          ? resetsAt
          : null,
    },
  ];
}

export function loadUsageHistory(): UsageHistory {
  let saved: unknown;
  try {
    saved = JSON.parse(localStorage.getItem(USAGE_HISTORY_KEY) ?? "null");
  } catch {
    return {};
  }
  if (!saved || typeof saved !== "object" || (saved as { v?: unknown }).v !== 1)
    return {};
  const windows = (saved as { windows?: unknown }).windows;
  if (!windows || typeof windows !== "object") return {};
  const history: UsageHistory = {};
  for (const provider of PROVIDERS) {
    for (const kind of USAGE_WINDOW_KINDS) {
      const key = seriesKey(provider, kind);
      const rows = (windows as Record<string, unknown>)[key];
      if (!Array.isArray(rows)) continue;
      const samples = rows.flatMap(parseSample).sort((a, b) => a.at - b.at);
      if (samples.length) history[key] = samples.slice(-MAX_USAGE_SAMPLES);
    }
  }
  return history;
}

function saveUsageHistory(history: UsageHistory) {
  const windows: Record<string, [number, number, number | null][]> = {};
  for (const [key, samples] of Object.entries(history)) {
    if (!samples?.length) continue;
    windows[key] = samples.map((sample) => [
      sample.at,
      Math.round(sample.used * 100) / 100,
      sample.resetsAt,
    ]);
  }
  try {
    localStorage.setItem(USAGE_HISTORY_KEY, JSON.stringify({ v: 1, windows }));
  } catch {
    // History is a convenience; forecasts start again without it.
  }
}

/**
 * Records the windows of a fresh usage answer. Called wherever the app
 * receives new numbers; it never asks a provider itself.
 */
export function recordUsage(limits: ProviderRateLimits, now = Date.now()) {
  if (limits.status !== "ok" || !isRateLimitProvider(limits.provider)) return;
  if (!Number.isFinite(limits.updatedAt) || limits.updatedAt <= 0) return;
  const history = { ...loadUsageHistory() };
  let changed = false;
  for (const kind of USAGE_WINDOW_KINDS) {
    const window = limits[kind];
    if (!window || !Number.isFinite(window.usedPercent)) continue;
    const key = seriesKey(limits.provider, kind);
    const before = history[key] ?? [];
    const after = appendUsageSample(
      before,
      {
        at: limits.updatedAt,
        used: clampUsedPercent(window.usedPercent),
        resetsAt:
          window.resetsAt != null && Number.isFinite(window.resetsAt)
            ? window.resetsAt
            : null,
      },
      kind,
    );
    if (after === before) continue;
    history[key] = after;
    changed = true;
  }
  // A window that has reset with nothing newer tells us nothing more.
  for (const [key, samples] of Object.entries(history) as [
    SeriesKey,
    readonly UsageSample[],
  ][]) {
    const resetsAt = samples[samples.length - 1]?.resetsAt;
    if (resetsAt != null && now >= resetsAt) {
      delete history[key];
      changed = true;
    }
  }
  if (!changed) return;
  saveUsageHistory(history);
  invalidate();
}

type SeenWarning = { resetsAt: number | null; perHour: number };
export type SeenUsageWarnings = Partial<Record<SeriesKey, SeenWarning>>;

function loadSeenWarnings(): SeenUsageWarnings {
  let saved: unknown;
  try {
    saved = JSON.parse(localStorage.getItem(USAGE_WARNINGS_SEEN_KEY) ?? "null");
  } catch {
    return {};
  }
  if (!saved || typeof saved !== "object") return {};
  const seen: SeenUsageWarnings = {};
  for (const provider of PROVIDERS) {
    for (const kind of USAGE_WINDOW_KINDS) {
      const key = seriesKey(provider, kind);
      const value = (saved as Record<string, unknown>)[key] as
        Partial<SeenWarning> | undefined;
      if (
        !value ||
        typeof value.perHour !== "number" ||
        !(value.resetsAt === null || typeof value.resetsAt === "number")
      )
        continue;
      seen[key] = { resetsAt: value.resetsAt, perHour: value.perHour };
    }
  }
  return seen;
}

/** A warning is news in a new window, or when the pace has sped up since. */
export function isNewUsageWarning(
  pace: UsagePace,
  seen: SeenWarning | undefined,
): boolean {
  if (!seen) return true;
  const sameWindow =
    seen.resetsAt == null || pace.resetsAt == null
      ? seen.resetsAt === pace.resetsAt
      : Math.abs(seen.resetsAt - pace.resetsAt) <=
        FORECAST_RULES[pace.kind].resetToleranceMs;
  if (!sameWindow) return true;
  return pace.perHour >= seen.perHour * PACE_CHANGE;
}

export type UsageWarning = {
  provider: RateLimitProvider;
  kind: UsageWindowKind;
  pace: UsagePace;
  /** Not yet seen for this window at this pace. */
  unseen: boolean;
};

export type ProviderUsageForecast = {
  /** The latest reading of each window. */
  latest: Partial<Record<UsageWindowKind, UsageSample>>;
  paces: Partial<Record<UsageWindowKind, UsagePace>>;
};

export type UsageForecastSnapshot = {
  providers: Partial<Record<RateLimitProvider, ProviderUsageForecast>>;
  /** Each account's most urgent warning, judged at `at`. */
  warnings: Partial<Record<RateLimitProvider, UsageWarning>>;
  at: number;
};

function sameWarning(a: UsageWarning | undefined, b: UsageWarning) {
  return (
    a != null &&
    a.provider === b.provider &&
    a.kind === b.kind &&
    a.unseen === b.unseen &&
    a.pace.hitAt === b.pace.hitAt &&
    a.pace.to === b.pace.to &&
    a.pace.resetsAt === b.pace.resetsAt
  );
}

/**
 * Paces and warnings for every account. An unchanged warning keeps its
 * identity, so a component showing it does not render again.
 */
export function buildUsageForecasts(
  history: UsageHistory,
  seen: SeenUsageWarnings,
  now: number,
  previous?: UsageForecastSnapshot | null,
): UsageForecastSnapshot {
  const providers: UsageForecastSnapshot["providers"] = {};
  const warnings: UsageForecastSnapshot["warnings"] = {};
  for (const provider of PROVIDERS) {
    const forecast: ProviderUsageForecast = { latest: {}, paces: {} };
    let urgent: { warning: UsageWarning; msToLimit: number } | null = null;
    for (const kind of USAGE_WINDOW_KINDS) {
      const key = seriesKey(provider, kind);
      const samples = history[key];
      if (!samples?.length) continue;
      forecast.latest[kind] = samples[samples.length - 1];
      const pace = measurePace(samples, kind);
      if (!pace) continue;
      forecast.paces[kind] = pace;
      const outlook = usageOutlook(pace, now);
      if (outlook?.state !== "warning") continue;
      if (urgent && urgent.msToLimit <= outlook.msToLimit) continue;
      urgent = {
        warning: {
          provider,
          kind,
          pace,
          unseen: isNewUsageWarning(pace, seen[key]),
        },
        msToLimit: outlook.msToLimit,
      };
    }
    if (Object.keys(forecast.latest).length) providers[provider] = forecast;
    if (!urgent) continue;
    const before = previous?.warnings[provider];
    warnings[provider] = sameWarning(before, urgent.warning)
      ? before!
      : urgent.warning;
  }
  return { providers, warnings, at: now };
}

let snapshot: UsageForecastSnapshot | null = null;
const listeners = new Set<() => void>();
let recheck: ReturnType<typeof setTimeout> | null = null;

function build() {
  snapshot = buildUsageForecasts(
    loadUsageHistory(),
    loadSeenWarnings(),
    Date.now(),
    snapshot,
  );
  return snapshot;
}

/** The current forecasts; built from storage on first use. */
export function getUsageForecasts(): UsageForecastSnapshot {
  return snapshot ?? build();
}

function clearRecheck() {
  if (recheck == null) return;
  clearTimeout(recheck);
  recheck = null;
}

/**
 * Warnings change with time alone (readings age, windows reset, a limit
 * comes within range). One timer for the next such moment re-judges them;
 * nothing is fetched.
 */
function scheduleRecheck() {
  clearRecheck();
  if (!listeners.size || !snapshot) return;
  const now = Date.now();
  let next = Infinity;
  for (const forecast of Object.values(snapshot.providers)) {
    for (const pace of Object.values(forecast?.paces ?? {})) {
      const moment = pace ? nextOutlookChange(pace, now) : null;
      if (moment != null) next = Math.min(next, moment);
    }
  }
  if (!Number.isFinite(next)) return;
  recheck = setTimeout(
    () => {
      recheck = null;
      invalidate();
    },
    Math.min(next - now + 1000, MAX_RECHECK_MS),
  );
}

function invalidate() {
  if (!listeners.size) {
    snapshot = null;
    return;
  }
  build();
  scheduleRecheck();
  for (const listener of [...listeners]) listener();
}

/** Another window recorded usage or saw a warning. */
function onStorage(event: StorageEvent) {
  if (
    event.key === null ||
    event.key === USAGE_HISTORY_KEY ||
    event.key === USAGE_WARNINGS_SEEN_KEY
  )
    invalidate();
}

export function subscribeUsageForecasts(listener: () => void): () => void {
  const first = listeners.size === 0;
  listeners.add(listener);
  if (first) {
    window.addEventListener("storage", onStorage);
    getUsageForecasts();
    scheduleRecheck();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    window.removeEventListener("storage", onStorage);
    clearRecheck();
  };
}

/** The user has seen this warning; it stays quiet until the pace changes. */
export function markUsageWarningSeen(warning: UsageWarning, now = Date.now()) {
  const seen = loadSeenWarnings();
  seen[seriesKey(warning.provider, warning.kind)] = {
    resetsAt: warning.pace.resetsAt,
    perHour: warning.pace.perHour,
  };
  for (const [key, value] of Object.entries(seen) as [
    SeriesKey,
    SeenWarning,
  ][]) {
    if (value.resetsAt != null && value.resetsAt <= now) delete seen[key];
  }
  try {
    localStorage.setItem(USAGE_WARNINGS_SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Without storage the warning may show again; it never blocks anything.
  }
  invalidate();
}

/** Test seam. */
export function resetUsageForecasts() {
  snapshot = null;
  clearRecheck();
}
