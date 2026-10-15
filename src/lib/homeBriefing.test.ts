import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AWAY_MS,
  BRIEFING_KEEP_MS,
  HOME_VISIT_KEY,
  arriveHome,
  briefingHasNews,
  briefingSince,
  currentBriefing,
  dismissHomeBriefing,
  homeBriefing,
  leaveHome,
  loadHomeVisit,
  saveHomeVisit,
  wasAway,
  type HomeVisit,
} from "./homeBriefing";
import type { ScheduledRun } from "./scheduledAgents";
import type { HomeAttention, HomeFinished } from "./workspaceHome";

const at = (date: number, hour: number, minute = 0) =>
  new Date(2026, 9, date, hour, minute).getTime();

describe("when a briefing opens", () => {
  it("never opens on the first visit", () => {
    expect(arriveHome(null, at(15, 9))).toEqual({
      seenAt: at(15, 9),
      briefing: null,
    });
  });

  it("opens after six hours away, or on a new day", () => {
    expect(wasAway(at(15, 9), at(15, 15) - 1)).toBe(false);
    expect(wasAway(at(15, 9), at(15, 15))).toBe(true);
    // Twenty minutes, but across midnight.
    expect(wasAway(at(14, 23, 50), at(15, 0, 10))).toBe(true);
    const back = arriveHome({ seenAt: at(14, 22), briefing: null }, at(15, 8));
    expect(back).toEqual({
      seenAt: at(15, 8),
      briefing: { since: at(14, 22), at: at(15, 8) },
    });
  });

  it("keeps an open briefing through short absences until it is stale", () => {
    const open: HomeVisit = {
      seenAt: at(15, 8),
      briefing: { since: at(14, 22), at: at(15, 8) },
    };
    const left = leaveHome(open, at(15, 9));
    expect(left).toEqual({ seenAt: at(15, 9), briefing: open.briefing });
    const back = arriveHome(left, at(15, 10));
    expect(back.briefing).toEqual(open.briefing);
    expect(currentBriefing(back, at(15, 8) + BRIEFING_KEEP_MS - 1)).toEqual(
      open.briefing,
    );
    expect(currentBriefing(back, at(15, 8) + BRIEFING_KEEP_MS)).toBeNull();
    expect(
      arriveHome(
        { seenAt: at(15, 13), briefing: open.briefing },
        at(15, 8) + BRIEFING_KEEP_MS,
      ).briefing,
    ).toBeNull();
  });

  it("replaces an old briefing after another long absence", () => {
    const open: HomeVisit = {
      seenAt: at(15, 9),
      briefing: { since: at(14, 22), at: at(15, 8) },
    };
    expect(arriveHome(open, at(15, 9) + AWAY_MS).briefing).toEqual({
      since: at(15, 9),
      at: at(15, 9) + AWAY_MS,
    });
  });

  it("stays dismissed until the next time away", () => {
    const open: HomeVisit = {
      seenAt: at(15, 8),
      briefing: { since: at(14, 22), at: at(15, 8) },
    };
    const dismissed = dismissHomeBriefing(open, at(15, 8, 5));
    expect(dismissed).toEqual({ seenAt: at(15, 8, 5), briefing: null });
    expect(arriveHome(dismissed, at(15, 12)).briefing).toBeNull();
    expect(arriveHome(dismissed, at(16, 7)).briefing).not.toBeNull();
  });

  it("never moves the last-seen time backwards", () => {
    const visit: HomeVisit = { seenAt: at(15, 9), briefing: null };
    expect(arriveHome(visit, at(15, 8)).seenAt).toBe(at(15, 9));
    expect(arriveHome(visit, at(15, 8)).briefing).toBeNull();
    expect(leaveHome(visit, at(15, 8)).seenAt).toBe(at(15, 9));
  });
});

describe("stored visit", () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });

  it("round-trips under an aven. key and ignores damage", () => {
    const visit: HomeVisit = {
      seenAt: at(15, 9),
      briefing: { since: at(14, 22), at: at(15, 9) },
    };
    saveHomeVisit(visit);
    expect(HOME_VISIT_KEY.startsWith("aven.")).toBe(true);
    expect(loadHomeVisit()).toEqual(visit);
    storage.set(HOME_VISIT_KEY, "{");
    expect(loadHomeVisit()).toBeNull();
    storage.set(
      HOME_VISIT_KEY,
      JSON.stringify({ seenAt: at(15, 9), briefing: { since: "x" } }),
    );
    expect(loadHomeVisit()).toEqual({ seenAt: at(15, 9), briefing: null });
  });
});

describe("what the briefing says", () => {
  const span = { since: at(14, 22), at: at(15, 8) };
  const row = (patch: Partial<HomeFinished>): HomeFinished => ({
    id: "f",
    sessionId: "s",
    kind: "completed",
    title: "Task",
    cwd: "/projects/app",
    detail: "",
    at: at(15, 2),
    unread: true,
    ...patch,
  });
  const run = (patch: Partial<ScheduledRun>): ScheduledRun => ({
    id: "r",
    scheduleId: "nightly",
    name: "Nightly triage",
    project: "/projects/app",
    status: "completed",
    summary: "",
    startedAt: at(15, 3),
    ...patch,
  });
  const waiting = (kind: HomeAttention["kind"]): HomeAttention => ({
    id: kind,
    kind,
    title: "Task",
    cwd: "/projects/app",
    detail: "",
    at: at(15, 1),
  });

  it("counts turns that finished or failed in the window, newest first", () => {
    const briefing = homeBriefing({
      window: span,
      finished: [
        row({ id: "late", at: at(15, 9) }),
        row({ id: "done", at: at(15, 7) }),
        row({ id: "fail", kind: "failed", at: at(15, 4) }),
        row({ id: "stop", kind: "stopped", at: at(15, 3) }),
        row({ id: "early", at: at(14, 21) }),
      ],
      needsYou: [
        waiting("approval"),
        waiting("question"),
        waiting("completed"),
      ],
      runs: [],
      projects: [{ path: "/projects/app" }],
    });
    expect(briefing.finished.map((item) => item.id)).toEqual(["done", "fail"]);
    expect(briefing).toMatchObject({ done: 1, failed: 1, waiting: 2 });
  });

  it("lists the workspace's automations that ran while away", () => {
    const briefing = homeBriefing({
      window: span,
      finished: [],
      needsYou: [],
      runs: [
        run({ id: "1" }),
        run({ id: "2", status: "failed", name: "Deps check" }),
        run({ id: "3", project: "/elsewhere" }),
        run({ id: "4", startedAt: at(14, 20) }),
      ],
      projects: [{ path: "/projects/app" }],
    });
    expect(briefing.runs.map((item) => item.id)).toEqual(["1", "2"]);
    expect(briefing.runsFailed).toBe(1);
  });

  it("has news only when something happened or waits", () => {
    const quiet = homeBriefing({
      window: span,
      finished: [],
      needsYou: [waiting("completed")],
      runs: [],
      projects: [],
    });
    expect(briefingHasNews(quiet, 0)).toBe(false);
    expect(briefingHasNews(quiet, 2)).toBe(true);
    expect(
      briefingHasNews({ ...quiet, waiting: 1 }, 0) &&
        briefingHasNews({ ...quiet, finished: [row({})] }, 0),
    ).toBe(true);
  });

  it("says when the absence began", () => {
    expect(briefingSince(at(15, 9, 40), at(15, 16))).toMatch(/^since 9:40/);
    expect(briefingSince(at(14, 18, 40), at(15, 8))).toMatch(
      /^since yesterday /,
    );
    expect(briefingSince(at(12, 18, 40), at(15, 8))).toMatch(/^since \S+ /);
    expect(briefingSince(at(1, 18), at(15, 8))).toMatch(/^since /);
  });
});
