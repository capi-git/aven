import { errorText } from "./errors";
import {
  gitCommit,
  gitPrCreate,
  gitPrStatus,
  gitPush,
  gitStageAll,
  type GitChangedFile,
  type GitDiffIndex,
  type GitPr,
} from "./fs";
import { generatePrContent } from "./harness";
import { prNumberFromUrl } from "./prChecks";
import type { HarnessId } from "./session";

/** How far a Ship goes: a local commit, a push, or a push and a pull request. */
export type ShipMode = "commit" | "push" | "pr";
export type ShipStep = "stage" | "commit" | "push" | "pr";
/** Ship every changed file, or only what the person already staged. */
export type ShipScope = "all" | "staged";

export type ShipOption = {
  mode: ShipMode;
  label: string;
  available: boolean;
  /** Why it is unavailable, or what it will also do. */
  hint?: string;
};

export function onDefaultBranch(index: GitDiffIndex): boolean {
  return (
    !!index.branch &&
    !!index.defaultBranch &&
    index.branch === index.defaultBranch
  );
}

/**
 * The three ways to finish, with the reason any of them can't be used now.
 * Without uncommitted files there is nothing to commit, and a Ship pushes the
 * branch's commits and can open a pull request for them.
 */
export function shipOptions(
  index: GitDiffIndex,
  pr: GitPr | null,
  hasFiles = true,
): ShipOption[] {
  const openPr = pr?.state === "open" ? pr : null;
  const pushBlocked = !index.remote
    ? "This project has no remote to push to."
    : index.behind > 0
      ? `Pull the ${index.behind} incoming ${index.behind === 1 ? "commit" : "commits"} first.`
      : undefined;
  const prBlocked =
    pushBlocked ??
    (openPr
      ? `PR #${openPr.number} is already open. Pushing updates it.`
      : onDefaultBranch(index)
        ? `You're on ${index.branch}. Create a branch to open a pull request.`
        : !index.branch
          ? "Check out a branch to open a pull request."
          : undefined);
  if (!hasFiles) {
    const base = index.defaultBranch ?? "the default branch";
    const nothingToPush =
      !pushBlocked && !!index.upstream && index.ahead === 0
        ? "Everything here is already pushed."
        : undefined;
    const nothingNew =
      !prBlocked && index.aheadOfDefault === 0
        ? `Nothing here that ${base} doesn't have.`
        : undefined;
    return [
      {
        mode: "commit",
        label: "Commit",
        available: false,
        hint: "Nothing to commit.",
      },
      {
        mode: "push",
        label: "Push",
        available: !pushBlocked && !nothingToPush,
        hint:
          pushBlocked ??
          nothingToPush ??
          (openPr ? `Updates PR #${openPr.number}.` : undefined),
      },
      {
        mode: "pr",
        label: "Push & open PR",
        available: !prBlocked && !nothingNew,
        hint: prBlocked ?? nothingNew,
      },
    ];
  }
  return [
    { mode: "commit", label: "Commit", available: true },
    {
      mode: "push",
      label: "Commit & push",
      available: !pushBlocked,
      hint:
        pushBlocked ?? (openPr ? `Updates PR #${openPr.number}.` : undefined),
    },
    {
      mode: "pr",
      label: "Commit, push & open PR",
      available: !prBlocked,
      hint: prBlocked,
    },
  ];
}

export type ShipSummary = {
  files: number;
  additions: number;
  deletions: number;
  /** Unstaged files a scope of "all" stages before committing. */
  toStage: number;
};

/** The files a Ship commits, with their line counts. */
export function shipFiles(
  files: readonly GitChangedFile[],
  scope: ShipScope,
): GitChangedFile[] {
  return scope === "staged" ? files.filter((file) => file.staged) : [...files];
}

export function shipSummary(
  files: readonly GitChangedFile[],
  scope: ShipScope,
): ShipSummary {
  const shipped = shipFiles(files, scope);
  return {
    files: shipped.length,
    additions: shipped.reduce((sum, file) => sum + file.additions, 0),
    deletions: shipped.reduce((sum, file) => sum + file.deletions, 0),
    toStage:
      scope === "all" ? shipped.filter((file) => file.unstaged).length : 0,
  };
}

/**
 * Staged-only when the person staged a subset on purpose; otherwise
 * everything. With staging hidden in the Changes panel (`stagingShown`
 * false), a staged subset is not taken as deliberate, so everything ships.
 */
export function defaultShipScope(
  files: readonly GitChangedFile[],
  stagingShown = true,
): ShipScope {
  if (!stagingShown) return "all";
  const staged = files.some((file) => file.staged);
  const unstaged = files.some((file) => file.unstaged);
  return staged && unstaged ? "staged" : "all";
}

export type ShipPlan = {
  cwd: string;
  message: string;
  mode: ShipMode;
  scope: ShipScope;
  textHarness?: HarnessId;
  /** The branch's open pull request, which a push updates. */
  openPr: GitPr | null;
  /** False when there is nothing to commit and only the branch is shipped. */
  commit?: boolean;
};

export type ShippedPr = { number: number; url: string; created: boolean };

export type ShipResult = {
  mode: ShipMode;
  committed: boolean;
  pushed: boolean;
  pr: ShippedPr | null;
};

/** A step failed; `done` lists the steps that had already succeeded. */
export class ShipError extends Error {
  readonly step: ShipStep;
  readonly done: ShipStep[];
  constructor(step: ShipStep, done: ShipStep[], cause: unknown) {
    super(errorText(cause));
    this.name = "ShipError";
    this.step = step;
    this.done = done;
  }
}

export function shipSteps(
  plan: Pick<ShipPlan, "mode" | "scope" | "commit">,
): ShipStep[] {
  const commit = plan.commit !== false;
  return [
    ...(commit && plan.scope === "all" ? (["stage"] as const) : []),
    ...(commit ? (["commit"] as const) : []),
    ...(plan.mode !== "commit" ? (["push"] as const) : []),
    ...(plan.mode === "pr" ? (["pr"] as const) : []),
  ];
}

async function openPullRequest(
  plan: ShipPlan,
): Promise<{ number: number; url: string }> {
  const content = await generatePrContent(plan.cwd, plan.textHarness);
  if (!content) throw new Error("Couldn't prepare the pull request text.");
  const url = (
    await gitPrCreate(
      plan.cwd,
      content.title,
      content.body,
      content.base,
      content.head,
    )
  ).trim();
  const number = prNumberFromUrl(url) ?? (await gitPrStatus(plan.cwd))?.number;
  if (!number)
    throw new Error("GitHub didn't say which pull request it opened.");
  return { number, url };
}

/**
 * Stage, commit, push and open a pull request, as far as `plan.mode` goes.
 * Steps in `done` are skipped, so a retry after a failed push does not commit
 * twice. `onStep` reports each step as it starts.
 */
export async function runShip(
  plan: ShipPlan,
  options: {
    done?: readonly ShipStep[];
    onStep?: (step: ShipStep) => void;
  } = {},
): Promise<ShipResult> {
  const done: ShipStep[] = [...(options.done ?? [])];
  let pr: ShippedPr | null = null;
  for (const step of shipSteps(plan)) {
    if (done.includes(step)) continue;
    options.onStep?.(step);
    try {
      if (step === "stage") await gitStageAll(plan.cwd);
      else if (step === "commit") await gitCommit(plan.cwd, plan.message);
      else if (step === "push") await gitPush(plan.cwd);
      else pr = { ...(await openPullRequest(plan)), created: true };
    } catch (error) {
      throw new ShipError(step, done, error);
    }
    done.push(step);
  }
  const pushed = done.includes("push");
  if (!pr && pushed && plan.openPr?.state === "open") {
    pr = { number: plan.openPr.number, url: plan.openPr.url, created: false };
  }
  return { mode: plan.mode, committed: done.includes("commit"), pushed, pr };
}

/** What went wrong, in terms of what did and didn't happen. */
export function shipErrorText(error: unknown): string {
  if (!(error instanceof ShipError)) return errorText(error);
  const reason = error.message.trim() || "Unknown error";
  const committed = error.done.includes("commit");
  switch (error.step) {
    case "stage":
      return `Couldn't stage the changes. ${reason}`;
    case "commit":
      return `Couldn't commit. ${reason}`;
    case "push":
      return committed
        ? `Committed, but the push failed. ${reason}`
        : `The push failed. ${reason}`;
    case "pr":
      return `Pushed, but the pull request couldn't be opened. ${reason}`;
  }
}

export const SHIP_STEP_LABEL: Record<ShipStep, string> = {
  stage: "Staging changes…",
  commit: "Committing…",
  push: "Pushing…",
  pr: "Opening pull request…",
};

const SHIP_MODE_KEY = "aven.shipMode";

function isShipMode(value: unknown): value is ShipMode {
  return value === "commit" || value === "push" || value === "pr";
}

/** The way the person last finished a Ship, if they have. */
export function loadShipMode(): ShipMode | null {
  try {
    const raw = localStorage.getItem(SHIP_MODE_KEY);
    return isShipMode(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveShipMode(mode: ShipMode): void {
  try {
    localStorage.setItem(SHIP_MODE_KEY, mode);
  } catch {
    // Private mode or a full quota: the choice is only a default.
  }
}

/**
 * The last choice when it is possible now. Otherwise a push when a pull
 * request is already open or the last choice was a pull request, then the
 * furthest step that is possible, never further than a push by default.
 */
export function preferredShipMode(
  options: readonly ShipOption[],
  saved: ShipMode | null,
): ShipMode {
  const available = (mode: ShipMode) =>
    options.some((option) => option.mode === mode && option.available);
  if (saved && available(saved)) return saved;
  if (available("push")) return "push";
  return "commit";
}
