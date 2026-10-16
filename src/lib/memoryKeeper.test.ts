// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getKeeperProject,
  KEEPER_DAILY_MS,
  KEEPER_MIN_INTERVAL_MS,
  KEEPER_NOTE_MS,
  KEEPER_RUN_LEASE_MS,
  KEEPER_TURN_BATCH,
  keeperDecision,
  keeperOfferPending,
  markKeeperChangeSeen,
  MEMORY_KEEPER_KEY,
  offerMemoryKeeper,
  providerNearLimit,
  requestKeeperRefresh,
  resetMemoryKeeperCache,
  setMemoryKeeper,
  subscribeMemoryKeeper,
  unseenKeeperChange,
  updateKeeperProject,
  type KeeperProject,
} from "./memoryKeeper";
import type { UsageForecastSnapshot } from "./usageHistory";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

const PROJECT = "/work/shop";
const NOW = Date.UTC(2026, 9, 15, 12);

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetMemoryKeeperCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetMemoryKeeperCache();
});

describe("consent, once per project", () => {
  it("offers once, and remembers the answer", () => {
    offerMemoryKeeper(PROJECT, NOW);
    expect(keeperOfferPending(getKeeperProject(PROJECT))).toBe(true);
    // A second offer keeps the first.
    offerMemoryKeeper(PROJECT, NOW + 1);
    expect(getKeeperProject(PROJECT).offeredAt).toBe(NOW);

    setMemoryKeeper(PROJECT, false, NOW + 2);
    expect(getKeeperProject(PROJECT)).toMatchObject({ consent: "off" });
    expect(keeperOfferPending(getKeeperProject(PROJECT))).toBe(false);
    // Not now is final: Aven does not ask again.
    offerMemoryKeeper(PROJECT, NOW + 3);
    expect(keeperOfferPending(getKeeperProject(PROJECT))).toBe(false);
  });

  it("turning it on asks for a pass and starts counting turns", () => {
    offerMemoryKeeper(PROJECT, NOW);
    setMemoryKeeper(PROJECT, true, NOW + 5);
    expect(getKeeperProject(PROJECT)).toMatchObject({
      consent: "on",
      enabledAt: NOW + 5,
      requested: { at: NOW + 5, manual: false },
    });
    expect(getKeeperProject(PROJECT).offeredAt).toBeUndefined();
  });

  it("keeps the choice per project, under an aven. key shared by every window", () => {
    setMemoryKeeper(PROJECT, true, NOW);
    expect(getKeeperProject("/work/other")).toEqual({});
    expect(localStorage.getItem(MEMORY_KEEPER_KEY)).toContain('"on"');
    // Another window's change arrives through storage.
    const listener = vi.fn();
    const stop = subscribeMemoryKeeper(listener);
    resetMemoryKeeperCache();
    window.dispatchEvent(
      new StorageEvent("storage", { key: MEMORY_KEEPER_KEY }),
    );
    expect(listener).toHaveBeenCalled();
    expect(getKeeperProject(PROJECT).consent).toBe("on");
    stop();
  });

  it("refreshes only when keeping is on", () => {
    requestKeeperRefresh(PROJECT, NOW);
    expect(getKeeperProject(PROJECT).requested).toBeUndefined();
    setMemoryKeeper(PROJECT, true, NOW);
    requestKeeperRefresh(PROJECT, NOW + 1);
    expect(getKeeperProject(PROJECT).requested).toEqual({
      at: NOW + 1,
      manual: true,
    });
  });

  it("shows a change as new until it is seen, undone or a day old", () => {
    const change = {
      at: NOW,
      kind: "update" as const,
      added: 2,
      removed: 1,
      before: "",
      baselineBefore: null,
      updatedAt: 9,
      seen: false,
    };
    updateKeeperProject(PROJECT, (project) => ({ ...project, change }));
    expect(unseenKeeperChange(getKeeperProject(PROJECT), NOW + 1)).toEqual(
      change,
    );
    expect(
      unseenKeeperChange(getKeeperProject(PROJECT), NOW + KEEPER_NOTE_MS + 1),
    ).toBeNull();
    markKeeperChangeSeen(PROJECT);
    expect(unseenKeeperChange(getKeeperProject(PROJECT), NOW + 1)).toBeNull();
  });
});

describe("when the keeper runs", () => {
  const on: KeeperProject = {
    consent: "on",
    enabledAt: NOW - 2 * KEEPER_DAILY_MS,
    baseline: "## Stack\n- Go",
    lastRunAt: NOW - KEEPER_DAILY_MS - 1,
    lastAttemptAt: NOW - KEEPER_DAILY_MS - 1,
  };
  const idle = {
    project: on,
    hasBlock: true,
    turnsSince: 0,
    now: NOW,
    projectBusy: false,
    nearLimit: false,
    modelAvailable: true,
  };

  it("needs consent, a model and an idle project", () => {
    expect(
      keeperDecision({ ...idle, project: { ...on, consent: undefined } }),
    ).toEqual({ skip: "off" });
    expect(
      keeperDecision({ ...idle, project: { ...on, consent: "off" } }),
    ).toEqual({ skip: "off" });
    expect(keeperDecision({ ...idle, modelAvailable: false })).toEqual({
      skip: "no-model",
    });
    expect(
      keeperDecision({ ...idle, turnsSince: 20, projectBusy: true }),
    ).toEqual({ skip: "busy" });
    // Even Refresh now waits for the agent to finish.
    expect(
      keeperDecision({ ...idle, manual: true, projectBusy: true }),
    ).toEqual({ skip: "busy" });
  });

  it("never runs two passes at once, but outlives a window that died mid-pass", () => {
    const running = { ...on, running: { since: NOW - 1000, owner: "w2" } };
    expect(
      keeperDecision({ ...idle, project: running, turnsSince: 20 }),
    ).toEqual({ skip: "running" });
    const stale = {
      ...on,
      running: { since: NOW - KEEPER_RUN_LEASE_MS - 1, owner: "w2" },
    };
    expect(keeperDecision({ ...idle, project: stale, turnsSince: 20 })).toEqual(
      { run: "update" },
    );
  });

  it("updates after a batch of turns, at most once an hour", () => {
    expect(
      keeperDecision({ ...idle, turnsSince: KEEPER_TURN_BATCH - 1 }),
    ).toEqual({ run: "update" }); // a day has passed since the last run
    const recent = { ...on, lastRunAt: NOW - 2 * KEEPER_MIN_INTERVAL_MS };
    expect(
      keeperDecision({
        ...idle,
        project: { ...recent, lastRunAt: NOW - KEEPER_DAILY_MS / 2 },
        turnsSince: KEEPER_TURN_BATCH - 1,
      }),
    ).toEqual({ skip: "nothing-new" });
    expect(
      keeperDecision({
        ...idle,
        project: { ...recent, lastRunAt: NOW - KEEPER_DAILY_MS / 2 },
        turnsSince: KEEPER_TURN_BATCH,
      }),
    ).toEqual({ run: "update" });
    expect(
      keeperDecision({
        ...idle,
        project: { ...on, lastAttemptAt: NOW - KEEPER_MIN_INTERVAL_MS + 1 },
        turnsSince: 50,
      }),
    ).toEqual({ skip: "hourly" });
  });

  it("checks once a day when the project was used", () => {
    expect(keeperDecision({ ...idle, turnsSince: 1 })).toEqual({
      run: "update",
    });
    expect(keeperDecision({ ...idle, turnsSince: 0 })).toEqual({
      skip: "nothing-new",
    });
  });

  it("skips while the provider is near a usage limit", () => {
    expect(
      keeperDecision({ ...idle, turnsSince: 20, nearLimit: true }),
    ).toEqual({ skip: "usage" });
  });

  it("fills an empty memory, and on request straight away", () => {
    const fresh: KeeperProject = { consent: "on", enabledAt: NOW };
    expect(
      keeperDecision({ ...idle, project: fresh, hasBlock: false }),
    ).toEqual({ run: "fill" });
    const failedRecently = { ...fresh, lastAttemptAt: NOW - 1000 };
    expect(
      keeperDecision({ ...idle, project: failedRecently, hasBlock: false }),
    ).toEqual({ skip: "hourly" });
    expect(
      keeperDecision({
        ...idle,
        project: failedRecently,
        hasBlock: false,
        requested: true,
        nearLimit: true,
      }),
    ).toEqual({ run: "fill" });
    expect(
      keeperDecision({
        ...idle,
        project: { ...on, lastAttemptAt: NOW - 1000 },
        manual: true,
        nearLimit: true,
      }),
    ).toEqual({ run: "fill" });
  });

  it("does not put back sections the user removed", () => {
    expect(keeperDecision({ ...idle, hasBlock: false, turnsSince: 9 })).toEqual(
      { skip: "removed" },
    );
  });
});

describe("usage limits", () => {
  const snapshot = (
    used: number,
    resetsAt: number | null,
    warning = false,
  ): UsageForecastSnapshot => ({
    providers: {
      claude: {
        latest: { session: { at: NOW - 1000, used, resetsAt } },
        paces: {},
      },
    },
    warnings: warning
      ? {
          claude: {
            provider: "claude",
            kind: "session",
            unseen: true,
            pace: {
              kind: "session",
              used,
              perHour: 30,
              hitAt: NOW + 60_000,
              resetsAt,
              from: NOW - 3_600_000,
              to: NOW,
              lastRiseAt: NOW,
              samples: 4,
            },
          },
        }
      : {},
    at: NOW,
  });

  it("counts a forecast warning or a nearly full window", () => {
    expect(providerNearLimit("claude", snapshot(40, NOW + 1000), NOW)).toBe(
      false,
    );
    expect(providerNearLimit("claude", snapshot(92, NOW + 1000), NOW)).toBe(
      true,
    );
    // A full window that has since reset is not.
    expect(providerNearLimit("claude", snapshot(95, NOW - 1000), NOW)).toBe(
      false,
    );
    expect(
      providerNearLimit("claude", snapshot(50, NOW + 1000, true), NOW),
    ).toBe(true);
    expect(providerNearLimit("codex", snapshot(99, null, true), NOW)).toBe(
      false,
    );
  });
});
