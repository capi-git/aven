import { describe, expect, it } from "vitest";
import type { GitDiffIndex, GitPr } from "./fs";
import type { GithubWorkItemComment } from "./githubTasks";
import {
  mergeLineInstruction,
  mergeLineState,
  reviewReplyInstruction,
  type MergeLineDetails,
} from "./mergeLine";
import type { PrChecks } from "./prChecks";

function index(overrides: Partial<GitDiffIndex> = {}): GitDiffIndex {
  return {
    branch: "feat/line",
    files: [],
    additions: 0,
    deletions: 0,
    remote: "origin",
    upstream: "origin/feat/line",
    defaultBranch: "main",
    ahead: 0,
    behind: 0,
    aheadOfDefault: 2,
    ...overrides,
  };
}

const file = (relative: string) => ({
  path: `/repo/${relative}`,
  relative,
  status: "modified",
  additions: 1,
  deletions: 0,
  staged: false,
  unstaged: true,
});

const openPr: GitPr = {
  number: 434,
  title: "Merge line",
  url: "https://github.com/o/r/pull/434",
  state: "open",
};

function checks(overrides: Partial<PrChecks> = {}): PrChecks {
  return {
    number: 434,
    url: openPr.url,
    state: "open",
    checks: [{ name: "CI / test", state: "pass", url: "https://ci/1" }],
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "",
    isDraft: false,
    baseRefName: "main",
    ...overrides,
  };
}

const details = (
  c: Partial<PrChecks> = {},
  unresolvedThreads: MergeLineDetails["unresolvedThreads"] = 0,
): MergeLineDetails => ({ checks: checks(c), unresolvedThreads });

const summary = (state: ReturnType<typeof mergeLineState>) =>
  state && [
    state.status,
    state.tone,
    state.action?.kind,
    state.action?.id,
    state.action?.label,
  ];

describe("mergeLineState", () => {
  it("hides without Git, and on the default branch without a pull request", () => {
    expect(mergeLineState(null, null, null)).toBeNull();
    expect(mergeLineState(index({ branch: null }), null, null)).toBeNull();
    expect(
      mergeLineState(
        index({ branch: "main", files: [file("a.ts")] }),
        null,
        null,
      ),
    ).toBeNull();
    // A fresh branch with nothing on it yet has no next step.
    expect(
      mergeLineState(index({ upstream: null, aheadOfDefault: 0 }), null, null),
    ).toBeNull();
  });

  it("offers Commit and push for uncommitted changes, Commit without a remote", () => {
    expect(
      summary(
        mergeLineState(
          index({ files: [file("a.ts"), file("b.ts")] }),
          null,
          null,
        ),
      ),
    ).toEqual([
      "2 uncommitted changes",
      "muted",
      "git",
      "commit-push",
      "Commit and push",
    ]);
    expect(
      summary(
        mergeLineState(
          index({ files: [file("a.ts")], remote: null, upstream: null }),
          null,
          null,
        ),
      ),
    ).toEqual(["1 uncommitted change", "muted", "git", "commit", "Commit"]);
    // Behind its remote, a plain push would be refused: the agent does it.
    expect(
      summary(
        mergeLineState(index({ files: [file("a.ts")], behind: 2 }), null, null),
      ),
    ).toEqual([
      "1 uncommitted change",
      "muted",
      "agent",
      "commit-push",
      "Commit and push",
    ]);
  });

  it("offers Publish, Push and Create PR in turn", () => {
    expect(
      summary(mergeLineState(index({ upstream: null }), null, null)),
    ).toEqual(["Branch not published", "muted", "git", "publish", "Publish"]);
    expect(summary(mergeLineState(index({ ahead: 3 }), null, null))).toEqual([
      "3 commits not pushed",
      "muted",
      "git",
      "push",
      "Push",
    ]);
    expect(
      summary(
        mergeLineState(index({ ahead: 1, behind: 1 }), null, null),
      )?.slice(2, 4),
    ).toEqual(["agent", "commit-push"]);
    expect(summary(mergeLineState(index(), null, null))).toEqual([
      "No pull request",
      "muted",
      "git",
      "create-pr",
      "Create PR",
    ]);
    expect(mergeLineState(index({ aheadOfDefault: 0 }), null, null)).toBeNull();
  });

  it("shows only the link while the pull request is being read", () => {
    expect(mergeLineState(index(), openPr, null)).toEqual({
      status: "",
      tone: "muted",
      action: null,
    });
  });

  it("puts conflicts first, then failing checks, then review", () => {
    expect(
      summary(
        mergeLineState(
          index(),
          openPr,
          details({
            mergeable: "CONFLICTING",
            checks: [{ name: "x", state: "fail", url: "" }],
          }),
        ),
      ),
    ).toEqual(["Conflicts", "danger", "agent", "resolve-conflicts", "Resolve"]);
    expect(
      summary(
        mergeLineState(
          index(),
          openPr,
          details({
            checks: [{ name: "x", state: "fail", url: "" }],
            reviewDecision: "CHANGES_REQUESTED",
          }),
        ),
      ),
    ).toEqual(["1 check failing", "danger", "agent", "fix-checks", "Fix"]);
    expect(
      summary(
        mergeLineState(
          index(),
          openPr,
          details({ reviewDecision: "CHANGES_REQUESTED" }),
        ),
      ),
    ).toEqual(["Changes requested", "warning", "agent", "fix-review", "Fix"]);
    expect(summary(mergeLineState(index(), openPr, details({}, 2)))?.[0]).toBe(
      "Changes requested",
    );
  });

  it("waits quietly while checks run or GitHub works out mergeability", () => {
    expect(
      summary(
        mergeLineState(
          index(),
          openPr,
          details({ checks: [{ name: "x", state: "pending", url: "" }] }),
        ),
      ),
    ).toEqual(["Checks running", "muted", undefined, undefined, undefined]);
    expect(
      mergeLineState(
        index(),
        openPr,
        details({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }),
      )?.action,
    ).toBeNull();
    // An older native side sends no merge state at all.
    expect(
      mergeLineState(
        index(),
        openPr,
        details({ mergeable: undefined, mergeStateStatus: undefined }),
      )?.action,
    ).toBeNull();
  });

  it("keeps checking until the first review-thread read settles", () => {
    expect(summary(mergeLineState(index(), openPr, details({}, null)))).toEqual(
      ["Checking", "muted", undefined, undefined, undefined],
    );
    // Threads that can't be read leave the review decision to decide.
    expect(
      mergeLineState(index(), openPr, details({}, "unavailable"))?.status,
    ).toBe("Ready to merge");
    expect(
      mergeLineState(
        index(),
        openPr,
        details({ reviewDecision: "CHANGES_REQUESTED" }, "unavailable"),
      )?.status,
    ).toBe("Changes requested");
  });

  it("is ready to squash and merge when GitHub says it is clean", () => {
    expect(summary(mergeLineState(index(), openPr, details()))).toEqual([
      "Ready to merge",
      "success",
      "git",
      "merge",
      "Squash and merge",
    ]);
    expect(
      mergeLineState(index(), openPr, details({ mergeStateStatus: "UNSTABLE" }))
        ?.status,
    ).toBe("Ready to merge");
  });

  it("calls anything else Blocked and offers Investigate", () => {
    for (const mergeStateStatus of ["BLOCKED", "BEHIND", "DRAFT"])
      expect(
        summary(mergeLineState(index(), openPr, details({ mergeStateStatus }))),
      ).toEqual([
        "Blocked",
        "warning",
        "agent",
        "investigate-blocker",
        "Investigate",
      ]);
  });

  it("says Merged with no button, and shows on the default branch with an open PR", () => {
    expect(
      summary(mergeLineState(index(), { ...openPr, state: "merged" }, null)),
    ).toEqual(["Merged", "muted", undefined, undefined, undefined]);
    expect(
      mergeLineState(index({ branch: "main" }), openPr, details())?.status,
    ).toBe("Ready to merge");
  });
});

const thread = (
  overrides: Partial<GithubWorkItemComment> = {},
): GithubWorkItemComment => ({
  id: "c1",
  kind: "review_comment",
  author: "maya",
  body: "Rename this.\nIt reads oddly.",
  createdAt: "",
  url: "https://github.com/o/r/pull/434#discussion_r1",
  state: "",
  path: "src/a.ts",
  line: 12,
  resolved: false,
  threadId: "T1",
  replies: [],
  ...overrides,
});

describe("agent instructions", () => {
  it("starts with the editable instruction and adds the facts", () => {
    const text = mergeLineInstruction(
      "fix-checks",
      {
        index: index(),
        pr: openPr,
        checks: checks({
          checks: [
            { name: "CI / test", state: "fail", url: "https://ci/9" },
            { name: "lint", state: "pass", url: "" },
          ],
        }),
      },
      "Fix the checks.",
    );
    expect(text).toBe(
      [
        "Fix the checks.",
        "",
        "Branch: feat/line",
        "Base branch: main",
        `Pull request: #434 ${openPr.url}`,
        "",
        "Failing checks:",
        "- CI / test — https://ci/9",
      ].join("\n"),
    );
  });

  it("lists unresolved threads with file:line and change requests", () => {
    const text = mergeLineInstruction(
      "fix-review",
      {
        index: index(),
        pr: openPr,
        checks: checks(),
        comments: [
          thread(),
          thread({ id: "c2", resolved: true, body: "Old" }),
          thread({
            id: "r1",
            kind: "review",
            state: "CHANGES_REQUESTED",
            body: "Needs tests.",
            path: "",
            line: null,
          }),
          thread({ id: "r2", kind: "review", state: "APPROVED", body: "Nice" }),
        ],
      },
      "Fix review.",
    );
    expect(text).toContain(
      "Review comments:\n- src/a.ts:12 (maya):\n> Rename this.\n> It reads oddly.",
    );
    expect(text).toContain("- Review by maya:\n> Needs tests.");
    expect(text).not.toContain("Old");
    expect(text).not.toContain("Nice");
  });

  it("names what GitHub says blocks the pull request", () => {
    const text = mergeLineInstruction(
      "investigate-blocker",
      {
        index: index({ behind: 1 }),
        pr: openPr,
        checks: checks({
          mergeStateStatus: "BEHIND",
          reviewDecision: "REVIEW_REQUIRED",
        }),
      },
      "Investigate.",
    );
    expect(text).toContain(
      "GitHub says: merge state BEHIND, review decision REVIEW_REQUIRED, 1 commit behind upstream",
    );
  });

  it("writes a review reply request for one thread", () => {
    const text = reviewReplyInstruction(
      thread({ replies: [thread({ id: "c3", author: "jack", body: "Why?" })] }),
      "Fix it and draft a reply.",
    );
    expect(text).toBe(
      [
        "Fix it and draft a reply.",
        "",
        `Thread on src/a.ts:12 (${thread().url}):`,
        "maya:",
        "> Rename this.",
        "> It reads oddly.",
        "jack:",
        "> Why?",
      ].join("\n"),
    );
  });
});
