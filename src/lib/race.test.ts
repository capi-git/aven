// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { restoreSessionCheckout } from "./fs";
import {
  getRace,
  isLiveRaceWorktree,
  listRaces,
  raceChoices,
  raceFileRows,
  raceLaneBases,
  raceLaneProject,
  racePrompt,
  racesSnapshot,
  releaseRaceCheckout,
  saveRace,
  selectLane,
  subscribeRaces,
  updateRace,
  usesRaceCheckout,
  type RaceDiff,
  type RaceRecord,
} from "./race";

const race = (patch: Partial<RaceRecord> = {}): RaceRecord => ({
  id: "r1",
  project: "/work/site",
  root: "/work/site",
  base: "a".repeat(40),
  prompt: "Fix the login loop",
  createdAt: 1,
  uncommitted: false,
  untracked: false,
  state: "running",
  lanes: [
    {
      sessionId: "s0",
      harness: "claude",
      model: "opus",
      label: "Claude Code · Opus",
      path: "/data/races/r1/0",
      branch: "aven/race/r1-0",
    },
    {
      sessionId: "s1",
      harness: "codex",
      model: "gpt",
      label: "Codex · GPT",
      path: "/data/races/r1/1",
      branch: "aven/race/r1-1",
    },
  ],
  ...patch,
});

const diff = (paths: string[]): RaceDiff => ({
  files: paths.map((path) => ({
    path,
    status: "modified",
    additions: 1,
    deletions: 0,
    binary: false,
  })),
  additions: paths.length,
  deletions: 0,
});

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    },
  });
}

beforeEach(mockLocalStorage);

describe("race records", () => {
  it("persists, updates and notifies", () => {
    const listener = vi.fn();
    const stop = subscribeRaces(listener);
    saveRace(race());
    expect(getRace("r1")?.prompt).toBe("Fix the login loop");
    updateRace("r1", { state: "kept" });
    expect(getRace("r1")?.state).toBe("kept");
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    updateRace("missing", { state: "kept" });
    expect(listRaces()).toHaveLength(1);
  });

  it("ignores corrupt storage", () => {
    localStorage.setItem("aven.races.v1", "{not json");
    expect(listRaces()).toEqual([]);
    otherWindowWrites(JSON.stringify([{ id: 1 }, race()]));
    expect(listRaces().map((item) => item.id)).toEqual(["r1"]);
  });

  it("reads storage once, and again only after another window writes", () => {
    saveRace(race());
    const getItem = vi.spyOn(localStorage, "getItem");
    const first = racesSnapshot();
    expect(listRaces()).toBe(first);
    expect(getRace("r1")).toBe(first[0]);
    expect(getItem).not.toHaveBeenCalled();
    otherWindowWrites(JSON.stringify([race({ prompt: "From elsewhere" })]));
    expect(getRace("r1")?.prompt).toBe("From elsewhere");
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it("keeps every running race and the newest 20 finished ones", () => {
    for (let index = 0; index < 25; index++)
      saveRace(
        race({
          id: `done-${index}`,
          state: index % 2 ? "kept" : "discarded",
          createdAt: index,
          finishedAt: 1000 + index,
        }),
      );
    saveRace(race({ id: "old-but-running", createdAt: -5 }));
    const ids = listRaces().map((item) => item.id);
    expect(ids).toHaveLength(21);
    expect(ids).toContain("old-but-running");
    expect(ids).not.toContain("done-4");
    expect(ids).toContain("done-5");
    expect(ids).toContain("done-24");
    const stored = JSON.parse(localStorage.getItem("aven.races.v1")!);
    expect(stored).toHaveLength(21);
  });

  it("measures each lane folder against its race's starting commit", () => {
    saveRace(race());
    expect(raceLaneBases()).toEqual({
      "/data/races/r1/0": "a".repeat(40),
      "/data/races/r1/1": "a".repeat(40),
    });
  });
});

function otherWindowWrites(raw: string) {
  localStorage.setItem("aven.races.v1", raw);
  window.dispatchEvent(new StorageEvent("storage", { key: "aven.races.v1" }));
}

describe("restoring race lanes", () => {
  it("repairs legacy handoffs whose saved project was a lane, without escaping a running race", () => {
    saveRace(race());
    const handoff = { cwd: "/data/races/r1/0", providerSessionId: "p" };
    expect(restoreSessionCheckout(handoff)).toEqual({
      cwd: "/work/site",
      worktreeCwd: "/data/races/r1/0",
      providerSessionId: "p",
    });
    updateRace("r1", { state: "discarded" });
    expect(restoreSessionCheckout(handoff)).toEqual({
      cwd: "/work/site",
      worktreeCwd: undefined,
      branch: undefined,
      providerSessionId: undefined,
    });
  });

  it("releases lane and follow-up chats while preserving unrelated checkouts", () => {
    const record = race();
    const lane = {
      id: "second-opinion",
      cwd: record.project,
      worktreeCwd: record.lanes[0].path,
      providerSessionId: "provider-in-copy",
      pendingSwitch: {
        from: "claude" as const,
        fromModel: "claude:test",
        fromSettings: {},
        fromProviderSessionId: "old-provider",
      },
    };
    expect(usesRaceCheckout(lane, record)).toBe(true);
    expect(releaseRaceCheckout(lane, record)).toEqual({
      ...lane,
      worktreeCwd: undefined,
      branch: undefined,
      providerSessionId: undefined,
      pendingSwitch: {
        from: "claude",
        fromModel: "claude:test",
        fromSettings: {},
        fromProviderSessionId: undefined,
      },
    });
    const unrelated = { cwd: record.project, worktreeCwd: "/work/other" };
    expect(usesRaceCheckout(unrelated, record)).toBe(false);
    expect(releaseRaceCheckout(unrelated, record)).toBe(unrelated);
    expect(
      releaseRaceCheckout(
        { cwd: record.lanes[0].path, providerSessionId: "old" },
        record,
      ).cwd,
    ).toBe(record.project);
  });

  it("matches registered checkout boundaries and normalized Windows paths", () => {
    const record = race();
    record.lanes[0].path = "C:\\Data\\races\\r1\\0";
    saveRace(record);
    expect(raceLaneProject("c:/data/races/r1/0/docs/")).toBe(record.project);
    expect(isLiveRaceWorktree("c:/data/races/r1/0/docs/")).toBe(true);
    expect(raceLaneProject("c:/data/races/r1/01")).toBeUndefined();
    expect(raceLaneProject("/data/races/r1")).toBeUndefined();
  });

  it("keeps a running lane in its own copy and strips it once the race ends", () => {
    saveRace(race());
    const lane = {
      cwd: "/work/site",
      worktreeCwd: "/data/races/r1/0",
      providerSessionId: "p",
    };
    expect(isLiveRaceWorktree(lane.worktreeCwd)).toBe(true);
    expect(restoreSessionCheckout(lane)).toEqual(lane);
    updateRace("r1", { state: "kept" });
    expect(restoreSessionCheckout(lane)).toEqual({
      cwd: "/work/site",
      worktreeCwd: undefined,
      branch: undefined,
      providerSessionId: undefined,
    });
    expect(isLiveRaceWorktree(undefined)).toBe(false);
  });
});

describe("choosing results", () => {
  const diffs = [diff(["a.ts", "shared.ts"]), diff(["b.ts", "shared.ts"])];

  it("lists each changed file with the lanes that touched it", () => {
    expect(raceFileRows(diffs)).toEqual([
      { path: "a.ts", lanes: [0] },
      { path: "b.ts", lanes: [1] },
      { path: "shared.ts", lanes: [0, 1] },
    ]);
  });

  it("keeps a whole lane or a per-file mix", () => {
    expect(selectLane(diffs, 1)).toEqual({ "b.ts": 1, "shared.ts": 1 });
    expect(
      raceChoices(race(), { "a.ts": 0, "shared.ts": 1, "b.ts": 1 }),
    ).toEqual([
      { worktree: "/data/races/r1/0", paths: ["a.ts"] },
      { worktree: "/data/races/r1/1", paths: ["b.ts", "shared.ts"] },
    ]);
    expect(raceChoices(race(), {})).toEqual([]);
  });

  it("tells each agent it is one of several working in a copy", () => {
    const prompt = racePrompt("Fix it", 3);
    expect(prompt.startsWith("Fix it\n\n")).toBe(true);
    expect(prompt).toContain("3 agents");
    expect(prompt).toContain("Do not push");
  });
});
