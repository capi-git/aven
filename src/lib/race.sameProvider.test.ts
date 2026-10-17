// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: host.invoke }));

import {
  createRaceLanes,
  finishRace,
  getRace,
  installRaceWorkspace,
  raceLaneRecords,
  saveRace,
  type RaceRecord,
} from "./race";
import { raceKeepQuestion, raceLaneName, raceOutcomeText } from "./raceLanes";
import { raceHeadline, raceTeam } from "./teamRuns";

// Two models of one provider, side by side.
const agents = [
  {
    harness: "claude" as const,
    model: "opus",
    label: "Claude Code · Opus 4.6",
  },
  {
    harness: "claude" as const,
    model: "sonnet",
    label: "Claude Code · Claude Sonnet 5",
  },
];

function answer(command: string, args: Record<string, unknown>) {
  if (command === "race_worktree_create")
    return {
      path: `/data/races/${String(args.raceId)}/${String(args.slot)}`,
      branch: `aven/race/${String(args.raceId)}-${String(args.slot)}`,
    };
  if (command === "race_diff")
    return {
      files: [
        {
          path: `${String(args.worktree).endsWith("/1") ? "sonnet" : "opus"}.ts`,
          status: "added",
          additions: 3,
          deletions: 0,
          binary: false,
        },
      ],
      additions: 3,
      deletions: 0,
    };
  return null;
}

beforeEach(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
  host.invoke.mockReset();
  host.invoke.mockImplementation(async (command, args) =>
    answer(command as string, (args ?? {}) as Record<string, unknown>),
  );
});

async function startRace(): Promise<RaceRecord> {
  const copies = await createRaceLanes(
    { root: "/work/site", base: "a".repeat(40) },
    "r1",
    agents.length,
  );
  const race: RaceRecord = {
    id: "r1",
    project: "/work/site",
    root: "/work/site",
    base: "a".repeat(40),
    prompt: "Fix the login loop",
    createdAt: 0,
    uncommitted: false,
    untracked: false,
    state: "running",
    lanes: raceLaneRecords(agents, ["s0", "s1"], copies),
  };
  saveRace(race);
  return race;
}

it("gives two models of one provider a copy and a branch each", async () => {
  const race = await startRace();
  expect(
    host.invoke.mock.calls
      .filter(([command]) => command === "race_worktree_create")
      .map(([, args]) => (args as { slot: number }).slot),
  ).toEqual([0, 1]);
  expect(race.lanes.map((lane) => [lane.harness, lane.model])).toEqual([
    ["claude", "opus"],
    ["claude", "sonnet"],
  ]);
  expect(new Set(race.lanes.map((lane) => lane.path)).size).toBe(2);
  expect(new Set(race.lanes.map((lane) => lane.branch)).size).toBe(2);
});

it("removes the copies it made when the next one can't be made", async () => {
  host.invoke.mockImplementation(async (command, args) => {
    const values = (args ?? {}) as Record<string, unknown>;
    if (command === "race_worktree_create" && values.slot === 1)
      throw new Error("No space left");
    return answer(command as string, values);
  });
  await expect(
    createRaceLanes({ root: "/work/site", base: "a".repeat(40) }, "r1", 2),
  ).rejects.toThrow("No space left");
  expect(host.invoke).toHaveBeenCalledWith("race_cleanup", {
    root: "/work/site",
    lanes: [{ path: "/data/races/r1/0", branch: "aven/race/r1-0" }],
  });
});

it("names each lane by its model wherever one provider races twice", async () => {
  const race = await startRace();
  expect([raceLaneName(race, 0), raceLaneName(race, 1)]).toEqual([
    "Claude Code · Opus 4.6",
    "Claude Code · Claude Sonnet 5",
  ]);
  const team = raceTeam(race, { session: () => undefined, activity: [] });
  expect(team.members.map((member) => member.label)).toEqual([
    "Claude Code · Opus 4.6",
    "Claude Code · Claude Sonnet 5",
  ]);
  expect(
    raceKeepQuestion(race, 1, [
      { kind: "working", label: "Working" },
      { kind: "done", label: "Done" },
    ]).title,
  ).toBe("Keep Claude Code · Claude Sonnet 5's version?");
});

it("keeps one of the two, from its own copy, and removes both", async () => {
  const race = await startRace();
  const stop = installRaceWorkspace({
    stop: vi.fn(),
    settle: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    openChat: vi.fn(),
    compare: vi.fn(),
    retry: vi.fn(),
  });
  await finishRace(race, { lane: 1 });
  stop();
  expect(host.invoke).toHaveBeenCalledWith("race_apply", {
    root: "/work/site",
    base: "a".repeat(40),
    choices: [{ worktree: "/data/races/r1/1", paths: ["sonnet.ts"] }],
  });
  expect(host.invoke).toHaveBeenCalledWith("race_cleanup", {
    root: "/work/site",
    lanes: race.lanes,
  });
  const kept = getRace("r1")!;
  expect(kept.state).toBe("kept");
  expect(raceHeadline(kept)).toBe(
    "Kept Claude Code · Claude Sonnet 5 (1 file)",
  );
  expect(raceOutcomeText(kept)).toBe(
    "Kept Claude Code · Claude Sonnet 5's version · 1 file",
  );
});

it("keeps only the picked files a lane still changes, and remembers them", async () => {
  const race = await startRace();
  const stop = installRaceWorkspace({
    stop: vi.fn(),
    settle: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    openChat: vi.fn(),
    compare: vi.fn(),
    retry: vi.fn(),
  });
  // Picked earlier: Opus's later reverted "old.ts" is no longer changed.
  await finishRace(race, {
    files: { "opus.ts": 0, "old.ts": 0, "sonnet.ts": 1 },
  });
  stop();
  const kept = getRace("r1")!;
  expect(kept.outcome).toEqual({ kind: "mix", files: 2 });
  expect(kept.picks).toEqual({ "opus.ts": 0, "sonnet.ts": 1 });
});
