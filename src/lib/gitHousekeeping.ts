import { invoke } from "@tauri-apps/api/core";

export type MergedBranches = {
  base: string;
  remote: string | null;
  /** Local branches whose work is already in the base branch. */
  local: string[];
  /** Branches on the remote whose work is already in the base branch. */
  remoteBranches: string[];
};

export type BranchCleanup = {
  deletedLocal: string[];
  deletedRemote: string[];
  failed: string[];
};

export type ReleaseInfo = {
  tag: string;
  name: string;
  url: string;
  publishedAt: string;
};

export type ReleaseRun = {
  status: string;
  conclusion: string;
  url: string;
  createdAt: string;
  headSha: string;
};

export type ReleaseStatus = {
  base: string;
  latest: ReleaseInfo | null;
  /** Commits on the remote base branch since the latest release. */
  unreleased: number | null;
  version: string | null;
  /** Exact remote default-branch commit this status describes. */
  sourceSha: string | null;
  /** The declared version has no release tag yet. */
  versionUnreleased: boolean;
  workflow: string | null;
  workflowHasPublish: boolean;
  run: ReleaseRun | null;
};

export function gitMergedBranches(cwd: string): Promise<MergedBranches> {
  return invoke<MergedBranches>("git_merged_branches", { cwd });
}

export function gitDeleteMergedBranches(
  cwd: string,
  local: string[],
  remote: string[],
): Promise<BranchCleanup> {
  return invoke<BranchCleanup>("git_delete_merged_branches", {
    cwd,
    local,
    remote,
  });
}

export function gitPrSquashMerge(cwd: string, number: number): Promise<void> {
  return invoke<void>("git_pr_squash_merge", { cwd, number });
}

export function gitReleaseStatus(cwd: string): Promise<ReleaseStatus> {
  return invoke<ReleaseStatus>("git_release_status", { cwd });
}

export function gitReleaseStart(
  cwd: string,
  version: string,
  sourceSha: string,
): Promise<void> {
  return invoke<void>("git_release_start", { cwd, version, sourceSha });
}

export type ReleaseSummary = {
  tone: "ok" | "info" | "busy" | "warn";
  title: string;
  detail: string;
  /** Version the publish button would release, when one is ready. */
  publish: string | null;
};

/** What the release card says, from one status read. */
export function summarizeRelease(status: ReleaseStatus): ReleaseSummary {
  const latest = status.latest?.tag;
  const changes =
    status.unreleased === null
      ? null
      : status.unreleased === 0
        ? `Everything on ${status.base} is released.`
        : `${status.unreleased} ${status.unreleased === 1 ? "change" : "changes"} on ${status.base} since ${latest}.`;
  const ready =
    status.workflowHasPublish &&
    status.versionUnreleased &&
    status.version &&
    status.sourceSha
      ? status.version
      : null;
  if (status.run && status.run.status !== "completed")
    return {
      tone: "busy",
      title: "Release running",
      detail: "Building on GitHub. This usually takes about 20 minutes.",
      publish: null,
    };
  if (
    status.run &&
    status.run.conclusion &&
    status.run.conclusion !== "success" &&
    status.run.conclusion !== "skipped"
  )
    return {
      tone: "warn",
      title: "Last release run didn't finish",
      detail: changes ?? "Open the run on GitHub to see what stopped it.",
      publish: ready,
    };
  if (ready)
    return {
      tone: "info",
      title: `Version ${ready} is ready to publish`,
      detail: changes ?? `Publishes what's on GitHub's ${status.base}.`,
      publish: ready,
    };
  if (!latest)
    return {
      tone: "info",
      title: "No releases yet",
      detail: status.workflow
        ? "Set a version to publish the first release."
        : "This project has no release workflow.",
      publish: null,
    };
  if ((status.unreleased ?? 0) > 0)
    return {
      tone: "info",
      title: `${latest} is the latest release`,
      detail: `${changes} Set a new version to publish them.`,
      publish: null,
    };
  return {
    tone: "ok",
    title: `${latest} is up to date`,
    detail: changes ?? "",
    publish: null,
  };
}
