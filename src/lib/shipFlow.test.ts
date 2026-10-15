import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitChangedFile, GitDiffIndex, GitPr } from "./fs";
import {
  defaultShipScope,
  loadShipMode,
  preferredShipMode,
  runShip,
  saveShipMode,
  ShipError,
  shipErrorText,
  shipOptions,
  shipSteps,
  shipSummary,
  type ShipPlan,
} from "./shipFlow";
import { generatePrContent } from "./harness";

const calls: string[] = [];
const native = vi.hoisted(() => ({
  fail: null as null | { command: string; message: string },
  prUrl: "https://github.com/o/r/pull/12",
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    calls.push(command);
    if (native.fail?.command === command) throw native.fail.message;
    if (command === "git_pr_create") return native.prUrl;
    if (command === "git_pr_status") return null;
    return undefined;
  },
}));
vi.mock("./harness", () => ({
  generatePrContent: vi.fn(async () => ({
    title: "Ship it",
    body: "## Summary",
    base: "main",
    head: "feature",
  })),
}));

afterEach(() => {
  calls.length = 0;
  native.fail = null;
  native.prUrl = "https://github.com/o/r/pull/12";
});

const index = (overrides: Partial<GitDiffIndex> = {}): GitDiffIndex => ({
  branch: "feature",
  files: [],
  additions: 0,
  deletions: 0,
  remote: "origin",
  upstream: "origin/feature",
  defaultBranch: "main",
  ahead: 0,
  behind: 0,
  aheadOfDefault: 0,
  ...overrides,
});

const file = (
  relative: string,
  staged: boolean,
  unstaged: boolean,
  additions = 1,
  deletions = 0,
): GitChangedFile => ({
  path: `/repo/${relative}`,
  relative,
  status: "modified",
  additions,
  deletions,
  staged,
  unstaged,
});

const openPr: GitPr = {
  number: 3,
  title: "Open",
  url: "https://github.com/o/r/pull/3",
  state: "open",
};

const plan = (overrides: Partial<ShipPlan> = {}): ShipPlan => ({
  cwd: "/repo",
  message: "Add things",
  mode: "pr",
  scope: "all",
  openPr: null,
  ...overrides,
});

describe("shipOptions", () => {
  it("offers all three ways on a published feature branch", () => {
    expect(shipOptions(index(), null).map((o) => o.available)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("explains why push and pull request are unavailable", () => {
    const local = shipOptions(index({ remote: null }), null);
    expect(local[1]).toMatchObject({
      available: false,
      hint: "This project has no remote to push to.",
    });
    expect(local[2].available).toBe(false);
    const behind = shipOptions(index({ behind: 2 }), null);
    expect(behind[1].hint).toBe("Pull the 2 incoming commits first.");
    const onMain = shipOptions(index({ branch: "main" }), null);
    expect(onMain[1].available).toBe(true);
    expect(onMain[2].hint).toBe(
      "You're on main. Create a branch to open a pull request.",
    );
  });

  it("says a push updates the open pull request", () => {
    const options = shipOptions(index(), openPr);
    expect(options[1]).toMatchObject({
      available: true,
      hint: "Updates PR #3.",
    });
    expect(options[2]).toMatchObject({
      available: false,
      hint: "PR #3 is already open. Pushing updates it.",
    });
  });
});

describe("ship scope and summary", () => {
  it("keeps a deliberate staged subset, otherwise ships everything", () => {
    expect(
      defaultShipScope([file("a", true, false), file("b", false, true)]),
    ).toBe("staged");
    expect(defaultShipScope([file("a", false, true)])).toBe("all");
    expect(defaultShipScope([file("a", true, false)])).toBe("all");
  });

  it("counts the files and lines that will be committed", () => {
    const files = [
      file("a", true, false, 10, 2),
      file("b", false, true, 3, 4),
      file("c", true, true, 1, 1),
    ];
    expect(shipSummary(files, "all")).toEqual({
      files: 3,
      additions: 14,
      deletions: 7,
      toStage: 2,
    });
    expect(shipSummary(files, "staged")).toEqual({
      files: 2,
      additions: 11,
      deletions: 3,
      toStage: 0,
    });
  });
});

describe("runShip", () => {
  it("stages, commits, pushes and opens a pull request in order", async () => {
    const steps: string[] = [];
    const result = await runShip(plan(), { onStep: (s) => steps.push(s) });
    expect(steps).toEqual(["stage", "commit", "push", "pr"]);
    expect(calls).toEqual([
      "git_stage_all",
      "git_commit",
      "git_push",
      "git_pr_create",
    ]);
    expect(result).toEqual({
      mode: "pr",
      committed: true,
      pushed: true,
      pr: { number: 12, url: "https://github.com/o/r/pull/12", created: true },
    });
  });

  it("commits only what is staged, and reports the PR a push updated", async () => {
    expect(shipSteps({ mode: "commit", scope: "staged" })).toEqual(["commit"]);
    const result = await runShip(
      plan({ mode: "push", scope: "staged", openPr }),
    );
    expect(calls).toEqual(["git_commit", "git_push"]);
    expect(result.pr).toEqual({
      number: 3,
      url: openPr.url,
      created: false,
    });
  });

  it("stops at a failed push and resumes without committing twice", async () => {
    native.fail = { command: "git_push", message: "rejected (fetch first)" };
    const error = await runShip(plan({ mode: "push" })).catch((e) => e);
    expect(error).toBeInstanceOf(ShipError);
    expect(error).toMatchObject({ step: "push", done: ["stage", "commit"] });
    expect(shipErrorText(error)).toBe(
      "Committed, but the push failed. rejected (fetch first)",
    );
    calls.length = 0;
    native.fail = null;
    await runShip(plan({ mode: "push" }), { done: error.done });
    expect(calls).toEqual(["git_push"]);
  });

  it("explains a pull request that could not be prepared", async () => {
    vi.mocked(generatePrContent).mockResolvedValueOnce(null);
    const error = await runShip(plan()).catch((e) => e);
    expect(shipErrorText(error)).toBe(
      "Pushed, but the pull request couldn't be opened. Couldn't prepare the pull request text.",
    );
    expect(
      shipErrorText(new ShipError("commit", [], "nothing to commit")),
    ).toBe("Couldn't commit. nothing to commit");
  });
});

describe("ship mode preference", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("remembers the last way of finishing under an aven key", () => {
    expect(loadShipMode()).toBeNull();
    saveShipMode("pr");
    expect(localStorage.getItem("aven.shipMode")).toBe("pr");
    expect(loadShipMode()).toBe("pr");
    localStorage.setItem("aven.shipMode", "deploy");
    expect(loadShipMode()).toBeNull();
  });

  it("falls back to the furthest possible step, at most a push", () => {
    const all = shipOptions(index(), null);
    expect(preferredShipMode(all, "pr")).toBe("pr");
    expect(preferredShipMode(all, null)).toBe("push");
    expect(preferredShipMode(shipOptions(index(), openPr), "pr")).toBe("push");
    expect(
      preferredShipMode(shipOptions(index({ remote: null }), null), "pr"),
    ).toBe("commit");
  });
});

describe("shipping a branch with nothing to commit", () => {
  it("offers a push and a pull request for commits main lacks", () => {
    const options = shipOptions(
      index({ ahead: 2, aheadOfDefault: 2 }),
      null,
      false,
    );
    expect(options.map((o) => [o.label, o.available])).toEqual([
      ["Commit", false],
      ["Push", true],
      ["Push & open PR", true],
    ]);
    const pushed = shipOptions(index({ aheadOfDefault: 2 }), null, false);
    expect(pushed[1]).toMatchObject({
      available: false,
      hint: "Everything here is already pushed.",
    });
    expect(pushed[2].available).toBe(true);
    expect(shipOptions(index(), null, false)[2]).toMatchObject({
      available: false,
      hint: "Nothing here that main doesn't have.",
    });
    expect(preferredShipMode(options, null)).toBe("push");
  });

  it("skips staging and committing", async () => {
    expect(shipSteps({ mode: "pr", scope: "all", commit: false })).toEqual([
      "push",
      "pr",
    ]);
    const result = await runShip(plan({ commit: false }));
    expect(calls).toEqual(["git_push", "git_pr_create"]);
    expect(result).toMatchObject({ committed: false, pushed: true });
  });
});
