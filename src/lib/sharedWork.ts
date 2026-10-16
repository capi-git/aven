import { isEditTool } from "./harness/preview";
import type { HarnessEvent } from "./harness/types";
import { displayPath, pathKey, resolveWorkspacePath } from "./paths";
import { HARNESS_TITLE, type HarnessId, type RuntimeMode } from "./session";

/**
 * Shared work: what each agent in a project is doing right now, so chats in
 * one project know about each other. Turns start and end in the harness
 * registry, and edited files come from the tool-call events Aven already
 * receives; nothing here polls or watches the disk. Kept in memory for this
 * window only, like the dev servers it sits beside.
 *
 * The store changes when a turn starts or ends and when a turn edits a file
 * it had not edited yet, never for streamed text. Subscribers hear only when
 * the overlaps change, and those keep their identity until they do.
 */

/** What the workspace knows about a chat, read only when needed. */
export type SharedWorkSession = {
  harness: HarnessId;
  /** Chat title without the provider prefix. */
  title: string;
  /** The chat's project folder. */
  project: string;
  /** The checkout it works in. */
  cwd: string;
  runtimeMode: RuntimeMode;
  /** First line of the user's latest request, when there is one. */
  request?: string;
};

export type SharedWorkTurn = {
  sessionId: string;
  harness: HarnessId;
  project: string;
  cwd: string;
  /** Turns in flight; the chat is working while this is above zero. */
  running: number;
  startedAt: number;
  endedAt?: number;
  /** Files the current (or last) turn edited: absolute, oldest first. */
  files: readonly string[];
};

/** Another working chat editing some of the same files. */
export type EditOverlap = {
  sessionId: string;
  harness: HarnessId;
  /** The shared files, relative to the project. */
  files: readonly string[];
};

/** Per chat, the other working chats editing its files. */
export type EditOverlapMap = Readonly<Record<string, readonly EditOverlap[]>>;

const MAX_FILES = 40;
const EMPTY: EditOverlapMap = Object.freeze({});

let turns: ReadonlyMap<string, SharedWorkTurn> = new Map();
let overlaps: EditOverlapMap = EMPTY;
let lookup: ((sessionId: string) => SharedWorkSession | undefined) | null =
  null;
const listeners = new Set<() => void>();

function commit(next: Map<string, SharedWorkTurn>) {
  turns = next;
  const computed = computeOverlaps([...next.values()]);
  const stable = stableOverlaps(overlaps, computed);
  const changed = stable !== overlaps;
  overlaps = stable;
  return changed;
}

function notify() {
  for (const listener of [...listeners]) listener();
}

export function subscribeSharedWork(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function sharedWorkTurns(): readonly SharedWorkTurn[] {
  return [...turns.values()];
}

/** Changes only when two working chats start or stop sharing a file. */
export function editOverlapsSnapshot(): EditOverlapMap {
  return overlaps;
}

/** The workspace says what it knows about its chats. */
export function installSharedWorkSessions(
  next: (sessionId: string) => SharedWorkSession | undefined,
): () => void {
  lookup = next;
  return () => {
    if (lookup === next) lookup = null;
  };
}

export function sharedWorkSession(
  sessionId: string,
): SharedWorkSession | undefined {
  try {
    return lookup?.(sessionId);
  } catch {
    return undefined;
  }
}

/** "Claude", "Codex": short enough for a sentence. */
export function agentName(harness: HarnessId): string {
  return harness === "claude" ? "Claude" : HARNESS_TITLE[harness];
}

/** A turn began. A turn queued behind a running one keeps its files. */
export function sharedWorkTurnStarted(
  input: { sessionId: string; harness: HarnessId; cwd: string },
  now = Date.now(),
): void {
  const existing = turns.get(input.sessionId);
  const next = new Map(turns);
  if (existing && existing.running > 0 && existing.harness === input.harness) {
    next.set(input.sessionId, { ...existing, running: existing.running + 1 });
  } else {
    next.set(input.sessionId, {
      sessionId: input.sessionId,
      harness: input.harness,
      project: sharedWorkSession(input.sessionId)?.project ?? input.cwd,
      cwd: input.cwd,
      running: 1,
      startedAt: now,
      files: [],
    });
  }
  if (commit(next)) notify();
}

export function sharedWorkTurnEnded(sessionId: string, now = Date.now()) {
  const existing = turns.get(sessionId);
  if (!existing || existing.running === 0) return;
  const running = existing.running - 1;
  const next = new Map(turns);
  next.set(sessionId, {
    ...existing,
    running,
    ...(running === 0 ? { endedAt: now } : {}),
  });
  if (commit(next)) notify();
}

/** The chat was closed or deleted: it no longer works here. */
export function forgetSharedWorkSession(sessionId: string): void {
  if (!turns.has(sessionId)) return;
  const next = new Map(turns);
  next.delete(sessionId);
  if (commit(next)) notify();
}

/**
 * Record the files a turn edits. Called for every harness event of a turn,
 * so anything that is not an edit tool returns at once.
 */
export function observeSharedWorkEvent(
  sessionId: string,
  event: HarnessEvent,
): void {
  if (event.type !== "tool.started" && event.type !== "tool.updated") return;
  if (!isEditTool(event.kind, event.title, event.preview)) return;
  const record = turns.get(sessionId);
  if (!record) return;
  const raw = [
    ...(event.paths ?? []),
    ...(event.preview?.path ? [event.preview.path] : []),
  ];
  if (raw.length === 0) return;
  let files: string[] | null = null;
  const known = new Set(record.files.map(pathKey));
  for (const path of raw) {
    const absolute = resolveWorkspacePath(path, record.cwd) ?? path;
    const key = pathKey(absolute);
    if (known.has(key)) continue;
    known.add(key);
    files ??= [...record.files];
    files.push(absolute);
  }
  if (!files) return;
  const next = new Map(turns);
  next.set(sessionId, { ...record, files: files.slice(-MAX_FILES) });
  if (commit(next)) notify();
}

/** Working chats in one project that edited the same files this turn. */
export function computeOverlaps(
  list: readonly SharedWorkTurn[],
): EditOverlapMap {
  const working = list.filter(
    (turn) => turn.running > 0 && turn.files.length > 0,
  );
  if (working.length < 2) return EMPTY;
  const result: Record<string, EditOverlap[]> = {};
  for (const a of working) {
    const mine = new Map(a.files.map((file) => [pathKey(file), file]));
    for (const b of working) {
      if (a === b || pathKey(a.project) !== pathKey(b.project)) continue;
      const shared = b.files.flatMap((file) => {
        const own = mine.get(pathKey(file));
        return own ? [displayPath(own, a.project)] : [];
      });
      if (shared.length)
        (result[a.sessionId] ??= []).push({
          sessionId: b.sessionId,
          harness: b.harness,
          files: shared,
        });
    }
  }
  return Object.keys(result).length ? result : EMPTY;
}

function sameOverlaps(
  a: readonly EditOverlap[],
  b: readonly EditOverlap[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.sessionId === b[index].sessionId &&
        entry.harness === b[index].harness &&
        entry.files.length === b[index].files.length &&
        entry.files.every((file, at) => file === b[index].files[at]),
    )
  );
}

/** Keep the previous map, and each chat's previous list, when unchanged. */
function stableOverlaps(
  previous: EditOverlapMap,
  next: EditOverlapMap,
): EditOverlapMap {
  if (previous === next) return previous;
  const keys = Object.keys(next);
  let same = keys.length === Object.keys(previous).length;
  const merged: Record<string, readonly EditOverlap[]> = {};
  for (const key of keys) {
    const before = previous[key];
    if (before && sameOverlaps(before, next[key])) merged[key] = before;
    else {
      merged[key] = next[key];
      same = false;
    }
  }
  if (same) return previous;
  return keys.length ? merged : EMPTY;
}

/** "src/App.tsx", "src/App.tsx and 2 more files". */
export function filesPhrase(files: readonly string[]): string {
  if (files.length <= 1) return files[0] ?? "";
  const more = files.length - 1;
  return `${files[0]} and ${more} more ${more === 1 ? "file" : "files"}`;
}

/** "Codex is also editing src/App.tsx" for the line above the message box. */
export function overlapSentence(list: readonly EditOverlap[]): string {
  if (!list.length) return "";
  const names = [...new Set(list.map((entry) => agentName(entry.harness)))];
  const files = [...new Set(list.flatMap((entry) => entry.files))];
  const who =
    names.length === 1
      ? `${names[0]} is`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are`;
  return `${who} also editing ${filesPhrase(files)}`;
}

/** Tests only: start from an empty store. */
export function resetSharedWork(): void {
  turns = new Map();
  overlaps = EMPTY;
  lookup = null;
  notify();
}
