import {
  basename,
  type GitChangedFile,
  type GitDiffIndex,
  type GitFileDiffKind,
} from "./fs";

/** "just now", "5m ago", "3h ago", "2d ago", "3w ago", then a date. */
export function shortTimeAgo(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return "";
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 35) return `${Math.floor(days / 7)}w ago`;
  try {
    const date = new Date(at);
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      ...(date.getFullYear() !== new Date(now).getFullYear()
        ? { year: "numeric" }
        : {}),
    }).format(date);
  } catch {
    return "";
  }
}

export type ChurnBar = {
  /** Share of the bar's full width, 0–1, against the largest file shown. */
  size: number;
  /** Share of this file's changed lines that are additions, 0–1. */
  added: number;
};

/**
 * A small proportional bar for a changed file. Sizes grow with the square
 * root of the changed lines so one huge file does not flatten the rest.
 */
export function churnBar(
  file: Pick<GitChangedFile, "additions" | "deletions">,
  largest: number,
): ChurnBar | null {
  const lines = file.additions + file.deletions;
  if (lines <= 0 || largest <= 0) return null;
  return {
    size: Math.max(0.12, Math.min(1, Math.sqrt(lines) / Math.sqrt(largest))),
    added: file.additions / lines,
  };
}

export function largestChurn(
  files: readonly Pick<GitChangedFile, "additions" | "deletions">[],
): number {
  return files.reduce(
    (max, file) => Math.max(max, file.additions + file.deletions),
    0,
  );
}

export function lineTotals(
  files: readonly Pick<GitChangedFile, "additions" | "deletions">[],
): { additions: number; deletions: number } {
  return files.reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

/** Where the branch stands against its upstream, in words. */
export function upstreamLabel(index: GitDiffIndex): string {
  if (!index.branch) return "No branch";
  if (!index.remote) return "Local only";
  if (!index.upstream) return `Not on ${index.remote} yet`;
  if (index.ahead > 0 && index.behind > 0)
    return `${index.ahead} to push · ${index.behind} to pull`;
  if (index.ahead > 0) return `${index.ahead} to push`;
  if (index.behind > 0) return `${index.behind} to pull`;
  return `Up to date with ${index.upstream}`;
}

/** "3 files" / "1 file". */
export function filesLabel(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

const SHOW_STAGING_KEY = "aven.changesStaging";

/**
 * Whether the Changes panel splits its files into Staged and Changes. Off by
 * default: the panel lists every changed file once and Ship it stages them.
 */
export function loadShowStaging(): boolean {
  try {
    return localStorage.getItem(SHOW_STAGING_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveShowStaging(show: boolean): void {
  try {
    localStorage.setItem(SHOW_STAGING_KEY, show ? "1" : "0");
  } catch {
    // Private mode or a full quota: the panel keeps the choice until it closes.
  }
}

/**
 * The diff a file opens from the single list: its newest edits, or the
 * staged change when nothing newer is left beside it.
 */
export function changeKindFor(
  file: Pick<GitChangedFile, "unstaged">,
): GitFileDiffKind {
  return file.unstaged ? "unstaged" : "staged";
}

/**
 * The question asked before discarding `files`. `whole` discards each file
 * back to its last commit, staged changes included, as the single list does;
 * otherwise only unstaged changes go and staged ones stay.
 */
export function discardPrompt(
  files: readonly Pick<GitChangedFile, "relative" | "status" | "staged">[],
  whole: boolean,
): { message: string; okLabel: string } | null {
  const [only] = files;
  if (!only) return null;
  if (files.length === 1) {
    const name = basename(only.relative);
    if (only.status === "untracked")
      return { message: `Delete untracked file ${name}?`, okLabel: "Delete" };
    if (whole && only.staged && only.status === "added")
      return {
        message: `Delete new file ${name}? This cannot be undone.`,
        okLabel: "Delete",
      };
    if (whole && only.staged)
      return {
        message: `Discard all changes in ${name}, including staged changes? This cannot be undone.`,
        okLabel: "Discard",
      };
    return {
      message: `Discard changes in ${name}? This cannot be undone.`,
      okLabel: "Discard",
    };
  }
  const n = files.length;
  if (!whole)
    return {
      message: `Discard all unstaged changes in ${n} files? This cannot be undone.`,
      okLabel: "Discard",
    };
  return {
    message: files.some((file) => file.staged)
      ? `Discard all changes in ${n} files, including staged changes? This cannot be undone.`
      : `Discard all changes in ${n} files? This cannot be undone.`,
    okLabel: "Discard",
  };
}
