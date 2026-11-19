/**
 * Git and GitHub reads that several views of one copy make at once: every
 * visible chat's merge line and the Checks tab ask for the same branch
 * state, pull request and checks, and a Git change reaches all of them in
 * the same moment. Each read here runs once per key: callers that ask while
 * it runs share it, and a result less than SHARE_MS old is handed out again
 * unless the caller needs a fresh one.
 */
import { gitDiffIndex, gitPrStatus, type GitDiffIndex, type GitPr } from "./fs";
import { gitPrChecks, type PrChecks } from "./prChecks";

/** How long a finished read is good enough for a caller that is not after a change. */
export const SHARE_MS = 5_000;
/** A read started this recently already sees a change that was just reported. */
const JOIN_FRESH_MS = 300;

type Entry<T> = {
  promise: Promise<T>;
  startedAt: number;
  finishedAt: number | null;
};

function sharedRead<T>(
  entries: Map<string, Entry<T>>,
  key: string,
  read: () => Promise<T>,
  fresh: boolean,
  now = Date.now(),
): Promise<T> {
  const entry = entries.get(key);
  if (entry) {
    const running = entry.finishedAt === null;
    if (running && (!fresh || now - entry.startedAt <= JOIN_FRESH_MS))
      return entry.promise;
    if (!running && !fresh && now - entry.finishedAt! < SHARE_MS)
      return entry.promise;
  }
  const next: Entry<T> = { promise: read(), startedAt: now, finishedAt: null };
  entries.set(key, next);
  next.promise.then(
    () => {
      next.finishedAt = Date.now();
    },
    () => {
      // A failed read is never handed out again.
      if (entries.get(key) === next) entries.delete(key);
    },
  );
  return next.promise;
}

const indexReads = new Map<string, Entry<GitDiffIndex>>();
const prReads = new Map<string, Entry<GitPr | null>>();
const checksReads = new Map<string, Entry<PrChecks>>();

/** The copy's branch state (`git_diff_index`), shared between callers. */
export function sharedDiffIndex(
  cwd: string,
  fresh = false,
): Promise<GitDiffIndex> {
  return sharedRead(indexReads, cwd, () => gitDiffIndex(cwd), fresh);
}

/** The copy's pull request (`git_pr_status`), shared between callers. */
export function sharedPrStatus(
  cwd: string,
  fresh = false,
): Promise<GitPr | null> {
  return sharedRead(prReads, cwd, () => gitPrStatus(cwd), fresh);
}

/** One pull request's checks and merge state, shared between callers. */
export function sharedPrChecks(
  cwd: string,
  number: number,
  fresh = false,
): Promise<PrChecks> {
  return sharedRead(
    checksReads,
    `${cwd}#${number}`,
    () => gitPrChecks(cwd, number),
    fresh,
  );
}

/** For tests: forget every read. */
export function clearSharedGitReads() {
  indexReads.clear();
  prReads.clear();
  checksReads.clear();
}
