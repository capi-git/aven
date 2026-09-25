// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { restoreSessionCheckout } from "./fs";
import {
  getRace,
  isLiveRaceWorktree,
  listRaces,
  raceChoices,
  raceFileRows,
  racePrompt,
  saveRace,
  selectLane,
  subscribeRaces,
  updateRace,
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
    localStorage.setItem("aven.races.v1", JSON.stringify([{ id: 1 }, race()]));
    expect(listRaces().map((item) => item.id)).toEqual(["r1"]);
  });
});

describe("restoring race lanes", () => {
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
