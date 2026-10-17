import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitWorktree } from "../lib/fs";
import { finishRace, type RaceRecord } from "../lib/race";
import { newSession, type Session } from "../lib/session";
import type { SessionSummary } from "../lib/sessionStore";
import {
  chatForCopy,
  cleanUpCopies,
  copyInUse,
  copyName,
  copyShortStatus,
  copyStatus,
  currentCopyLabel,
  describeCopyChat,
  loadParallelWorkOpen,
  orderParallelWork,
  parallelWorkCount,
  saveParallelWorkOpen,
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
    expect(copyName({ branch: "preview/ui", path: "/a" })).toBe("Preview UI");
    expect(copyName({ branch: "codex/feat/usage-forecast", path: "/a" })).toBe(
      "Usage forecast",
    );
    expect(copyName({ branch: "main", path: "/a" })).toBe("Main");
    expect(copyName({ branch: "feat/make-it-a-db-api", path: "/a" })).toBe(
      "Make it a DB API",
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
      ["Main folder", false],
      ["Squashed", true],
      ["Tab groups", true],
    ]);
  });

  it("calls squash-merged copies merged and counts only work in progress", () => {
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
    expect(active.map((entry) => [entry.name, copyStatus(entry).text])).toEqual(
      [
        ["Next", "2 commits not in main yet"],
        ["Main folder", "Up to date with main"],
      ],
    );
    expect(
      finished.map((entry) => [entry.name, copyStatus(entry, "trunk").text]),
    ).toEqual([
      ["Squashed", "Merged into trunk"],
      ["Done", "Merged into trunk"],
    ]);
    // The clean main folder is listed but is not work in progress.
    expect(parallelWorkCount(active)).toBe(1);
    expect(parallelWorkCount(active.slice(1))).toBe(0);
  });

  it("says what a copy holds in plain words", () => {
    const [entry] = summarizeCopies([
      copy({
        path: "/x",
        branch: "feat/x",
        aheadOfDefault: 40,
        behindDefault: 2,
        files: [file("a.ts"), file("b.ts")],
        mergedIntoDefault: false,
      }),
    ]);
    expect(copyStatus(entry)).toEqual({
      text: "40 commits not in main yet · main has 2 newer commits · 2 files uncommitted",
      tone: "uncommitted",
    });
    const [ahead] = summarizeCopies([
      copy({
        path: "/y",
        aheadOfDefault: 1,
        behindDefault: 1,
        mergedIntoDefault: false,
      }),
    ]);
    expect(copyStatus(ahead)).toMatchObject({
      text: "1 commit not in main yet · main has 1 newer commit",
      tone: "ahead",
      hint: "If this branch was squash-merged, its changes may already be in main.",
    });
    const [fresh] = summarizeCopies([
      copy({ path: "/z", mergedIntoDefault: false }),
    ]);
    expect(copyStatus(fresh)).toEqual({
      text: "No changes yet",
      tone: "quiet",
    });
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
    expect(copies.map((entry) => copyStatus(entry).text)).toEqual([
      "1 file uncommitted",
      "2 commits not in main yet",
      "Up to date with main",
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

    // Its race was pruned after its cleanup failed: removed the same way.
    await removeCopy(
      "/repo",
      summary({ path: "/races/old/0", branch: "aven/race/old-0" }),
    );
    expect(invoke).toHaveBeenLastCalledWith("race_cleanup", {
      root: "/repo",
      lanes: [{ path: "/races/old/0", branch: "aven/race/old-0" }],
    });
    expect(
      removalWarning(
        summary({ path: "/races/old/0", branch: "aven/race/old-0" }),
      ),
    ).toBe("The entire folder, including ignored files, will be deleted.");
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
    // A race copy whose record was pruned is removed as its race would.
    expect(plan.remove.map((copy) => copy.name)).toEqual([
      "Done",
      "Kept lane",
      "Orphan",
      "Squashed",
    ]);
    expect(plan.skip.map(({ copy, reason }) => [copy.name, reason])).toEqual([
      ["Main", "it's the main folder"],
      ["Open", "it's open here"],
      ["Dirty", "it has unsaved files"],
      ["Partial", "main doesn't have all of it"],
      ["Running", "its race is still running"],
      ["Agent", "an agent is using it"],
      ["Detached", "it has no branch"],
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
      // Race lanes are measured from where their race started.
      [
        "git_worktrees",
        {
          cwd: "/repo",
          bases: { "/races/race-1/0": "abc", "/races/race-1/1": "abc" },
        },
      ],
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

describe("currentCopyLabel", () => {
  it("names the copy being shown only when there are several", () => {
    const main = copy({ path: "/repo", branch: "main", primary: true });
    const feature = copy({
      path: "/copies/race-safety",
      branch: "fix/race-safety",
    });
    expect(currentCopyLabel([{ ...main, current: true }])).toBeNull();
    expect(currentCopyLabel([{ ...main, current: true }, feature])).toBe(
      "Main folder",
    );
    expect(currentCopyLabel([main, { ...feature, current: true }])).toBe(
      "Parallel · Race safety",
    );
    expect(currentCopyLabel([main, feature])).toBeNull();
  });
});

describe("chatForCopy", () => {
  const summaryRow = (
    id: string,
    title: string,
    updatedAt: number,
    archived = false,
  ) =>
    ({
      id,
      cwd: "/copies/x",
      harness: "claude",
      model: "opus",
      runtimeMode: "supervised",
      title,
      createdAt: 0,
      updatedAt,
      archived,
    }) as SessionSummary;

  it("prefers a chat with an agent working there, then the latest one", () => {
    const working = session({
      id: "w",
      cwd: "/repo",
      worktreeCwd: "/copies/x",
      title: "Mascot briefing",
      busy: true,
    });
    const other = session({ id: "o", cwd: "/copies/y", busy: true });
    expect(chatForCopy("/copies/x", [working, other])).toMatchObject({
      id: "w",
      title: "Mascot briefing",
      state: "working",
    });
    expect(
      chatForCopy(
        "/copies/x",
        [other],
        [
          summaryRow("old", "Older chat", 10),
          summaryRow("new", "Newer chat", 20),
          summaryRow("gone", "Archived chat", 30, true),
        ],
      ),
    ).toMatchObject({ id: "new", state: "idle", at: 20 });
    expect(chatForCopy("/copies/z", [working])).toBeNull();
  });

  it("describes the chat in words", () => {
    const now = Date.UTC(2026, 9, 15, 12);
    expect(
      describeCopyChat(
        { id: "a", title: "Mascot briefing", state: "working", at: 0 },
        now,
      ),
    ).toBe("Mascot briefing — agent working");
    expect(
      describeCopyChat(
        { id: "a", title: "Fix tabs", state: "waiting", at: 0 },
        now,
      ),
    ).toBe("Fix tabs — waiting for you");
    expect(
      describeCopyChat(
        { id: "a", title: "Fix tabs", state: "idle", at: now - 2 * 3_600_000 },
        now,
      ),
    ).toBe("Fix tabs · last active 2h ago");
  });
});

describe("compact parallel work", () => {
  it("says what each row holds in two words", () => {
    const copies = summarizeCopies([
      copy({
        path: "/a",
        branch: "feat/a",
        aheadOfDefault: 78,
        mergedIntoDefault: false,
      }),
      copy({
        path: "/b",
        branch: "feat/b",
        files: [file("x")],
        mergedIntoDefault: false,
      }),
      copy({ path: "/c", branch: "feat/c" }),
      copy({
        path: "/d",
        branch: "feat/d",
        files: [file("x"), file("y"), file("z")],
        aheadOfDefault: 2,
        mergedIntoDefault: false,
      }),
      copy({ path: "/e", branch: "feat/e", mergedIntoDefault: false }),
    ]);
    const at = (path: string) =>
      copies.find((entry) => entry.worktree.path === path)!;
    expect(copyShortStatus(at("/a"))).toBe("78 to merge");
    // Uncommitted files are work, never "Up to date".
    expect(copyShortStatus(at("/b"))).toBe("1 file changed");
    expect(copyShortStatus(at("/d"))).toBe("3 files changed · 2 to merge");
    expect(copyShortStatus(at("/c"))).toBe("Merged");
    expect(copyShortStatus(at("/e"))).toBe("Up to date");
  });

  it("puts working agents first, then the latest chat, otherwise keeps order", () => {
    const chat = (state: "working" | "idle", at: number) => ({
      id: "x",
      title: "x",
      state,
      at,
    });
    const rows = [
      { name: "quiet", chat: null },
      { name: "old", chat: chat("idle", 10) },
      { name: "busy", chat: chat("working", 1) },
      { name: "recent", chat: chat("idle", 20) },
      { name: "also quiet", chat: null },
    ];
    expect(orderParallelWork(rows).map((row) => row.name)).toEqual([
      "busy",
      "recent",
      "old",
      "quiet",
      "also quiet",
    ]);
  });

  it("starts folded and remembers being opened under an aven key", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    expect(loadParallelWorkOpen()).toBe(false);
    saveParallelWorkOpen(true);
    expect(values.get("aven.parallelWorkOpen")).toBe("1");
    expect(loadParallelWorkOpen()).toBe(true);
    saveParallelWorkOpen(false);
    expect(values.has("aven.parallelWorkOpen")).toBe(false);
  });
});
