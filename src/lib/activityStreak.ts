import type { ActivityEntry } from "./activity";

/**
 * Days with at least one completed task, for the dashboard's streak. The
 * activity ledger keeps only its newest entries, so the days it shows are
 * also remembered here; nothing else about a task is stored.
 */
export const STREAK_STORAGE_KEY = "aven.streak.v1";
/** About a year of active days; a streak can't be longer than what is kept. */
const DAY_LIMIT = 400;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar day, "2026-10-15". */
export function dayKey(at: number): string {
  const day = new Date(at);
  const month = String(day.getMonth() + 1).padStart(2, "0");
  const date = String(day.getDate()).padStart(2, "0");
  return `${day.getFullYear()}-${month}-${date}`;
}

/** Days on which the ledger recorded a completed task, oldest first. */
export function completedDays(
  entries: readonly Pick<ActivityEntry, "outcome" | "createdAt" | "team">[],
): string[] {
  const days = new Set<string>();
  for (const entry of entries)
    if (entry.outcome === "completed" && !entry.team?.member)
      days.add(dayKey(entry.createdAt));
  return [...days].sort();
}

/** Both lists' days, oldest first, keeping the newest `DAY_LIMIT`. */
export function mergeDays(
  a: readonly string[],
  b: readonly string[],
): string[] {
  return [...new Set([...a, ...b])].sort().slice(-DAY_LIMIT);
}

export function loadStreakDays(): string[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(STREAK_STORAGE_KEY) ?? "null",
    );
    const days = (parsed as { days?: unknown } | null)?.days;
    if (!Array.isArray(days)) return [];
    return mergeDays(
      days.filter(
        (day): day is string => typeof day === "string" && DAY_KEY.test(day),
      ),
      [],
    );
  } catch {
    return [];
  }
}

/** Remembers days with a completed task; writes only when one is new. */
export function noteActiveDays(days: readonly string[]): string[] {
  const stored = loadStreakDays();
  const merged = mergeDays(stored, days);
  if (merged.length !== stored.length) {
    try {
      localStorage.setItem(
        STREAK_STORAGE_KEY,
        JSON.stringify({ version: 1, days: merged }),
      );
    } catch {
      // The ledger's own days still count while storage is unavailable.
    }
  }
  return merged;
}

export function noteActiveDay(at: number) {
  noteActiveDays([dayKey(at)]);
}

/**
 * Consecutive days with a completed task, ending today, or yesterday while
 * today has none yet: a streak stays alive until a whole day passes without
 * one. `today` says whether today already counts.
 */
export function activityStreak(
  days: readonly string[],
  now: number,
): { days: number; today: boolean } {
  const active = new Set(days);
  // Noon steps a day at a time across daylight-saving changes.
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);
  const today = active.has(dayKey(cursor.getTime()));
  if (!today) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (active.has(dayKey(cursor.getTime()))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { days: count, today };
}
