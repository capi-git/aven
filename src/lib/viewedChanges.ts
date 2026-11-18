import { useSyncExternalStore } from "react";
import type { GitChangedFile } from "./fs";

/**
 * Changed files you have opened, per project folder, as in Super's Changes
 * list. Each mark keeps the version of the change it was made on (status and
 * line counts), so a file that changes again reads as unviewed again.
 */
const KEY = "aven.viewedChanges";
/** Folders kept; the oldest written is dropped past this. */
const MAX_FOLDERS = 40;

type Marks = Record<string, Record<string, string>>;

let marks: Marks | null = null;
let version = 0;
const listeners = new Set<() => void>();

function read(): Marks {
  if (marks) return marks;
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    marks = value && typeof value === "object" ? (value as Marks) : {};
  } catch {
    marks = {};
  }
  return marks;
}

function write(next: Marks) {
  marks = next;
  version += 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* Marks still hold for this run. */
  }
  for (const listener of [...listeners]) listener();
}

/** What a mark is compared with: the change as the list shows it now. */
export function changeVersion(
  file: Pick<GitChangedFile, "status" | "additions" | "deletions">,
): string {
  return `${file.status}:${file.additions}:${file.deletions}`;
}

export function isViewed(
  folder: Record<string, string> | undefined,
  file: GitChangedFile,
): boolean {
  return folder?.[file.relative] === changeVersion(file);
}

/** The marks for one folder, or undefined when it has none. */
export function viewedIn(cwd: string): Record<string, string> | undefined {
  return read()[cwd];
}

export function setViewed(cwd: string, file: GitChangedFile, viewed: boolean) {
  const all = read();
  const folder = all[cwd] ?? {};
  if (viewed ? isViewed(folder, file) : !(file.relative in folder)) return;
  const nextFolder = { ...folder };
  if (viewed) nextFolder[file.relative] = changeVersion(file);
  else delete nextFolder[file.relative];
  // The folder written last moves to the end, so the oldest go first.
  const { [cwd]: _previous, ...rest } = all;
  const keys = Object.keys(rest);
  const kept =
    keys.length >= MAX_FOLDERS
      ? Object.fromEntries(
          keys
            .slice(keys.length - MAX_FOLDERS + 1)
            .map((key) => [key, rest[key]]),
        )
      : rest;
  write({ ...kept, [cwd]: nextFolder });
}

export function markViewed(cwd: string, file: GitChangedFile) {
  setViewed(cwd, file, true);
}

export function toggleViewed(cwd: string, file: GitChangedFile) {
  setViewed(cwd, file, !isViewed(viewedIn(cwd), file));
}

/** Forget marks for files that are no longer changed (committed, discarded). */
export function pruneViewed(cwd: string, files: readonly GitChangedFile[]) {
  const all = read();
  const folder = all[cwd];
  if (!folder) return;
  const current = new Set(files.map((file) => file.relative));
  const stale = Object.keys(folder).filter((path) => !current.has(path));
  if (stale.length === 0) return;
  const nextFolder = { ...folder };
  for (const path of stale) delete nextFolder[path];
  write({ ...all, [cwd]: nextFolder });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** One folder's marks; re-renders only when a mark changes. */
export function useViewedChanges(
  cwd: string,
): Record<string, string> | undefined {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  return viewedIn(cwd);
}

/** For tests: start from what storage holds. */
export function resetViewedChangesForTest() {
  marks = null;
  version += 1;
}
