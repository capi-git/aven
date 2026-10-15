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
  /** One plain sentence, shown on the card's single line. */
  title: string;
  /** More, shown when the card is opened; may be empty. */
  detail: string;
  /** Version the publish button would release, when one is ready. */
  publish: string | null;
};

function changesCount(count: number): string {
  return `${count} ${count === 1 ? "change" : "changes"}`;
}

/** What the Releases line says, from one status read. */
export function summarizeRelease(status: ReleaseStatus): ReleaseSummary {
  const latest = status.latest?.tag;
  const unreleased = status.unreleased ?? 0;
  const pending =
    latest && unreleased > 0
      ? `${changesCount(unreleased)} since ${latest} ${unreleased === 1 ? "isn't" : "aren't"} released yet.`
      : "";
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
      title: "Publishing a release on GitHub…",
      detail: "This usually takes about 20 minutes.",
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
      title: "The last release didn't finish",
      detail: [
        "Open the run on GitHub to see what stopped it.",
        latest ? `${latest} is still the live release.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      publish: ready,
    };
  if (ready)
    return {
      tone: "info",
      title: `${ready} is ready to publish`,
      detail: latest
        ? `${latest} is live now.${pending ? ` ${pending}` : ""}`
        : `It publishes what's on ${status.base} on GitHub.`,
      publish: ready,
    };
  if (!latest)
    return {
      tone: "info",
      title: "Nothing released yet",
      detail: "",
      publish: null,
    };
  if (unreleased > 0)
    return {
      tone: "info",
      title: `${latest} is live · ${changesCount(unreleased)} since then ${unreleased === 1 ? "isn't" : "aren't"} released yet`,
      detail: "",
      publish: null,
    };
  return {
    tone: "ok",
    title: `${latest} is live · everything on ${status.base} is released`,
    detail: "",
    publish: null,
  };
}
