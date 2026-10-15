import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import {
  gitChangeAffects,
  gitDiffStats,
  subscribeGitChangedPath,
  type GitDiffStats,
} from "../lib/fs";
import { projectKey } from "../lib/paths";

type Entry = {
  cwd: string;
  stats: GitDiffStats | null;
  listeners: Set<() => void>;
  /** Subscribers showing this tree's own changes (diff pane, title badge). */
  foreground: number;
  inFlight: boolean;
  pending: boolean;
  queued: boolean;
  epoch: number;
  /** When stats were last published; 0 means they must be reloaded. */
  loadedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
};

const entries = new Map<string, Entry>();
/** Focus and visibility changes reuse stats this fresh instead of rerunning git. */
const RESUME_TTL_MS = 30_000;
/** Projects shown only as a sidebar count refresh less eagerly on focus. */
const BACKGROUND_TTL_MS = 120_000;
/** A burst of agent edits in a background project settles into one git run. */
const BACKGROUND_SETTLE_MS = 1_000;
/** A project's first background read waits out launch work. */
const BACKGROUND_START_MS = 1_500;
/** Background reads share a small pool, so many projects never run git at once. */
const BACKGROUND_SLOTS = 2;

/** Bumps whenever any project's stats change. */
let revision = 0;
let watching = false;
const queue: Entry[] = [];
let running = 0;

function entryFor(cwd: string): Entry {
  const existing = entries.get(cwd);
  if (existing) return existing;
  const entry: Entry = {
    cwd,
    stats: null,
    listeners: new Set(),
    foreground: 0,
    inFlight: false,
    pending: false,
    queued: false,
    epoch: 0,
    loadedAt: 0,
    timer: null,
  };
  entries.set(cwd, entry);
  return entry;
}

function publish(entry: Entry, stats: GitDiffStats | null) {
  if (
    entry.stats?.files === stats?.files &&
    entry.stats?.additions === stats?.additions &&
    entry.stats?.deletions === stats?.deletions
  ) {
    return;
  }
  entry.stats = stats;
  revision += 1;
  for (const listener of entry.listeners) listener();
}

async function load(entry: Entry) {
  if (entry.listeners.size === 0 || document.hidden) {
    // A change seen while hidden must be picked up on the next resume.
    entry.loadedAt = 0;
    return;
  }
  if (entry.inFlight) {
    entry.pending = true;
    return;
  }
  entry.inFlight = true;
  const epoch = entry.epoch;
  try {
    const stats = await gitDiffStats(entry.cwd);
    settle(entry, epoch, stats);
  } catch {
    settle(entry, epoch, null);
  } finally {
    entry.inFlight = false;
    if (entry.pending) {
      entry.pending = false;
      request(entry, 0);
    }
  }
}

function settle(entry: Entry, epoch: number, stats: GitDiffStats | null) {
  if (epoch !== entry.epoch) return;
  if (entry.listeners.size === 0 || document.hidden) {
    entry.loadedAt = 0;
    return;
  }
  entry.loadedAt = Date.now();
  publish(entry, stats);
}

function drain() {
  while (running < BACKGROUND_SLOTS && queue.length > 0) {
    const entry = queue.shift()!;
    entry.queued = false;
    running += 1;
    void load(entry).finally(() => {
      running -= 1;
      drain();
    });
  }
}

function cancelTimer(entry: Entry) {
  if (entry.timer === null) return;
  clearTimeout(entry.timer);
  entry.timer = null;
}

/**
 * Reload a tree: at once for a foreground reader, otherwise after `delay`
 * through the shared pool. Requests made while one waits fold into it.
 */
function request(entry: Entry, delay: number) {
  if (entry.foreground > 0) {
    cancelTimer(entry);
    if (entry.queued) {
      queue.splice(queue.indexOf(entry), 1);
      entry.queued = false;
    }
    void load(entry);
    return;
  }
  if (entry.timer !== null || entry.queued) return;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (entry.inFlight) entry.pending = true;
    else if (!entry.queued) {
      entry.queued = true;
      queue.push(entry);
      drain();
    }
  }, delay);
}

function stale(entry: Entry) {
  const ttl = entry.foreground > 0 ? RESUME_TTL_MS : BACKGROUND_TTL_MS;
  return Date.now() - entry.loadedAt >= ttl;
}

/** Focus and visibility only refresh stale stats; git changes always reload. */
function onResume() {
  if (document.hidden) return;
  for (const entry of entries.values()) {
    if (entry.listeners.size > 0 && !entry.inFlight && stale(entry))
      request(entry, 0);
  }
}

/** A change names its folder when known; other projects keep their stats. */
function onGitChanged(path: string | null) {
  for (const entry of entries.values()) {
    if (!gitChangeAffects(path, entry.cwd)) continue;
    // Unwatched trees remember the change and reload when next shown.
    entry.loadedAt = 0;
    if (entry.listeners.size > 0) request(entry, BACKGROUND_SETTLE_MS);
  }
}

function watch() {
  if (watching) return;
  watching = true;
  window.addEventListener("focus", onResume);
  document.addEventListener("visibilitychange", onResume);
  subscribeGitChangedPath(onGitChanged);
}

function attach(entry: Entry, listener: () => void, foreground: boolean) {
  watch();
  const first = entry.listeners.size === 0;
  entry.listeners.add(listener);
  if (foreground) entry.foreground += 1;
  if (entry.inFlight || !stale(entry)) return;
  if (foreground && entry.foreground === 1) request(entry, 0);
  else if (first) request(entry, BACKGROUND_START_MS);
}

function detach(entry: Entry, listener: () => void, foreground: boolean) {
  entry.listeners.delete(listener);
  if (foreground) {
    entry.foreground -= 1;
    // A reopened diff pane or badge must not trust stats from before it
    // closed: changes made outside Aven are only seen by reading.
    if (entry.foreground === 0) entry.loadedAt = 0;
  }
  if (entry.listeners.size > 0) return;
  entry.pending = false;
  cancelTimer(entry);
}

/** Push stats from a fuller git index (diff pane) so the title-bar badge cannot lag behind. */
export function applyProjectDiffStats(cwd: string, stats: GitDiffStats) {
  if (!cwd || cwd === "~") return;
  const entry = entryFor(cwd);
  entry.epoch += 1;
  entry.loadedAt = Date.now();
  publish(entry, stats);
}

export function useProjectDiffStats(
  cwd: string,
  enabled: boolean,
): GitDiffStats | null {
  const active = enabled && Boolean(cwd) && cwd !== "~";
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!active) return () => undefined;
      const entry = entryFor(cwd);
      attach(entry, listener, true);
      return () => detach(entry, listener, true);
    },
    [active, cwd],
  );
  const getSnapshot = useCallback(() => {
    return active ? entryFor(cwd).stats : null;
  }, [active, cwd]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const NO_FILES: Readonly<Record<string, number>> = Object.freeze({});

function sameCounts(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
}

/**
 * Changed-file counts for many projects, keyed by `projectKey(path)`, for the
 * sidebar. Reads share the background pool, refresh when a change names the
 * project (or names nothing) or on focus after a longer interval, and pause
 * while the window is hidden. Unknown and clean projects are left out.
 */
export function useProjectsDiffFiles(
  paths: readonly string[],
  enabled: boolean,
): Readonly<Record<string, number>> {
  const signature = enabled
    ? [...new Set(paths.filter((path) => path && path !== "~"))].join("\n")
    : "";
  const list = useMemo(
    () => (signature ? signature.split("\n") : []),
    [signature],
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      const attached = list.map((cwd) => entryFor(cwd));
      for (const entry of attached) attach(entry, listener, false);
      return () => {
        for (const entry of attached) detach(entry, listener, false);
      };
    },
    [list],
  );
  const cache = useRef<{
    revision: number;
    list: readonly string[];
    value: Readonly<Record<string, number>>;
  } | null>(null);
  const getSnapshot = useCallback(() => {
    const cached = cache.current;
    if (cached && cached.revision === revision && cached.list === list)
      return cached.value;
    const next: Record<string, number> = {};
    for (const cwd of list) {
      const files = entries.get(cwd)?.stats?.files ?? 0;
      if (files > 0) next[projectKey(cwd)] = files;
    }
    const value =
      cached && sameCounts(cached.value, next)
        ? cached.value
        : Object.keys(next).length
          ? next
          : NO_FILES;
    cache.current = { revision, list, value };
    return value;
  }, [list]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
