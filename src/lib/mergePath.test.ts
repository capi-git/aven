import { describe, expect, it } from "vitest";
import type { GitDiffIndex, GitPr } from "./fs";
import { checkDuration, mergeSteps } from "./mergePath";
import { summarizePrChecks } from "./prChecks";

function index(patch: Partial<GitDiffIndex> = {}): GitDiffIndex {
  return {
    branch: "feat/x",
    files: [],
    additions: 0,
    deletions: 0,
    remote: "origin",
    upstream: "origin/feat/x",
    defaultBranch: "main",
    ahead: 0,
    behind: 0,
    aheadOfDefault: 2,
    ...patch,
  };
}

const file = {
  path: "a.ts",
  additions: 1,
  deletions: 0,
} as unknown as GitDiffIndex["files"][number];
const pr: GitPr = {
  number: 7,
  title: "X",
  url: "https://x/pull/7",
  state: "open",
};

describe("mergeSteps", () => {
  it("waits on every later step while files are uncommitted", () => {
    const steps = mergeSteps(index({ files: [file, file] }), null, null);
    expect(steps.map((s) => s.state)).toEqual([
      "todo",
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(steps[0]).toMatchObject({
      label: "2 uncommitted changes",
      action: "commit-push",
    });
  });

  it("asks for a push when commits are ahead or the branch is new", () => {
    expect(mergeSteps(index({ ahead: 1 }), null, null)[1]).toMatchObject({
      state: "todo",
      label: "1 commit not pushed",
    });
    expect(mergeSteps(index({ upstream: null }), null, null)[1]).toMatchObject({
      label: "Branch not published",
      action: "publish",
    });
    // Behind its upstream: pull first, so no push is offered.
    expect(
      mergeSteps(index({ ahead: 1, behind: 2 }), null, null)[1].action,
    ).toBeUndefined();
  });

  it("shows No PR open as the next step once pushed", () => {
    const steps = mergeSteps(index(), null, null);
    expect(steps.map((s) => s.state)).toEqual([
      "done",
      "done",
      "todo",
      "waiting",
    ]);
    expect(steps[2]).toMatchObject({
      label: "No PR open",
      action: "create-pr",
    });
    // Nothing to open a pull request for on the default branch.
    expect(
      mergeSteps(index({ branch: "main", aheadOfDefault: 0 }), null, null)[2]
        .action,
    ).toBeUndefined();
  });

  it("follows the checks of an open pull request", () => {
    const running = summarizePrChecks([
      { name: "a", state: "pass", url: "" },
      { name: "b", state: "pending", url: "" },
    ]);
    expect(mergeSteps(index(), pr, running)[3].state).toBe("active");
    const failing = summarizePrChecks([{ name: "a", state: "fail", url: "" }]);
    expect(mergeSteps(index(), pr, failing)[3].state).toBe("failed");
    const passing = summarizePrChecks([{ name: "a", state: "pass", url: "" }]);
    const steps = mergeSteps(index(), pr, passing);
    expect(steps[2].label).toBe("PR #7 open");
    expect(steps[3]).toMatchObject({
      state: "done",
      label: "All checks passing",
      detail: "1 check",
    });
    expect(mergeSteps(index(), pr, null)[3]).toMatchObject({
      state: "active",
      label: "Looking for checks",
    });
  });

  it("ends at Merged for a merged pull request", () => {
    const steps = mergeSteps(index(), { ...pr, state: "merged" }, null);
    expect(steps[2].label).toBe("PR #7 merged");
    expect(steps[3]).toMatchObject({ state: "done", label: "Merged" });
  });

  it("says how long a check ran", () => {
    const start = "2026-11-16T10:00:00Z";
    expect(checkDuration(start, "2026-11-16T10:04:37Z")).toBe("4m 37s");
    expect(checkDuration(start, "2026-11-16T10:00:52Z")).toBe("52s");
    expect(checkDuration(start, undefined, Date.parse(start) + 65_000)).toBe(
      "1m 05s",
    );
    expect(checkDuration(undefined, undefined)).toBe("");
  });
});
