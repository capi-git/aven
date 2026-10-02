import { useCallback, useSyncExternalStore } from "react";
import {
  gitDiffStats,
  subscribeGitChanged,
  type GitDiffStats,
} from "../lib/fs";

type Entry = {
  cwd: string;
  stats: GitDiffStats | null;
  listeners: Set<() => void>;
  inFlight: boolean;
  pending: boolean;
  epoch: number;
  /** When stats were last published; 0 means they must be reloaded on resume. */
  loadedAt: number;
  unsubscribeGit: (() => void) | null;
  onResume: (() => void) | null;
  onGitChanged: (() => void) | null;
};

const entries = new Map<string, Entry>();
/** Focus and visibility changes reuse stats this fresh instead of rerunning git. */
const RESUME_TTL_MS = 30_000;

function entryFor(cwd: string): Entry {
  const existing = entries.get(cwd);
  if (existing) return existing;
  const entry: Entry = {
    cwd,
    stats: null,
    listeners: new Set(),
    inFlight: false,
    pending: false,
    epoch: 0,
    loadedAt: 0,
    unsubscribeGit: null,
    onResume: null,
    onGitChanged: null,
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
      void load(entry);
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

function stale(entry: Entry) {
  return Date.now() - entry.loadedAt >= RESUME_TTL_MS;
}

/** Push stats from a fuller git index (diff pane) so the title-bar badge cannot lag behind. */
export function applyProjectDiffStats(cwd: string, stats: GitDiffStats) {
  if (!cwd || cwd === "~") return;
  const entry = entryFor(cwd);
  entry.epoch += 1;
  entry.loadedAt = Date.now();
  publish(entry, stats);
}

function start(entry: Entry) {
  if (entry.onResume) return;
  if (!entry.inFlight && stale(entry)) void load(entry);
  // Focus and visibility only refresh stale stats; git changes always reload.
  entry.onResume = () => {
    if (!document.hidden && !entry.inFlight && stale(entry)) void load(entry);
  };
  entry.onGitChanged = () => {
    void load(entry);
  };
  window.addEventListener("focus", entry.onResume);
  document.addEventListener("visibilitychange", entry.onResume);
  entry.unsubscribeGit = subscribeGitChanged(entry.onGitChanged);
}

function stop(entry: Entry) {
  entry.pending = false;
  // Git changes are not watched while nothing is subscribed, so a reopened
  // panel must not trust stats from before it closed.
  entry.loadedAt = 0;
  if (entry.onResume) {
    window.removeEventListener("focus", entry.onResume);
    document.removeEventListener("visibilitychange", entry.onResume);
  }
  entry.unsubscribeGit?.();
  entry.onResume = null;
  entry.onGitChanged = null;
  entry.unsubscribeGit = null;
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
      entry.listeners.add(listener);
      if (entry.listeners.size === 1) start(entry);
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size === 0) stop(entry);
      };
    },
    [active, cwd],
  );
  const getSnapshot = useCallback(() => {
    return active ? entryFor(cwd).stats : null;
  }, [active, cwd]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
