import { useContext, useEffect, useState } from "react";
import {
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitMerge,
  Trash2,
} from "./icons";
import { ProviderMarks } from "./ProviderMarks";
import {
  basename,
  gitWorktrees,
  notifyGitChanged,
  removeGitWorktree,
  revealPath,
  subscribeGitChanged,
  type GitWorktree,
} from "../lib/fs";
import { LiveSessionsContext } from "../lib/liveSessions";
import { isEqualOrInside, pathKey, prettyCwd } from "../lib/paths";
import { finishRace, raceHost, raceLaneAtPath } from "../lib/race";
import {
  sessionNeedsInput,
  type HarnessId,
  type Session,
} from "../lib/session";
import "./GitCopies.css";

/** Other checkouts refresh less often than the open folder; each costs several Git calls. */
const COPIES_POLL_MS = 10_000;
const FILES_SHOWN = 6;

export type CopySummary = {
  worktree: GitWorktree;
  name: string;
  detail: string;
  harness?: HarnessId;
  /**
   * No uncommitted files and nothing the default branch lacks, even when a
   * squash merge left different commits. Never the main copy or a lane of a
   * race that is still running.
   */
  finished: boolean;
  /** The race this copy is a lane of, if any. */
  race?: ReturnType<typeof raceLaneAtPath>;
};

/** Other checkouts of this repository, most in need of attention first. */
export function summarizeCopies(
  worktrees: readonly GitWorktree[],
): CopySummary[] {
  return worktrees
    .filter((worktree) => !worktree.current)
    .map((worktree) => {
      const race = raceLaneAtPath(worktree.path);
      const finished =
        !worktree.primary &&
        worktree.files.length === 0 &&
        worktree.mergedIntoDefault &&
        race?.race.state !== "running";
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
        race,
      };
    })
    .sort(
      (a, b) =>
        Number(a.finished) - Number(b.finished) ||
        b.worktree.files.length - a.worktree.files.length ||
        b.worktree.aheadOfDefault - a.worktree.aheadOfDefault,
    );
}

/** Copies that still need attention, and finished ones to tuck away. */
export function partitionCopies(copies: readonly CopySummary[]): {
  active: CopySummary[];
  finished: CopySummary[];
} {
  return {
    active: copies.filter((copy) => !copy.finished),
    finished: copies.filter((copy) => copy.finished),
  };
}

/** The header count: copies holding work, then finished ones, e.g. "2 with work · 5 finished". */
export function copiesCountLabel(
  active: readonly CopySummary[],
  finished: readonly CopySummary[],
): string {
  if (finished.length === 0)
    return `${active.length} ${active.length === 1 ? "copy" : "copies"}`;
  // A clean main copy is listed for reference, not because it holds work.
  const withWork = active.filter(
    ({ worktree }) =>
      !worktree.primary ||
      worktree.files.length > 0 ||
      !worktree.mergedIntoDefault,
  ).length;
  return withWork > 0
    ? `${withWork} with work · ${finished.length} finished`
    : `${finished.length} finished`;
}

/** The status pill: what is left in a copy. */
export function copyStatusLabel(copy: CopySummary): string {
  const { worktree } = copy;
  const files = worktree.files.length;
  if (copy.finished) return "Merged";
  if (files > 0) return `${files} unsaved`;
  if (worktree.aheadOfDefault > 0)
    return `${worktree.aheadOfDefault} ${worktree.aheadOfDefault === 1 ? "commit" : "commits"}`;
  return worktree.behindDefault > 0 ? "Behind" : "Up to date";
}

/**
 * Whether an agent is working in `path` right now: mid-turn, with queued
 * messages, waiting on the user, or running subagents. Idle chats that only
 * point at the folder do not count.
 */
export function copyInUse(path: string, sessions: readonly Session[]): boolean {
  const roots = [path, prettyCwd(path)];
  return sessions.some((session) => {
    const active =
      session.busy ||
      (session.queuedMessages?.length ?? 0) > 0 ||
      sessionNeedsInput(session) ||
      session.liveAgents?.some((agent) => agent.status === "running");
    if (!active) return false;
    return [session.cwd, session.worktreeCwd].some(
      (where) => !!where && roots.some((root) => isEqualOrInside(where, root)),
    );
  });
}

/** Why Clean up leaves a copy alone, or null when it may be removed. */
export function cleanupSkipReason(
  copy: CopySummary,
  sessions: readonly Session[],
): string | null {
  const { worktree, race } = copy;
  if (worktree.primary) return "it's the main copy";
  if (worktree.current) return "it's open here";
  if (worktree.files.length > 0) return "it has unsaved files";
  if (!worktree.mergedIntoDefault) return "main doesn't have all of it";
  if (race?.race.state === "running") return "its race is still running";
  if (copyInUse(worktree.path, sessions)) return "an agent is using it";
  if (!race && !worktree.branch) return "it has no branch";
  if (!race && worktree.branch?.startsWith("aven/race/"))
    return "its race is no longer recorded";
  return null;
}

export type CleanupPlan = {
  remove: CopySummary[];
  skip: { copy: CopySummary; reason: string }[];
};

/** Which finished copies Clean up removes, and which it leaves and why. */
export function planCleanup(
  copies: readonly CopySummary[],
  sessions: readonly Session[],
): CleanupPlan {
  const plan: CleanupPlan = { remove: [], skip: [] };
  for (const copy of copies) {
    const reason = cleanupSkipReason(copy, sessions);
    if (reason) plan.skip.push({ copy, reason });
    else plan.remove.push(copy);
  }
  return plan;
}

export type CleanupResult = {
  removed: CopySummary[];
  failures: { copy: CopySummary; message: string }[];
};

/**
 * Remove finished copies one at a time, continuing past failures. Each copy
 * is checked again against a fresh listing and the sessions at that moment,
 * so one that gained work after the confirmation is kept. A running race is
 * never finished from here.
 */
export async function cleanUpCopies(
  cwd: string,
  copies: readonly CopySummary[],
  sessions: () => readonly Session[],
  onProgress?: (done: number) => void,
): Promise<CleanupResult> {
  const latest = summarizeCopies(await gitWorktrees(cwd));
  const result: CleanupResult = { removed: [], failures: [] };
  for (const [index, planned] of copies.entries()) {
    onProgress?.(index);
    const copy = latest.find(
      ({ worktree }) =>
        pathKey(worktree.path) === pathKey(planned.worktree.path),
    );
    if (!copy) {
      result.failures.push({
        copy: planned,
        message: "It's no longer part of the project.",
      });
      continue;
    }
    // Everything that stops a copy counting as finished is a skip reason.
    const reason = cleanupSkipReason(copy, sessions());
    if (reason) {
      result.failures.push({ copy, message: `Kept because ${reason}.` });
      continue;
    }
    try {
      await removeCopy(cwd, copy);
      result.removed.push(copy);
    } catch (error) {
      result.failures.push({
        copy,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  onProgress?.(copies.length);
  return result;
}

/** "A", "A and B", "A, B and C". */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What removing a copy throws away, for its confirmation. */
export function removalWarning(copy: CopySummary): string {
  const { worktree, race } = copy;
  if (race?.race.state === "running")
    return `This race is still running. Removing it stops its agents and deletes all ${race.race.lanes.length} of its copies, including unsaved and ignored files.`;
  if (!race && !worktree.branch)
    return "This copy has no branch. Create a branch in it before removing it so its commits stay reachable.";
  const parts = [
    race
      ? "The entire folder, including ignored files, will be deleted."
      : "The folder will be deleted. Copies with ignored files must be backed up and cleared first.",
  ];
  const files = worktree.files.length;
  if (files > 0)
    parts.push(
      `${files} unsaved ${files === 1 ? "file" : "files"} will be deleted.`,
    );
  if (worktree.aheadOfDefault > 0)
    parts.push(
      race
        ? `Its ${worktree.aheadOfDefault} unmerged ${worktree.aheadOfDefault === 1 ? "commit is" : "commits are"} deleted too.`
        : `Its branch keeps the ${worktree.aheadOfDefault} ${worktree.aheadOfDefault === 1 ? "commit" : "commits"} main doesn't have.`,
    );
  return parts.join(" ");
}

/** Remove a copy the right way: races clean up through their race. */
export async function removeCopy(cwd: string, copy: CopySummary) {
  const { race } = copy;
  if (!race) return removeGitWorktree(cwd, copy.worktree.path);
  if (race.race.state === "running") return finishRace(race.race, null);
  return raceHost.cleanup(race.race.root, [race.lane]);
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
export function copyName(
  worktree: Pick<GitWorktree, "branch" | "path">,
): string {
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

type CleanupState =
  | { phase: "confirm"; plan: CleanupPlan }
  | { phase: "running"; plan: CleanupPlan; done: number }
  | { phase: "done"; result: CleanupResult }
  | { phase: "error"; message: string };

/** Work waiting in other checkouts, e.g. agent and race copies of this project. */
export function GitCopies({ cwd, enabled }: { cwd: string; enabled: boolean }) {
  const copies = summarizeCopies(useWorktrees(cwd, enabled));
  const { active, finished } = partitionCopies(copies);
  const live = useContext(LiveSessionsContext);
  const sessions = () => live?.list() ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const [finishedOpen, setFinishedOpen] = useState(false);
  const [cleanup, setCleanup] = useState<CleanupState | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    path: string;
    message: string;
  } | null>(null);
  const remove = async (copy: CopySummary) => {
    const { path } = copy.worktree;
    setRemoving(path);
    setFailure(null);
    try {
      await removeCopy(cwd, copy);
      setConfirming(null);
      setOpen(null);
    } catch (error) {
      setFailure({
        path,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRemoving(null);
      notifyGitChanged();
    }
  };
  const cleanUp = async (plan: CleanupPlan) => {
    setCleanup({ phase: "running", plan, done: 0 });
    try {
      const result = await cleanUpCopies(cwd, plan.remove, sessions, (done) =>
        setCleanup({ phase: "running", plan, done }),
      );
      setCleanup({ phase: "done", result });
    } catch (error) {
      setCleanup({
        phase: "error",
        message: `Couldn't check the copies again. Nothing was removed. ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      notifyGitChanged();
    }
  };
  if (copies.length === 0) return null;
  const cleaning = cleanup?.phase === "running";

  const renderCopy = (copy: CopySummary) => {
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
            title={
              !copy.finished && files === 0 && worktree.aheadOfDefault > 0
                ? "Commit history differs from the default branch. Changes may already be merged."
                : undefined
            }
          >
            {copyStatusLabel(copy)}
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
                <span className="min-w-0 flex-1 truncate">{file.relative}</span>
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
            {confirming === worktree.path ? (
              <div
                className="git-copy-confirm"
                role="group"
                aria-label="Remove this copy?"
              >
                <p>{removalWarning(copy)}</p>
                <div>
                  <button
                    type="button"
                    className="git-copy-action"
                    data-tone="danger"
                    disabled={removing === worktree.path}
                    onClick={() => void remove(copy)}
                  >
                    {removing === worktree.path ? "Removing…" : "Remove copy"}
                  </button>
                  <button
                    type="button"
                    className="git-copy-action"
                    disabled={removing === worktree.path}
                    onClick={() => setConfirming(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="git-copy-actions">
                <button
                  type="button"
                  className="git-copy-action"
                  onClick={() => void revealPath(worktree.path)}
                >
                  <ExternalLink className="size-3" strokeWidth={1.75} />
                  Show in Finder
                </button>
                {worktree.primary ? null : (
                  <button
                    type="button"
                    className="git-copy-action"
                    onClick={() => {
                      setFailure(null);
                      setConfirming(worktree.path);
                    }}
                  >
                    <Trash2 className="size-3" strokeWidth={1.75} />
                    Remove
                  </button>
                )}
              </div>
            )}
            {failure?.path === worktree.path ? (
              <p className="git-copy-error" role="alert">
                {failure.message}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const renderCleanup = () => {
    if (!cleanup) return null;
    if (cleanup.phase === "error")
      return (
        <div className="git-copies-cleanup">
          <p className="git-copy-error" role="alert">
            {cleanup.message}
          </p>
        </div>
      );
    if (cleanup.phase === "done") {
      const { removed, failures } = cleanup.result;
      return (
        <div className="git-copies-cleanup">
          <p role="status">
            {removed.length === 0
              ? "Nothing was removed."
              : `Removed ${removed.length} ${removed.length === 1 ? "copy" : "copies"}.`}
          </p>
          {failures.length > 0 ? (
            <div role="alert">
              {failures.map(({ copy, message }) => (
                <p key={copy.worktree.path} className="git-copy-error">
                  {`${copy.name}: ${message}`}
                </p>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="git-copy-action"
            onClick={() => setCleanup(null)}
          >
            Done
          </button>
        </div>
      );
    }
    const { plan } = cleanup;
    const count = plan.remove.length;
    const races = plan.remove.some((copy) => copy.race);
    return (
      <div
        className="git-copies-cleanup git-copy-confirm"
        role="group"
        aria-label="Clean up finished copies?"
      >
        <p>
          {count === 0
            ? "Nothing can be cleaned up right now."
            : `Remove ${count} finished ${count === 1 ? "copy" : "copies"}: ${listNames(plan.remove.map((copy) => copy.name))}? Their changes are already on main. ${races ? "Race copies are deleted entirely, including ignored files; other copies" : "Copies"} with ignored files are kept.`}
        </p>
        {plan.skip.length > 0 ? (
          <p>
            {`Keeping ${listNames(plan.skip.map(({ copy, reason }) => `${copy.name} (${reason})`))}.`}
          </p>
        ) : null}
        <div>
          {count > 0 ? (
            <button
              type="button"
              className="git-copy-action"
              data-tone="danger"
              disabled={cleaning}
              onClick={() => void cleanUp(plan)}
            >
              {cleanup.phase === "running"
                ? `Removing ${Math.min(cleanup.done + 1, count)} of ${count}…`
                : `Remove ${count} ${count === 1 ? "copy" : "copies"}`}
            </button>
          ) : null}
          <button
            type="button"
            className="git-copy-action"
            disabled={cleaning}
            onClick={() => setCleanup(null)}
          >
            {count > 0 ? "Cancel" : "Close"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <section className="git-copies" aria-label="Other copies of this project">
      <h3 className="git-copies-title">
        Other copies
        <span>{copiesCountLabel(active, finished)}</span>
      </h3>
      {active.map(renderCopy)}
      {finished.length > 0 ? (
        <div className="git-copies-group">
          <button
            type="button"
            className="git-copy-head"
            aria-expanded={finishedOpen}
            title="Copies whose changes are already on main"
            onClick={() => setFinishedOpen(!finishedOpen)}
          >
            <ChevronRight
              className="git-copy-chevron size-3 shrink-0"
              strokeWidth={2}
            />
            <GitMerge className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span className="git-copy-name">{`Finished · ${finished.length}`}</span>
          </button>
          {cleanup?.phase === "confirm" || cleaning ? null : (
            <button
              type="button"
              className="git-copy-action"
              onClick={() =>
                setCleanup({
                  phase: "confirm",
                  plan: planCleanup(finished, sessions()),
                })
              }
            >
              <Trash2 className="size-3" strokeWidth={1.75} />
              Clean up
            </button>
          )}
        </div>
      ) : null}
      {renderCleanup()}
      {finishedOpen ? finished.map(renderCopy) : null}
    </section>
  );
}
