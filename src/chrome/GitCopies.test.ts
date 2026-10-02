import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitWorktree } from "../lib/fs";
import { finishRace, type RaceRecord } from "../lib/race";
import { newSession, type Session } from "../lib/session";
import {
  cleanUpCopies,
  copiesCountLabel,
  copyInUse,
  copyName,
  copyStatusLabel,
  partitionCopies,
  planCleanup,
  removalWarning,
  removeCopy,
  summarizeCopies,
  type CopySummary,
} from "./GitCopies";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../lib/race", async (original) => ({
  ...(await original<typeof import("../lib/race")>()),
  finishRace: vi.fn(),
}));

function copy(overrides: Partial<GitWorktree>): GitWorktree {
  return {
    path: "/copies/x",
    branch: "feature",
    current: false,
    primary: false,
    files: [],
    additions: 0,
    deletions: 0,
    aheadOfDefault: 0,
    behindDefault: 0,
    mergedIntoDefault:
      !overrides.files?.length && (overrides.aheadOfDefault ?? 0) === 0,
    ...overrides,
  };
}

const file = (relative: string) => ({
  path: `/copies/${relative}`,
  relative,
  status: "modified",
  additions: 1,
  deletions: 0,
  staged: false,
  unstaged: true,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function raceRecord(state: RaceRecord["state"]): RaceRecord {
  return {
    id: "race-1",
    project: "/repo",
    root: "/repo",
    base: "abc",
    prompt: "Try designs",
    createdAt: 1,
    uncommitted: false,
    untracked: false,
    state,
    lanes: [0, 1].map((slot) => ({
      sessionId: `s${slot}`,
      harness: "claude",
      model: "opus",
      label: "Claude Code",
      path: `/races/race-1/${slot}`,
      branch: `aven/race/race-1-${slot}`,
    })),
  };
}

function summary(
  overrides: Partial<GitWorktree>,
  race?: RaceRecord,
  name = "Copy",
): CopySummary {
  const worktree = copy(overrides);
  return {
    worktree,
    name,
    detail: "",
    finished:
      !worktree.primary &&
      !worktree.current &&
      worktree.files.length === 0 &&
      worktree.mergedIntoDefault &&
      race?.state !== "running",
    ...(race ? { race: { race, lane: race.lanes[0] } } : {}),
  };
}

function session(overrides: Partial<Session>): Session {
  return { ...newSession("claude", "/repo"), ...overrides };
}

describe("other copies", () => {
  it("names copies after their branch or folder", () => {
    expect(copyName({ branch: "fix/race-safety", path: "/a" })).toBe(
      "Race safety",
    );
    expect(copyName({ branch: "aven/race/beecf69588-1", path: "/a" })).toBe(
      "Race copy",
    );
    expect(copyName({ branch: null, path: "/work/tab_groups" })).toBe(
      "Tab groups",
    );
  });

  it("hides the open copy and lists unsaved work first, finished copies last", () => {
    const copies = summarizeCopies([
      copy({ path: "/repo", branch: "main", primary: true }),
      copy({ path: "/open", current: true, files: [file("a.ts")] }),
      copy({ path: "/done", branch: "feat/tab-groups" }),
      copy({ path: "/ahead", branch: "feat/next", aheadOfDefault: 2 }),
      copy({
        path: "/squashed",
        branch: "feat/squashed",
        aheadOfDefault: 3,
        behindDefault: 30,
        mergedIntoDefault: true,
      }),
      copy({
        path: "/busy",
        branch: "fix/race-safety",
        files: [file("race.rs"), file("race.ts")],
      }),
    ]);
    expect(copies.map((entry) => [entry.name, entry.finished])).toEqual([
      ["Race safety", false],
      ["Next", false],
      ["Main copy", false],
      ["Squashed", true],
      ["Tab groups", true],
    ]);
  });

  it("calls squash-merged copies finished and counts only copies with work", () => {
    const copies = summarizeCopies([
      copy({ path: "/repo", branch: "main", primary: true }),
      copy({ path: "/ahead", branch: "feat/next", aheadOfDefault: 2 }),
      copy({
        path: "/squashed",
        branch: "feat/squashed",
        aheadOfDefault: 3,
        mergedIntoDefault: true,
      }),
      copy({ path: "/done", branch: "feat/done" }),
    ]);
    const { active, finished } = partitionCopies(copies);
    expect(active.map((entry) => [entry.name, copyStatusLabel(entry)])).toEqual(
      [
        ["Next", "2 commits"],
        ["Main copy", "Up to date"],
      ],
    );
    expect(
      finished.map((entry) => [entry.name, copyStatusLabel(entry)]),
    ).toEqual([
      ["Squashed", "Merged"],
      ["Done", "Merged"],
    ]);
    // The clean main copy is listed but holds no work.
    expect(copiesCountLabel(active, finished)).toBe("1 with work · 2 finished");
    expect(copiesCountLabel(active.slice(1), finished)).toBe("2 finished");
    expect(copiesCountLabel(active, [])).toBe("2 copies");
    expect(copiesCountLabel(active.slice(0, 1), [])).toBe("1 copy");
  });

  it("never calls the main copy, unsaved work or unmerged commits finished", () => {
    const copies = summarizeCopies([
      copy({ path: "/repo", branch: "main", primary: true }),
      copy({
        path: "/dirty",
        files: [file("a.ts")],
        mergedIntoDefault: false,
      }),
      copy({ path: "/partial", aheadOfDefault: 2, mergedIntoDefault: false }),
    ]);
    expect(copies.every((entry) => !entry.finished)).toBe(true);
    expect(copies.map(copyStatusLabel)).toEqual([
      "1 unsaved",
      "2 commits",
      "Up to date",
    ]);
  });

  it("keeps a running race's lanes with the work, even when clean", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify([raceRecord("running")]),
      setItem: vi.fn(),
    });
    const [lane] = summarizeCopies([
      copy({ path: "/races/race-1/0", branch: "aven/race/race-1-0" }),
    ]);
    expect(lane.finished).toBe(false);
  });

  it("names a race lane after its prompt and agent", () => {
    const race = {
      id: "race-1",
      project: "/repo",
      root: "/repo",
      base: "abc",
      prompt: "Try new tab designs\nwith more detail",
      createdAt: 1,
      uncommitted: false,
      untracked: false,
      state: "running",
      lanes: [
        {
          sessionId: "s1",
          harness: "claude",
          model: "opus",
          label: "Claude Code · Opus 5.5",
          path: "/races/race-1/0",
          branch: "aven/race/race-1-0",
        },
      ],
    };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify([race]),
      setItem: vi.fn(),
    });
    const [lane] = summarizeCopies([
      copy({
        path: "/races/race-1/0",
        branch: "aven/race/race-1-0",
        files: [file("a.ts")],
      }),
    ]);
    expect(lane).toMatchObject({
      name: "Try new tab designs",
      detail: "Claude Code · Opus 5.5",
      harness: "claude",
    });
  });

  it("says what removing a copy throws away", () => {
    expect(removalWarning(summary({}))).toBe(
      "The folder will be deleted. Copies with ignored files must be backed up and cleared first.",
    );
    expect(
      removalWarning(summary({ files: [file("a.ts")], aheadOfDefault: 2 })),
    ).toBe(
      "The folder will be deleted. Copies with ignored files must be backed up and cleared first. 1 unsaved file will be deleted. Its branch keeps the 2 commits main doesn't have.",
    );
    expect(
      removalWarning(summary({ aheadOfDefault: 1 }, raceRecord("kept"))),
    ).toBe(
      "The entire folder, including ignored files, will be deleted. Its 1 unmerged commit is deleted too.",
    );
    expect(removalWarning(summary({}, raceRecord("running")))).toBe(
      "This race is still running. Removing it stops its agents and deletes all 2 of its copies, including unsaved and ignored files.",
    );
    expect(removalWarning(summary({ branch: null, aheadOfDefault: 1 }))).toBe(
      "This copy has no branch. Create a branch in it before removing it so its commits stay reachable.",
    );
  });

  it("removes ordinary copies with Git and race copies through their race", async () => {
    await removeCopy("/repo", summary({ path: "/copies/done" }));
    expect(invoke).toHaveBeenLastCalledWith("git_worktree_remove", {
      cwd: "/repo",
      path: "/copies/done",
    });

    const finished = raceRecord("discarded");
    await removeCopy("/repo", summary({ path: "/races/race-1/0" }, finished));
    expect(invoke).toHaveBeenLastCalledWith("race_cleanup", {
      root: "/repo",
      lanes: [finished.lanes[0]],
    });
    expect(finishRace).not.toHaveBeenCalled();

    const running = raceRecord("running");
    vi.mocked(invoke).mockClear();
    await removeCopy("/repo", summary({ path: "/races/race-1/0" }, running));
    expect(finishRace).toHaveBeenCalledWith(running, null);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("knows which copies an agent is working in", () => {
    const busy = session({ cwd: "/copies/x/src", busy: true });
    expect(copyInUse("/copies/x", [busy])).toBe(true);
    expect(copyInUse("/copies/y", [busy])).toBe(false);
    expect(copyInUse("/copies/x", [session({ cwd: "/copies/x" })])).toBe(false);
    expect(
      copyInUse("/Users/me/work/x", [
        session({ cwd: "~/work/x", queuedMessages: [{} as never] }),
      ]),
    ).toBe(true);
    expect(
      copyInUse("/copies/x", [
        session({ worktreeCwd: "/copies/x", pendingQuestion: {} as never }),
      ]),
    ).toBe(true);
  });

  it("plans a clean-up that skips copies still in use or holding work", () => {
    const kept = raceRecord("kept");
    const running = raceRecord("running");
    const plan = planCleanup(
      [
        summary({ path: "/c/done" }, undefined, "Done"),
        summary({ path: "/c/main", primary: true }, undefined, "Main"),
        summary({ path: "/c/open", current: true }, undefined, "Open"),
        summary({ path: "/c/dirty", files: [file("a")] }, undefined, "Dirty"),
        summary(
          { path: "/c/partial", aheadOfDefault: 1, mergedIntoDefault: false },
          undefined,
          "Partial",
        ),
        summary({ path: "/races/race-1/0" }, running, "Running"),
        summary({ path: "/races/race-1/0" }, kept, "Kept lane"),
        summary({ path: "/c/agent" }, undefined, "Agent"),
        summary({ path: "/c/detached", branch: null }, undefined, "Detached"),
        summary(
          { path: "/c/orphan", branch: "aven/race/old-0" },
          undefined,
          "Orphan",
        ),
        summary(
          { path: "/c/squashed", aheadOfDefault: 3, mergedIntoDefault: true },
          undefined,
          "Squashed",
        ),
      ],
      [
        session({ cwd: "/c/agent", busy: true }),
        session({ cwd: "/c/squashed" }),
      ],
    );
    expect(plan.remove.map((copy) => copy.name)).toEqual([
      "Done",
      "Kept lane",
      "Squashed",
    ]);
    expect(plan.skip.map(({ copy, reason }) => [copy.name, reason])).toEqual([
      ["Main", "it's the main copy"],
      ["Open", "it's open here"],
      ["Dirty", "it has unsaved files"],
      ["Partial", "main doesn't have all of it"],
      ["Running", "its race is still running"],
      ["Agent", "an agent is using it"],
      ["Detached", "it has no branch"],
      ["Orphan", "its race is no longer recorded"],
    ]);
  });

  it("cleans up one copy at a time, past failures, re-checking each first", async () => {
    const kept = raceRecord("kept");
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify([kept]),
      setItem: vi.fn(),
    });
    const worktrees = [
      copy({ path: "/repo", branch: "main", primary: true, current: true }),
      copy({ path: "/c/a", branch: "feat/a" }),
      copy({ path: "/c/b", branch: "feat/b" }),
      copy({ path: "/races/race-1/0", branch: "aven/race/race-1-0" }),
      // Gained a file after the confirmation was shown.
      copy({ path: "/c/edited", files: [file("x")], mergedIntoDefault: false }),
      copy({ path: "/c/agent", branch: "feat/agent" }),
    ];
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "git_worktrees") return worktrees;
      if (
        command === "git_worktree_remove" &&
        (args as { path: string }).path === "/c/a"
      )
        throw new Error("This copy contains ignored files or folders.");
      return undefined;
    });
    const planned = [
      "/c/a",
      "/c/b",
      "/races/race-1/0",
      "/c/edited",
      "/c/agent",
      "/c/gone",
    ].map((path) => ({ ...summary({ path }), name: path }));
    let busy = false;
    const progress: number[] = [];
    const result = await cleanUpCopies(
      "/repo",
      planned,
      () => [session({ cwd: "/c/agent", busy })],
      (done) => {
        progress.push(done);
        busy = done >= 3;
      },
    );

    expect(result.removed.map((copy) => copy.worktree.path)).toEqual([
      "/c/b",
      "/races/race-1/0",
    ]);
    expect(
      result.failures.map(({ copy, message }) => [copy.worktree.path, message]),
    ).toEqual([
      ["/c/a", "This copy contains ignored files or folders."],
      ["/c/edited", "Kept because it has unsaved files."],
      ["/c/agent", "Kept because an agent is using it."],
      ["/c/gone", "It's no longer part of the project."],
    ]);
    expect(progress).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(
      vi.mocked(invoke).mock.calls.map(([command, args]) => [command, args]),
    ).toEqual([
      ["git_worktrees", { cwd: "/repo" }],
      ["git_worktree_remove", { cwd: "/repo", path: "/c/a" }],
      ["git_worktree_remove", { cwd: "/repo", path: "/c/b" }],
      ["race_cleanup", { root: "/repo", lanes: [kept.lanes[0]] }],
    ]);
    expect(finishRace).not.toHaveBeenCalled();
  });

  it("removes nothing when the copies can't be checked again", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("not a repository"));
    await expect(
      cleanUpCopies("/repo", [summary({ path: "/c/a" })], () => []),
    ).rejects.toThrow("not a repository");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
