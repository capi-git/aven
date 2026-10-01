// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Daylight-saving cases need a zone that has it.
process.env.TZ = "America/New_York";

import {
  EVERY_DAY,
  WEEKDAYS,
  describeSchedule,
  expireStaleScheduledRuns,
  finalAssistantText,
  followingRunAt,
  getScheduledAgent,
  listScheduledAgents,
  listScheduledRuns,
  nextRunAt,
  normalizeScheduledAgent,
  normalizeScheduleRule,
  runDueScheduledAgents,
  runSummary,
  saveScheduledAgent,
  saveScheduledRun,
  scheduledAgentProblem,
  SCHEDULED_RUN_LIMIT,
  SCHEDULED_RUN_TIMEOUT_MS,
  scheduledRunSeenEntry,
  setScheduledAgentEnabled,
  type ScheduledAgent,
  type ScheduledRun,
} from "./scheduledAgents";
import type { Block } from "./session";

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

/** Local wall-clock time in the test zone. */
const local = (
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
) => new Date(year, month - 1, day, hours, minutes);

const HOUR = 60 * 60 * 1000;

const agent = (patch: Partial<ScheduledAgent> = {}): ScheduledAgent => ({
  id: "daily",
  name: "Morning review",
  prompt: "Review yesterday's commits",
  project: "/work/site",
  harness: "claude",
  model: "claude:sonnet-5",
  runtimeMode: "auto",
  schedule: { kind: "weekly", days: EVERY_DAY, time: "09:00" },
  enabled: true,
  createdAt: 0,
  nextRunAt: local(2026, 1, 7, 9).getTime(),
  ...patch,
});

const run = (patch: Partial<ScheduledRun> = {}): ScheduledRun => ({
  id: "run",
  scheduleId: "daily",
  name: "Morning review",
  project: "/work/site",
  status: "completed",
  summary: "",
  startedAt: 0,
  ...patch,
});

beforeEach(mockLocalStorage);

describe("next run time", () => {
  const daily = { kind: "weekly" as const, days: EVERY_DAY, time: "09:00" };

  it("runs later today when the time has not passed", () => {
    // Wednesday 7 January 2026.
    expect(nextRunAt(daily, local(2026, 1, 7, 8))).toBe(
      local(2026, 1, 7, 9).getTime(),
    );
  });

  it("rolls a passed time over to the next day", () => {
    expect(nextRunAt(daily, local(2026, 1, 7, 10))).toBe(
      local(2026, 1, 8, 9).getTime(),
    );
    // Exactly on time counts as passed, so a fired run is not repeated.
    expect(nextRunAt(daily, local(2026, 1, 7, 9))).toBe(
      local(2026, 1, 8, 9).getTime(),
    );
  });

  it("skips the weekend for the weekday preset", () => {
    const weekdays = { kind: "weekly" as const, days: WEEKDAYS, time: "09:00" };
    // Friday after nine runs on Monday.
    expect(nextRunAt(weekdays, local(2026, 1, 9, 10))).toBe(
      local(2026, 1, 12, 9).getTime(),
    );
  });

  it("waits a week for a single day whose time has passed", () => {
    const tuesdays = { kind: "weekly" as const, days: [2], time: "17:30" };
    // Tuesday 6 January 2026, after half past five.
    expect(nextRunAt(tuesdays, local(2026, 1, 6, 18))).toBe(
      local(2026, 1, 13, 17, 30).getTime(),
    );
    expect(nextRunAt(tuesdays, local(2026, 1, 6, 12))).toBe(
      local(2026, 1, 6, 17, 30).getTime(),
    );
  });

  it("never runs without days", () => {
    expect(
      nextRunAt({ kind: "weekly", days: [], time: "09:00" }, local(2026, 1, 7)),
    ).toBeNull();
  });

  it("adds whole hours for an interval", () => {
    const from = local(2026, 1, 7, 10, 15);
    expect(nextRunAt({ kind: "interval", hours: 3 }, from)).toBe(
      from.getTime() + 3 * HOUR,
    );
  });

  it("keeps the wall-clock time across a daylight-saving change", () => {
    // Clocks go forward at 02:00 on 8 March 2026 in New York.
    const next = nextRunAt(daily, local(2026, 3, 7, 10))!;
    expect(new Date(next).getHours()).toBe(9);
    expect(new Date(next).getDate()).toBe(8);
    // 23 wall-clock hours, one of which never happens.
    expect(next - local(2026, 3, 7, 10).getTime()).toBe(22 * HOUR);
  });

  it("runs a skipped time once, just after the gap", () => {
    const early = { kind: "weekly" as const, days: EVERY_DAY, time: "02:30" };
    const next = new Date(nextRunAt(early, local(2026, 3, 8, 0))!);
    expect(next.getDate()).toBe(8);
    expect(next.getHours()).toBe(3);
  });

  it("runs a repeated time once when the clocks go back", () => {
    // 01:30 happens twice on 1 November 2026.
    const early = { kind: "weekly" as const, days: EVERY_DAY, time: "01:30" };
    const first = nextRunAt(early, local(2026, 11, 1, 0))!;
    expect(new Date(first).getDate()).toBe(1);
    const second = followingRunAt(early, first, first + 60_000)!;
    expect(new Date(second).getDate()).toBe(2);
    expect(new Date(second).getHours()).toBe(1);
  });
});

describe("missed runs", () => {
  it("runs once after a long absence, then waits for the next due time", () => {
    const daily = { kind: "weekly" as const, days: EVERY_DAY, time: "09:00" };
    const dueAt = local(2026, 1, 4, 9).getTime();
    const now = local(2026, 1, 7, 12).getTime();
    expect(followingRunAt(daily, dueAt, now)).toBe(
      local(2026, 1, 8, 9).getTime(),
    );
  });

  it("keeps an interval's rhythm while skipping missed slots", () => {
    const hourly = { kind: "interval" as const, hours: 1 };
    const dueAt = local(2026, 1, 7, 6).getTime();
    const now = dueAt + 5.5 * HOUR;
    expect(followingRunAt(hourly, dueAt, now)).toBe(dueAt + 6 * HOUR);
    expect(followingRunAt(hourly, dueAt, dueAt + 1000)).toBe(dueAt + HOUR);
  });
});

describe("stored schedules", () => {
  it("drops records it cannot run and repairs the rest", () => {
    localStorage.setItem(
      "aven.scheduledAgents.v1",
      JSON.stringify([
        { ...agent(), harness: "unknown" },
        {
          ...agent({ id: "bad-time" }),
          schedule: { kind: "weekly", days: [1], time: "25:00" },
        },
        "nonsense",
        {
          ...agent({ id: "kept" }),
          runtimeMode: "root",
          enabled: undefined,
          schedule: {
            kind: "weekly",
            days: [5, 1, 1, 9, -1, 2.5],
            time: "08:15",
          },
        },
        {
          ...agent({ id: "interval" }),
          schedule: { kind: "interval", hours: 99 },
        },
      ]),
    );
    const agents = listScheduledAgents();
    expect(agents.map((item) => item.id)).toEqual(["kept", "interval"]);
    expect(agents[0]).toMatchObject({
      runtimeMode: "supervised",
      enabled: true,
      schedule: { kind: "weekly", days: [1, 5], time: "08:15" },
    });
    expect(agents[1]!.schedule).toEqual({ kind: "interval", hours: 24 });
  });

  it("normalises rules", () => {
    expect(normalizeScheduleRule({ kind: "interval", hours: 0 })).toEqual({
      kind: "interval",
      hours: 1,
    });
    expect(normalizeScheduleRule({ kind: "monthly" })).toBeNull();
    expect(
      normalizeScheduleRule({ kind: "weekly", days: "1", time: "09:00" }),
    ).toEqual({ kind: "weekly", days: [], time: "09:00" });
  });

  it("gives a schedule without days no next run", () => {
    const stored = normalizeScheduledAgent({
      ...agent(),
      schedule: { kind: "weekly", days: [], time: "09:00" },
      nextRunAt: null,
    });
    expect(stored?.nextRunAt).toBeNull();
  });

  it("restarts the timetable from now when turned back on", () => {
    saveScheduledAgent(
      agent({ enabled: false, nextRunAt: local(2026, 1, 1, 9).getTime() }),
    );
    setScheduledAgentEnabled("daily", true, local(2026, 1, 7, 10).getTime());
    expect(getScheduledAgent("daily")).toMatchObject({
      enabled: true,
      nextRunAt: local(2026, 1, 8, 9).getTime(),
    });
  });

  it("describes schedules in plain words", () => {
    expect(
      describeSchedule({ kind: "weekly", days: EVERY_DAY, time: "09:00" }),
    ).toBe("Every day at 09:00");
    expect(
      describeSchedule({ kind: "weekly", days: WEEKDAYS, time: "07:30" }),
    ).toBe("Weekdays at 07:30");
    expect(
      describeSchedule({ kind: "weekly", days: [0, 1], time: "07:30" }),
    ).toBe("Mon, Sun at 07:30");
    expect(describeSchedule({ kind: "interval", hours: 1 })).toBe("Every hour");
    expect(describeSchedule({ kind: "interval", hours: 6 })).toBe(
      "Every 6 hours",
    );
  });
});

describe("runs", () => {
  it("keeps the most recent runs, newest first", () => {
    for (let index = 0; index < SCHEDULED_RUN_LIMIT + 5; index += 1)
      saveScheduledRun(run({ id: `run-${index}`, startedAt: index }));
    const runs = listScheduledRuns();
    expect(runs).toHaveLength(SCHEDULED_RUN_LIMIT);
    expect(runs[0]!.id).toBe(`run-${SCHEDULED_RUN_LIMIT + 4}`);
    expect(runs.at(-1)!.id).toBe("run-5");
    expect(listScheduledRuns()).toBe(runs);
  });

  it("shortens long replies at a word", () => {
    expect(runSummary("  Done.\n\n\n\nAll good.  ")).toBe("Done.\n\nAll good.");
    const long = runSummary("word ".repeat(300));
    expect(long.length).toBeLessThanOrEqual(601);
    expect(long.endsWith("word…")).toBe(true);
  });

  it("reads the last reply of the latest turn", () => {
    const block = (role: Block["role"], text: string, internal = false) =>
      ({ id: text, role, text, ...(internal ? { internal } : {}) }) as Block;
    expect(
      finalAssistantText([
        block("user", "first"),
        block("assistant", "old answer"),
        block("user", "second"),
        block("assistant", "Working on it"),
        block("tool", "ran tests"),
        block("assistant", "All tests pass."),
        block("assistant", "", false),
      ]),
    ).toBe("All tests pass.");
    expect(finalAssistantText([block("user", "q"), block("tool", "x")])).toBe(
      "",
    );
  });

  it("marks a finished run as new again", () => {
    expect(scheduledRunSeenEntry(run({ id: "a", startedAt: 1000 }))).toEqual({
      key: "scheduled:a",
      updatedAt: new Date(1000).toISOString(),
    });
    expect(
      scheduledRunSeenEntry(run({ id: "a", startedAt: 1000, finishedAt: 5000 }))
        .updatedAt,
    ).toBe(new Date(5000).toISOString());
  });

  it("fails runs that never settled", () => {
    saveScheduledRun(run({ id: "stuck", status: "running", startedAt: 0 }));
    saveScheduledRun(run({ id: "fresh", status: "running", startedAt: 1000 }));
    expireStaleScheduledRuns(SCHEDULED_RUN_TIMEOUT_MS);
    const runs = Object.fromEntries(
      listScheduledRuns().map((item) => [item.id, item]),
    );
    expect(runs.stuck).toMatchObject({
      status: "failed",
      finishedAt: SCHEDULED_RUN_TIMEOUT_MS,
    });
    expect(runs.stuck!.error).toMatch(/stopped waiting/);
    expect(runs.fresh!.status).toBe("running");
  });
});

describe("due checks", () => {
  const now = local(2026, 1, 7, 9, 0).getTime() + 20_000;

  afterEach(() => vi.restoreAllMocks());

  it("fires a due schedule once and moves its next run on", async () => {
    saveScheduledAgent(agent());
    const fire = vi.fn();
    const claim = vi.fn(async () => true);
    await runDueScheduledAgents({ now, claim, fire });
    expect(claim).toHaveBeenCalledWith(
      `daily:${local(2026, 1, 7, 9).getTime()}`,
    );
    expect(fire).toHaveBeenCalledTimes(1);
    expect(getScheduledAgent("daily")).toMatchObject({
      lastRunAt: now,
      nextRunAt: local(2026, 1, 8, 9).getTime(),
    });
    await runDueScheduledAgents({ now: now + 30_000, claim, fire });
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("leaves a slot another window claimed", async () => {
    saveScheduledAgent(agent());
    const fire = vi.fn();
    await runDueScheduledAgents({ now, claim: async () => false, fire });
    expect(fire).not.toHaveBeenCalled();
    expect(getScheduledAgent("daily")!.nextRunAt).toBe(
      local(2026, 1, 7, 9).getTime(),
    );
  });

  it("skips schedules that are off or not yet due", async () => {
    saveScheduledAgent(agent({ id: "off", enabled: false }));
    saveScheduledAgent(agent({ id: "later", nextRunAt: now + HOUR }));
    saveScheduledAgent(agent({ id: "never", nextRunAt: null }));
    const fire = vi.fn();
    const claim = vi.fn(async () => true);
    await runDueScheduledAgents({ now, claim, fire });
    expect(claim).not.toHaveBeenCalled();
    expect(fire).not.toHaveBeenCalled();
  });

  it("runs only once for several missed due times", async () => {
    saveScheduledAgent(agent({ nextRunAt: local(2026, 1, 2, 9).getTime() }));
    const fire = vi.fn();
    await runDueScheduledAgents({ now, claim: async () => true, fire });
    await runDueScheduledAgents({
      now: now + 1000,
      claim: async () => true,
      fire,
    });
    expect(fire).toHaveBeenCalledTimes(1);
    expect(getScheduledAgent("daily")!.nextRunAt).toBe(
      local(2026, 1, 8, 9).getTime(),
    );
  });
});

describe("start checks", () => {
  const checks = (
    patch: Partial<Parameters<typeof scheduledAgentProblem>[1]> = {},
  ) => ({
    probe: async () => {},
    installed: () => true,
    folderExists: async () => true,
    ...patch,
  });

  it("allows a runnable schedule", async () => {
    expect(await scheduledAgentProblem(agent(), checks())).toBeNull();
  });

  it("explains a missing provider", async () => {
    expect(
      await scheduledAgentProblem(agent(), checks({ installed: () => false })),
    ).toMatch(/Claude Code CLI not found/);
  });

  it("explains a missing project folder", async () => {
    expect(
      await scheduledAgentProblem(
        agent(),
        checks({ folderExists: async () => false }),
      ),
    ).toBe("The project folder /work/site could not be opened.");
  });

  it("refuses an empty prompt", async () => {
    expect(await scheduledAgentProblem(agent({ prompt: "  " }), checks())).toBe(
      "This schedule has no prompt.",
    );
  });
});
