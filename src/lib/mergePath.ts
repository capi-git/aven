import type { GitDiffIndex, GitPr } from "./fs";
import type { PrChecksSummary } from "./prChecks";

/** Done, under way now, still to come, or blocked by an earlier step. */
export type MergeStepState = "done" | "active" | "todo" | "failed" | "waiting";

export type MergeStepId = "commit" | "push" | "pr" | "checks";

/** The one thing a step offers to do now, beside its label. */
export type MergeAction = "commit-push" | "push" | "publish" | "create-pr";

export type MergeStep = {
  id: MergeStepId;
  state: MergeStepState;
  label: string;
  /** A short muted line under the label, such as "3 checks". */
  detail?: string;
  action?: MergeAction;
};

export const MERGE_ACTION_LABEL: Record<MergeAction, string> = {
  "commit-push": "Commit and push",
  push: "Push",
  publish: "Publish",
  "create-pr": "Create",
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * The four steps between work in a copy and a merge, as the Checks tab shows
 * them. A step after one that is not done waits, so only the next thing to do
 * reads as open.
 */
export function mergeSteps(
  index: GitDiffIndex,
  pr: GitPr | null,
  checks: PrChecksSummary | null,
  checksFailedToLoad = false,
): MergeStep[] {
  const uncommitted = index.files.length;
  const committed = uncommitted === 0;
  const pushed = committed && !!index.upstream && index.ahead === 0;
  const openPr =
    pr && (pr.state === "open" || pr.state === "merged") ? pr : null;

  const commit: MergeStep = committed
    ? { id: "commit", state: "done", label: "Changes committed" }
    : {
        id: "commit",
        state: "todo",
        label: `${plural(uncommitted, "uncommitted change")}`,
        // Pushing needs a remote; without one, Commit is in Changes.
        action: index.remote && index.behind === 0 ? "commit-push" : undefined,
      };

  const push: MergeStep = !committed
    ? { id: "push", state: "waiting", label: "Push" }
    : pushed
      ? { id: "push", state: "done", label: "Pushed" }
      : !index.remote
        ? { id: "push", state: "todo", label: "No remote to push to" }
        : !index.upstream
          ? {
              id: "push",
              state: "todo",
              label: "Branch not published",
              action: "publish",
            }
          : {
              id: "push",
              state: "todo",
              label: `${plural(index.ahead, "commit")} not pushed`,
              action: index.behind === 0 ? "push" : undefined,
            };

  const prStep: MergeStep = openPr
    ? {
        id: "pr",
        state: "done",
        label:
          openPr.state === "merged"
            ? `PR #${openPr.number} merged`
            : `PR #${openPr.number} open`,
      }
    : {
        id: "pr",
        state: pushed ? "todo" : "waiting",
        label: "No PR open",
        // A pull request needs a branch other than the default one.
        action:
          pushed &&
          !!index.branch &&
          index.branch !== index.defaultBranch &&
          index.aheadOfDefault > 0
            ? "create-pr"
            : undefined,
      };

  let checksStep: MergeStep;
  if (!openPr) checksStep = { id: "checks", state: "waiting", label: "Checks" };
  else if (openPr.state === "merged")
    checksStep = { id: "checks", state: "done", label: "Merged" };
  else if (checksFailedToLoad)
    checksStep = {
      id: "checks",
      state: "todo",
      label: "Couldn't read the checks",
    };
  else if (!checks || checks.state === "none")
    checksStep = {
      id: "checks",
      state: checks ? "todo" : "active",
      label: checks ? "No checks reported" : "Looking for checks",
    };
  else
    checksStep = {
      id: "checks",
      state:
        checks.state === "passing"
          ? "done"
          : checks.state === "failing"
            ? "failed"
            : "active",
      label:
        checks.state === "passing"
          ? "All checks passing"
          : checks.state === "failing"
            ? `${plural(checks.failed, "check")} failing`
            : `${plural(checks.pending, "check")} running`,
      detail: plural(checks.total, "check"),
    };

  return [commit, push, prStep, checksStep];
}

/** How long a check ran, or has run so far: "4m 37s", "52s". */
export function checkDuration(
  startedAt: string | undefined,
  completedAt: string | undefined,
  now = Date.now(),
): string {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(start)) return "";
  const end = completedAt ? Date.parse(completedAt) : now;
  const seconds = Math.max(
    0,
    Math.round(((Number.isFinite(end) ? end : now) - start) / 1000),
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Seconds between refreshes while the Checks tab is in view. */
export const MERGE_PATH_REFRESH_S = 15;
