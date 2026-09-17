import { useSyncExternalStore } from "react";
import { HARNESSES, type HarnessId } from "./session";

export type ActivityOutcome =
  "completed" | "failed" | "stopped" | "approval" | "question";
export type ActivityEntry = {
  id: string;
  sessionId: string;
  outcome: ActivityOutcome;
  title: string;
  summary: string;
  cwd: string;
  harness: HarnessId;
  model: string;
  createdAt: number;
  readAt: number | null;
  resolvedAt: number | null;
};
export type ActivityInput = Omit<
  ActivityEntry,
  "createdAt" | "readAt" | "resolvedAt"
> & { createdAt?: number };
export const ACTIVITY_STORAGE_KEY = "monocode.activity.v1";
export const ACTIVITY_LIMIT = 200;
const SEEN_LIMIT = 600;
const outcomes = new Set([
  "completed",
  "failed",
  "stopped",
  "approval",
  "question",
]);
const EMPTY: readonly ActivityEntry[] = [];
type Ledger = { version: 1; entries: readonly ActivityEntry[]; seen: string[] };
let ledger: Ledger = { version: 1, entries: EMPTY, seen: [] };
let lastRaw: string | null | undefined;
const listeners = new Set<() => void>();

function timestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 8.64e15
  );
}
function entryFrom(value: unknown): ActivityEntry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    !row.id ||
    typeof row.sessionId !== "string" ||
    !row.sessionId ||
    !outcomes.has(String(row.outcome)) ||
    !HARNESSES.includes(row.harness as HarnessId) ||
    !timestamp(row.createdAt) ||
    !["title", "summary", "cwd", "model"].every(
      (key) => typeof row[key] === "string",
    )
  )
    return null;
  return {
    id: row.id.slice(0, 512),
    sessionId: row.sessionId.slice(0, 256),
    outcome: row.outcome as ActivityOutcome,
    harness: row.harness as HarnessId,
    title: (row.title as string).slice(0, 180),
    summary: (row.summary as string).slice(0, 240),
    cwd: (row.cwd as string).slice(0, 2048),
    model: (row.model as string).slice(0, 256),
    createdAt: row.createdAt,
    readAt: timestamp(row.readAt) ? row.readAt : null,
    resolvedAt: timestamp(row.resolvedAt) ? row.resolvedAt : null,
  };
}
function readLedger(): Ledger {
  let raw: string | null;
  try {
    raw = localStorage.getItem(ACTIVITY_STORAGE_KEY);
  } catch {
    return ledger;
  }
  if (raw === lastRaw) return ledger;
  lastRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries))
      throw new Error("Unknown activity format");
    const ids = new Set<string>();
    const entries = parsed.entries
      .map(entryFrom)
      .filter((entry: ActivityEntry | null): entry is ActivityEntry => {
        if (!entry || ids.has(entry.id)) return false;
        ids.add(entry.id);
        return true;
      })
      .sort((a: ActivityEntry, b: ActivityEntry) => b.createdAt - a.createdAt)
      .slice(0, ACTIVITY_LIMIT);
    ledger = {
      version: 1,
      entries,
      seen: Array.isArray(parsed.seen)
        ? [
            ...new Set<string>(
              parsed.seen.filter(
                (id: unknown) => typeof id === "string" && id.length <= 512,
              ),
            ),
          ].slice(-SEEN_LIMIT)
        : [],
    };
  } catch {
    ledger = { version: 1, entries: EMPTY, seen: [] };
  }
  return ledger;
}
function writeLedger(next: Ledger) {
  ledger = next;
  const raw = JSON.stringify(next);
  try {
    localStorage.setItem(ACTIVITY_STORAGE_KEY, raw);
    lastRaw = raw;
  } catch {
    // Keep a usable in-memory history when storage is unavailable or full.
  }
  for (const listener of listeners) listener();
}
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== ACTIVITY_STORAGE_KEY) return;
  readLedger();
  for (const listener of listeners) listener();
}
export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined")
    window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined")
      window.removeEventListener("storage", onStorage);
  };
}
export function getActivitySnapshot(): readonly ActivityEntry[] {
  return readLedger().entries;
}
export function useActivity(): readonly ActivityEntry[] {
  return useSyncExternalStore(
    subscribeActivity,
    getActivitySnapshot,
    () => EMPTY,
  );
}

/** Exact event identities survive read, resolve, clear and restart. No transcript is stored. */
export function recordActivity(
  input: ActivityInput,
  read = false,
): { added: boolean; entry?: ActivityEntry } {
  const current = readLedger();
  const entry = entryFrom({
    ...input,
    createdAt: input.createdAt ?? Date.now(),
    readAt: read ? Date.now() : null,
    resolvedAt: null,
  });
  if (!entry) return { added: false };
  const previous = current.entries.find((item) => item.id === entry.id);
  if (previous || current.seen.includes(entry.id))
    return { added: false, entry: previous };
  writeLedger({
    version: 1,
    entries: [entry, ...current.entries]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, ACTIVITY_LIMIT),
    seen: [...current.seen, entry.id].slice(-SEEN_LIMIT),
  });
  return { added: true, entry };
}
function updateEntries(update: (entry: ActivityEntry) => ActivityEntry) {
  const current = readLedger();
  const entries = current.entries.map(update);
  if (entries.some((entry, i) => entry !== current.entries[i]))
    writeLedger({ ...current, entries });
}
export function markActivityRead(id: string) {
  const now = Date.now();
  updateEntries((entry) =>
    entry.id === id && entry.readAt === null
      ? { ...entry, readAt: now }
      : entry,
  );
}
/** Call only when this session's transcript is actually visible in a focused window. */
export function markSessionActivityRead(
  sessionId: string,
  through = Date.now(),
) {
  const now = Date.now();
  updateEntries((entry) =>
    entry.sessionId === sessionId &&
    entry.createdAt <= through &&
    entry.readAt === null
      ? { ...entry, readAt: now }
      : entry,
  );
}
export function markAllActivityRead() {
  const now = Date.now();
  updateEntries((entry) =>
    entry.readAt === null ? { ...entry, readAt: now } : entry,
  );
}
export function isPendingActivity(entry: ActivityEntry): boolean {
  return (
    (entry.outcome === "approval" || entry.outcome === "question") &&
    entry.resolvedAt === null
  );
}
/** Resolving a request does not imply that its outcome has been seen. */
export function reconcileSessionActivityInputs(
  sessionId: string,
  activeIds: readonly string[],
) {
  const active = new Set(activeIds);
  const now = Date.now();
  updateEntries((entry) =>
    entry.sessionId === sessionId &&
    isPendingActivity(entry) &&
    !active.has(entry.id)
      ? { ...entry, resolvedAt: now }
      : entry,
  );
}
export function clearActivityHistory({
  keepPending = false,
}: { keepPending?: boolean } = {}) {
  const current = readLedger();
  const entries = keepPending
    ? current.entries.filter(isPendingActivity)
    : EMPTY;
  if (entries.length !== current.entries.length)
    writeLedger({ ...current, entries });
}
