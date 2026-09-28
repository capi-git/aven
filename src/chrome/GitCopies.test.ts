import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitWorktree } from "../lib/fs";
import { finishRace, type RaceRecord } from "../lib/race";
import {
  copyName,
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
): CopySummary {
  return {
    worktree: copy(overrides),
    name: "Copy",
    detail: "",
    finished: false,
    ...(race ? { race: { race, lane: race.lanes[0] } } : {}),
  };
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
        path: "/busy",
        branch: "fix/race-safety",
        files: [file("race.rs"), file("race.ts")],
      }),
    ]);
    expect(copies.map((entry) => [entry.name, entry.finished])).toEqual([
      ["Race safety", false],
      ["Next", false],
      ["Main copy", false],
      ["Tab groups", true],
    ]);
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
      "The folder is deleted. Nothing in it is lost.",
    );
    expect(
      removalWarning(summary({ files: [file("a.ts")], aheadOfDefault: 2 })),
    ).toBe(
      "1 unsaved file will be deleted. Its branch keeps the 2 commits main doesn't have.",
    );
    expect(
      removalWarning(summary({ aheadOfDefault: 1 }, raceRecord("kept"))),
    ).toBe("Its 1 unmerged commit is deleted too.");
    expect(removalWarning(summary({}, raceRecord("running")))).toBe(
      "This race is still running. Removing it stops its agents and deletes all 2 of its copies.",
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
});
