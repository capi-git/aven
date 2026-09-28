import { useEffect, useState } from "react";
import { ChevronRight, ExternalLink, GitBranch } from "./icons";
import { ProviderMarks } from "./ProviderMarks";
import {
  basename,
  gitWorktrees,
  revealPath,
  subscribeGitChanged,
  type GitWorktree,
} from "../lib/fs";
import { raceLaneAtPath } from "../lib/race";
import type { HarnessId } from "../lib/session";
import "./GitCopies.css";

/** Other checkouts refresh less often than the open folder; each costs several Git calls. */
const COPIES_POLL_MS = 10_000;
const FILES_SHOWN = 6;

export type CopySummary = {
  worktree: GitWorktree;
  name: string;
  detail: string;
  harness?: HarnessId;
  /** No uncommitted files and nothing the default branch lacks. */
  finished: boolean;
};

/** Other checkouts of this repository, most in need of attention first. */
export function summarizeCopies(worktrees: readonly GitWorktree[]): CopySummary[] {
  return worktrees
    .filter((worktree) => !worktree.current)
    .map((worktree) => {
      const race = raceLaneAtPath(worktree.path);
      const finished =
        !worktree.primary &&
        worktree.files.length === 0 &&
        worktree.aheadOfDefault === 0;
      return {
        worktree,
        name: race
          ? firstLine(race.race.prompt)
          : worktree.primary
            ? "Main copy"
            : copyName(worktree),
        detail: race ? race.lane.label : (worktree.branch ?? "Detached"),
        harness: race?.lane.harness,
        finished,
      };
    })
    .sort(
      (a, b) =>
        b.worktree.files.length - a.worktree.files.length ||
        b.worktree.aheadOfDefault - a.worktree.aheadOfDefault ||
        Number(a.finished) - Number(b.finished),
    );
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "Race"
  );
}

/** "fix/race-safety" → "Race safety"; falls back to the folder name. */
export function copyName(worktree: Pick<GitWorktree, "branch" | "path">): string {
  const branch = worktree.branch ?? "";
  if (branch.startsWith("aven/race/")) return "Race copy";
  const leaf = (branch.split("/").pop() || basename(worktree.path))
    .replace(/[-_]+/g, " ")
    .trim();
  return leaf ? leaf[0].toUpperCase() + leaf.slice(1) : "Copy";
}

function useWorktrees(cwd: string, enabled: boolean): GitWorktree[] {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  useEffect(() => {
    if (!enabled || !cwd || cwd === "~") return;
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (cancelled || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const next = await gitWorktrees(cwd);
        if (!cancelled) setWorktrees(next);
      } catch {
        if (!cancelled) setWorktrees([]);
      } finally {
        inFlight = false;
      }
    };
    // Poll only while the window is visible, like the open folder's index.
    let timer: number | null = null;
    const onFocus = () => void load();
    const onVisibility = () => {
      if (document.hidden) {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
        return;
      }
      timer ??= window.setInterval(onFocus, COPIES_POLL_MS);
      void load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const unsubscribe = subscribeGitChanged(onFocus);
    onVisibility();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
    };
  }, [cwd, enabled]);
  return worktrees;
}

/** Work waiting in other checkouts, e.g. agent and race copies of this project. */
export function GitCopies({ cwd, enabled }: { cwd: string; enabled: boolean }) {
  const copies = summarizeCopies(useWorktrees(cwd, enabled));
  const [open, setOpen] = useState<string | null>(null);
  if (copies.length === 0) return null;
  const waiting = copies.filter((copy) => !copy.finished).length;
  return (
    <section className="git-copies" aria-label="Other copies of this project">
      <h3 className="git-copies-title">
        Other copies
        <span>{waiting > 0 ? `${waiting} with work` : "All finished"}</span>
      </h3>
      {copies.map((copy) => {
        const { worktree } = copy;
        const expanded = open === worktree.path;
        const files = worktree.files.length;
        return (
          <div
            key={worktree.path}
            className="git-copy"
            data-finished={copy.finished || undefined}
          >
            <button
              type="button"
              className="git-copy-head"
              aria-expanded={expanded}
              title={worktree.path}
              onClick={() => setOpen(expanded ? null : worktree.path)}
            >
              <ChevronRight
                className="git-copy-chevron size-3 shrink-0"
                strokeWidth={2}
              />
              {copy.harness ? (
                <ProviderMarks harnesses={[copy.harness]} />
              ) : (
                <GitBranch className="size-3.5 shrink-0" strokeWidth={1.75} />
              )}
              <span className="git-copy-name">{copy.name}</span>
              <span
                className="git-copy-pill"
                data-tone={copy.finished ? "ok" : files > 0 ? "warn" : undefined}
              >
                {copy.finished
                  ? "Merged"
                  : files > 0
                    ? `${files} unsaved`
                    : `${worktree.aheadOfDefault} to merge`}
              </span>
            </button>
            <p className="git-copy-detail">
              <span className="min-w-0 truncate">{copy.detail}</span>
              {worktree.additions > 0 ? (
                <span className="git-copy-added">+{worktree.additions}</span>
              ) : null}
              {worktree.deletions > 0 ? (
                <span className="git-copy-deleted">−{worktree.deletions}</span>
              ) : null}
              {worktree.behindDefault > 0 ? (
                <span>{worktree.behindDefault} behind</span>
              ) : null}
            </p>
            {expanded ? (
              <div className="git-copy-files">
                {worktree.files.slice(0, FILES_SHOWN).map((file) => (
                  <p key={file.relative} title={file.relative}>
                    <span data-status={file.status}>
                      {file.status.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {file.relative}
                    </span>
                    {file.additions > 0 ? (
                      <span className="git-copy-added">+{file.additions}</span>
                    ) : null}
                    {file.deletions > 0 ? (
                      <span className="git-copy-deleted">−{file.deletions}</span>
                    ) : null}
                  </p>
                ))}
                {files > FILES_SHOWN ? (
                  <p className="text-content/45">+ {files - FILES_SHOWN} more</p>
                ) : null}
                {copy.finished ? (
                  <p className="text-content/45">
                    Nothing here that main doesn't have.
                  </p>
                ) : null}
                <button
                  type="button"
                  className="git-copy-action"
                  onClick={() => void revealPath(worktree.path)}
                >
                  <ExternalLink className="size-3" strokeWidth={1.75} />
                  Show in Finder
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
