import type { GitDiffIndex, GitPr } from "./fs";
import type { GithubWorkItemComment } from "./githubTasks";
import type { PrCheck, PrChecks } from "./prChecks";
import { loadPrompt, type PromptId } from "./prompts";

/**
 * The merge line under a chat's message box: one status and the one next
 * step for the chat's branch, as Super Engineering shows it.
 */

/** Colour only on the status word (and the button's text for "ready"). */
export type MergeLineTone = "muted" | "danger" | "warning" | "success";

/** Plain Git, run by Aven itself. */
export type MergeLineGitAction =
  "commit-push" | "commit" | "push" | "publish" | "create-pr" | "merge";

/** An instruction sent to the chat's agent. */
export type MergeLineAgentAction =
  | "commit-push"
  | "resolve-conflicts"
  | "fix-checks"
  | "fix-review"
  | "investigate-blocker";

export type MergeLineAction =
  | { kind: "git"; id: MergeLineGitAction; label: string }
  | { kind: "agent"; id: MergeLineAgentAction; label: string };

export type MergeLineState = {
  status: string;
  tone: MergeLineTone;
  action: MergeLineAction | null;
};

/** What the line knows about an open pull request beyond `GitPr`. */
export type MergeLineDetails = {
  checks: PrChecks | null;
  /**
   * Unresolved review threads; null until the first read settles, and
   * "unavailable" when they can't be read (the review decision alone
   * decides then).
   */
  unresolvedThreads: number | "unavailable" | null;
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const git = (id: MergeLineGitAction, label: string): MergeLineAction => ({
  kind: "git",
  id,
  label,
});
const agent = (id: MergeLineAgentAction, label: string): MergeLineAction => ({
  kind: "agent",
  id,
  label,
});

/**
 * The line for this branch, or null when nothing applies: no Git, or the
 * default branch with no pull request.
 */
export function mergeLineState(
  index: GitDiffIndex | null,
  pr: GitPr | null,
  details: MergeLineDetails | null,
): MergeLineState | null {
  if (!index || !index.branch) return null;
  const openPr = pr?.state === "open" ? pr : null;
  const mergedPr = pr?.state === "merged" ? pr : null;
  const onDefault =
    !!index.defaultBranch && index.branch === index.defaultBranch;
  if (onDefault && !openPr) return null;

  const uncommitted = index.files.length;
  if (uncommitted > 0) {
    const status = plural(uncommitted, "uncommitted change");
    if (!index.remote)
      return { status, tone: "muted", action: git("commit", "Commit") };
    // A plain push would be refused: the agent brings the branch up to date.
    if (index.behind > 0)
      return {
        status,
        tone: "muted",
        action: agent("commit-push", "Commit and push"),
      };
    return {
      status,
      tone: "muted",
      action: git("commit-push", "Commit and push"),
    };
  }

  if (
    index.remote &&
    !index.upstream &&
    !onDefault &&
    !mergedPr &&
    index.aheadOfDefault > 0
  )
    return {
      status: "Branch not published",
      tone: "muted",
      action: git("publish", "Publish"),
    };
  if (index.upstream && index.ahead > 0)
    return {
      status: `${plural(index.ahead, "commit")} not pushed`,
      tone: "muted",
      action:
        index.behind > 0 ? agent("commit-push", "Push") : git("push", "Push"),
    };

  if (mergedPr) return { status: "Merged", tone: "muted", action: null };

  if (!openPr) {
    if (!index.remote) return null;
    const ready =
      !!index.upstream && index.ahead === 0 && index.aheadOfDefault > 0;
    return ready
      ? {
          status: "No pull request",
          tone: "muted",
          action: git("create-pr", "Create PR"),
        }
      : null;
  }

  const checks = details?.checks ?? null;
  // Still reading what GitHub says: the PR link alone, no guess.
  if (!checks) return { status: "", tone: "muted", action: null };
  const mergeable = (checks.mergeable ?? "").toUpperCase();
  const mergeState = (checks.mergeStateStatus ?? "").toUpperCase();
  if (mergeable === "CONFLICTING" || mergeState === "DIRTY")
    return {
      status: "Conflicts",
      tone: "danger",
      action: agent("resolve-conflicts", "Resolve"),
    };
  const failing = checks.checks.filter((check) => check.state === "fail");
  if (failing.length > 0)
    return {
      status: "Checks failing",
      tone: "danger",
      action: agent("fix-checks", "Fix"),
    };
  const decision = (checks.reviewDecision ?? "").toUpperCase();
  const threads = details?.unresolvedThreads ?? null;
  if (
    decision === "CHANGES_REQUESTED" ||
    (typeof threads === "number" && threads > 0)
  )
    return {
      status: "Changes requested",
      tone: "warning",
      action: agent("fix-review", "Fix"),
    };
  if (checks.checks.some((check) => check.state === "pending"))
    return { status: "Checks running", tone: "muted", action: null };
  // GitHub works mergeability out in the background after a push.
  // Unread review threads may still hold requested changes: no green yet.
  if (
    mergeable === "UNKNOWN" ||
    mergeState === "UNKNOWN" ||
    !mergeState ||
    threads === null
  )
    return { status: "Checking", tone: "muted", action: null };
  if (
    mergeable === "MERGEABLE" &&
    (mergeState === "CLEAN" ||
      mergeState === "HAS_HOOKS" ||
      mergeState === "UNSTABLE")
  )
    return {
      status: "Ready to merge",
      tone: "success",
      action: git("merge", "Squash and merge"),
    };
  return {
    status: "Blocked",
    tone: "warning",
    action: agent("investigate-blocker", "Investigate"),
  };
}

const AGENT_PROMPT: Record<MergeLineAgentAction, PromptId> = {
  "commit-push": "commit-push",
  "resolve-conflicts": "resolve-conflicts",
  "fix-checks": "fix-checks",
  "fix-review": "fix-review",
  "investigate-blocker": "investigate-blocker",
};

export type MergeLineFacts = {
  index: GitDiffIndex;
  pr: GitPr | null;
  checks: PrChecks | null;
  /** Review threads and reviews, for Fix on requested changes. */
  comments?: readonly GithubWorkItemComment[];
};

/** "src/app.ts:12", or the path alone. */
function where(comment: Pick<GithubWorkItemComment, "path" | "line">): string {
  if (!comment.path) return "";
  return comment.line != null
    ? `${comment.path}:${comment.line}`
    : comment.path;
}

function quote(text: string, limit = 1_500): string {
  const body = text.trim().replace(/\r\n?/g, "\n");
  const cut = body.length > limit ? `${body.slice(0, limit).trimEnd()}…` : body;
  return cut
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
}

function failingLines(checks: readonly PrCheck[]): string[] {
  return checks
    .filter((check) => check.state === "fail")
    .map((check) => `- ${check.name}${check.url ? ` — ${check.url}` : ""}`);
}

/** The open review threads and change requests, each with where and what. */
export function reviewLines(
  comments: readonly GithubWorkItemComment[],
): string[] {
  const lines: string[] = [];
  for (const comment of comments) {
    if (comment.kind === "review_comment" && !comment.resolved) {
      const place = where(comment);
      lines.push(
        `- ${place ? `${place} ` : ""}(${comment.author || "reviewer"}):\n${quote(comment.body)}`,
      );
      for (const reply of comment.replies)
        lines.push(
          `  Reply from ${reply.author || "someone"}:\n${quote(reply.body, 600)}`,
        );
    } else if (
      comment.kind === "review" &&
      comment.state.toUpperCase() === "CHANGES_REQUESTED" &&
      comment.body.trim()
    ) {
      lines.push(
        `- Review by ${comment.author || "reviewer"}:\n${quote(comment.body)}`,
      );
    }
  }
  return lines;
}

/**
 * The message an agent action sends: the editable instruction from
 * Settings › Prompts, then the facts it needs, which code adds.
 */
export function mergeLineInstruction(
  action: MergeLineAgentAction,
  facts: MergeLineFacts,
  instruction: string = loadPrompt(AGENT_PROMPT[action]),
): string {
  const { index, pr, checks } = facts;
  const data: string[] = [];
  if (index.branch) data.push(`Branch: ${index.branch}`);
  const base = checks?.baseRefName || index.defaultBranch;
  if (base) data.push(`Base branch: ${base}`);
  if (pr && pr.state === "open")
    data.push(`Pull request: #${pr.number} ${pr.url}`);
  if (action === "commit-push" && index.upstream)
    data.push(
      `Upstream: ${index.upstream} (${plural(index.behind, "commit")} behind, ${plural(index.ahead, "commit")} ahead)`,
    );
  if (action === "fix-checks" && checks) {
    const lines = failingLines(checks.checks);
    if (lines.length) data.push("", "Failing checks:", ...lines);
  }
  if (action === "fix-review") {
    const lines = reviewLines(facts.comments ?? []);
    if (lines.length) data.push("", "Review comments:", ...lines);
    else if (pr)
      data.push(
        "",
        "Read the review comments with `gh pr view --comments` or the GitHub API.",
      );
  }
  if (action === "investigate-blocker" && checks) {
    const facts = [
      checks.mergeStateStatus && `merge state ${checks.mergeStateStatus}`,
      checks.reviewDecision && `review decision ${checks.reviewDecision}`,
      checks.isDraft ? "draft" : "",
      index.behind > 0
        ? `${plural(index.behind, "commit")} behind upstream`
        : "",
    ].filter(Boolean);
    if (facts.length) data.push(`GitHub says: ${facts.join(", ")}`);
  }
  return [instruction.trim(), "", ...data].join("\n").trim();
}

/** The message Review's "Fix and reply" puts in the chat for one thread. */
export function reviewReplyInstruction(
  thread: GithubWorkItemComment,
  instruction: string = loadPrompt("review-replies"),
): string {
  const place = where(thread);
  const lines = [
    instruction.trim(),
    "",
    `Thread${place ? ` on ${place}` : ""}${thread.url ? ` (${thread.url})` : ""}:`,
    `${thread.author || "Reviewer"}:`,
    quote(thread.body),
  ];
  for (const reply of thread.replies)
    lines.push(`${reply.author || "Someone"}:`, quote(reply.body, 600));
  return lines.join("\n").trim();
}
