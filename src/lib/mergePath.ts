import type { GitDiffIndex, GitPr } from "./fs";
import type { PrChecksSummary } from "./prChecks";

/** Done, under way now, still to come, or blocked by an earlier step. */
export type MergeStepState = "done" | "active" | "todo" | "failed" | "waiting";

export type MergeStepId = "commit" | "push" | "pr" | "checks";

export type MergeStep = {
  id: MergeStepId;
  state: MergeStepState;
  label: string;
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
        label: `${plural(uncommitted, "file")} not committed`,
      };

  const push: MergeStep = !committed
    ? { id: "push", state: "waiting", label: "Pushed" }
    : pushed
      ? { id: "push", state: "done", label: "Pushed" }
      : !index.remote
        ? { id: "push", state: "todo", label: "No remote to push to" }
        : !index.upstream
          ? { id: "push", state: "todo", label: "Branch not published" }
          : {
              id: "push",
              state: "todo",
              label: `${plural(index.ahead, "commit")} not pushed`,
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
      label: checks.label,
    };

  return [commit, push, prStep, checksStep];
}

/** Seconds between refreshes while the Checks tab is in view. */
export const MERGE_PATH_REFRESH_S = 15;
