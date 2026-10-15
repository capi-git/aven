import { useCallback, useRef, useSyncExternalStore } from "react";
import {
  gitHistory,
  subscribeGitChanged,
  type GitHistoryCommit,
} from "../lib/fs";

export type GitHistorySnapshot = {
  commits: GitHistoryCommit[];
  /** HEAD's full sha; null in a folder without commits or outside Git. */
  head: string | null;
  /** False until the first read for this folder has finished. */
  loaded: boolean;
};

type Entry = {
  snapshot: GitHistorySnapshot;
  /** Newest read; an older read's result is ignored. */
  request: number;
  queued: boolean;
  listeners: Set<() => void>;
  stop: (() => void) | null;
};

const EMPTY: GitHistorySnapshot = { commits: [], head: null, loaded: false };
const entries = new Map<string, Entry>();

function entryFor(cwd: string): Entry {
  let entry = entries.get(cwd);
  if (!entry) {
    entry = {
      snapshot: EMPTY,
      request: 0,
      queued: false,
      listeners: new Set(),
      stop: null,
    };
    entries.set(cwd, entry);
  }
  return entry;
}

export function sameHistory(
  prev: readonly GitHistoryCommit[],
  next: readonly GitHistoryCommit[],
): boolean {
  if (prev.length !== next.length) return false;
  return prev.every((commit, i) => {
    const other = next[i];
    return (
      other &&
      commit.sha === other.sha &&
      commit.subject === other.subject &&
      commit.author === other.author &&
      commit.timestamp === other.timestamp &&
      commit.head === other.head &&
      commit.refs.length === other.refs.length &&
      commit.refs.every(
        (ref, j) =>
          other.refs[j]?.name === ref.name && other.refs[j]?.kind === ref.kind,
      )
    );
  });
}

function publish(entry: Entry, next: GitHistorySnapshot) {
  const prev = entry.snapshot;
  if (
    prev.loaded === next.loaded &&
    prev.head === next.head &&
    sameHistory(prev.commits, next.commits)
  )
    return;
  entry.snapshot = next;
  for (const listener of [...entry.listeners]) listener();
}

/**
 * Read the folder's history once for everyone watching it. Requests made in
 * the same tick (the header and the graph mounting together, one Git change
 * reaching both) share a single read.
 */
function load(cwd: string) {
  const entry = entryFor(cwd);
  if (entry.queued) return;
  entry.queued = true;
  queueMicrotask(() => {
    entry.queued = false;
    if (document.hidden || entry.listeners.size === 0) return;
    const current = ++entry.request;
    void Promise.resolve()
      .then(() => gitHistory(cwd))
      .then(
        (next) => {
          if (current !== entry.request) return;
          publish(entry, {
            commits: next.commits,
            head: next.head,
            loaded: true,
          });
        },
        () => {
          if (current !== entry.request) return;
          publish(entry, { commits: [], head: null, loaded: true });
        },
      );
  });
}

function subscribe(cwd: string, listener: () => void): () => void {
  const entry = entryFor(cwd);
  entry.listeners.add(listener);
  if (!entry.stop) {
    const onResume = () => {
      if (!document.hidden) load(cwd);
    };
    const unsubscribeGit = subscribeGitChanged(() => load(cwd));
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    entry.stop = () => {
      unsubscribeGit();
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }
  // Every newly visible reader refreshes; same-tick readers share the read.
  load(cwd);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size > 0) return;
    entry.stop?.();
    entry.stop = null;
    // A read still in flight must not publish to a later, unrelated reader.
    entry.request += 1;
  };
}

const noSubscription = () => () => {};

/**
 * The folder's recent commits, shared by the Changes header and its graph.
 * Reads while `enabled`, again on focus and Git changes; a hidden reader keeps
 * its last rows and starts no reads.
 */
export function useGitHistory(
  cwd: string,
  enabled: boolean,
): GitHistorySnapshot {
  const active = enabled && !!cwd && cwd !== "~";
  const last = useRef<GitHistorySnapshot>(
    cwd && cwd !== "~" ? (entries.get(cwd)?.snapshot ?? EMPTY) : EMPTY,
  );
  const subscribeStore = useCallback(
    (listener: () => void) =>
      active ? subscribe(cwd, listener) : noSubscription(),
    [active, cwd],
  );
  const getSnapshot = () => {
    if (active) last.current = entries.get(cwd)?.snapshot ?? EMPTY;
    else if (!cwd || cwd === "~") last.current = EMPTY;
    return last.current;
  };
  return useSyncExternalStore(subscribeStore, getSnapshot, getSnapshot);
}

/** The commit HEAD points at, if it is among the loaded commits. */
export function headCommit(
  history: GitHistorySnapshot,
): GitHistoryCommit | null {
  return (
    history.commits.find((commit) => commit.head) ??
    (history.head
      ? (history.commits.find((commit) => commit.sha === history.head) ?? null)
      : null)
  );
}
