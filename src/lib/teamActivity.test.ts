// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => "granted"),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { activitySections } from "../chrome/ActivityPanel";
import {
  ACTIVITY_STORAGE_KEY,
  amendTeamEnd,
  canClearActivity,
  getActivitySnapshot,
  recordActivity,
  resolveTeamNeedActivity,
  type ActivityEntry,
} from "./activity";
import { visibleActivitySessionIds } from "./activityVisibility";
import { completedDays } from "./activityStreak";
import { newTurnEnds } from "./mascotReactions";
import { projectTurns } from "./memoryKeeperDigest";
import {
  probeNotificationPermission,
  publishSessionActivity,
  saveNotificationsEnabled,
} from "./notifications";
import { memberTurns } from "./orchestrationActivity";
import { newSession } from "./session";
import {
  teamActivityEvents,
  teamEndSummaries,
  teamsNoLongerNeedingYou,
  teamsPostedHere,
} from "./teamActivity";
import type { Discussion } from "./discussions";
import type { RaceRecord } from "./race";
import { teamCompanions, type TeamMember, type TeamRun } from "./teamRuns";
import { homeFinished, homeScope } from "./workspaceHome";

const member = (
  sessionId: string,
  patch: Partial<TeamMember> = {},
): TeamMember => ({
  sessionId,
  harness: "claude",
  model: "m",
  label: sessionId,
  role: "lane",
  state: "working",
  stateLabel: "Working",
  ...patch,
});

function team(patch: Partial<TeamRun>): TeamRun {
  return {
    id: "race:r1",
    kind: "race",
    key: "r1",
    origin: { sessionId: "chat" },
    project: "/work/site",
    title: "Fix the login loop",
    status: "running",
    progress: "0 of 2 done",
    members: [member("l0"), member("l1")],
    startedAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

const discussion = (patch: Partial<TeamRun> = {}) =>
  team({
    id: "discuss:d1",
    kind: "discuss",
    key: "d1",
    origin: { sessionId: "a" },
    members: [member("a"), member("b")],
    progress: "Round 1 of 2",
    ...patch,
  });

describe("which window posts a team's notices", () => {
  const race = (patch: Partial<RaceRecord> = {}): RaceRecord => ({
    id: "r1",
    project: "/work/site",
    root: "/work/site",
    base: "a".repeat(40),
    prompt: "Fix",
    createdAt: 0,
    uncommitted: false,
    untracked: false,
    state: "running",
    lanes: [],
    ...patch,
  });
  const run = team({
    id: "orchestrate:lead",
    kind: "orchestrate",
    key: "lead",
    origin: { sessionId: "lead" },
  });
  const teams = [team({}), discussion(), run];
  const ids = (
    stores: Parameters<typeof teamsPostedHere>[1],
    here: { window: string; loaded: string[] },
  ) =>
    teamsPostedHere(teams, stores, {
      window: here.window,
      loaded: new Set(here.loaded),
    }).map((entry) => entry.id);

  it("is the window that drives it", () => {
    const stores = {
      discussions: [{ id: "d1", owner: "main" } as Discussion],
      races: [race({ window: "main" })],
    };
    expect(ids(stores, { window: "main", loaded: [] })).toEqual([
      "race:r1",
      "discuss:d1",
      "orchestrate:lead",
    ]);
    // Another window, even holding the team's chats, posts only its runs.
    expect(
      ids(stores, { window: "workspace-2", loaded: ["chat", "a", "l0"] }),
    ).toEqual(["orchestrate:lead"]);
  });

  it("is any window holding a chat of a race saved before races kept one", () => {
    const stores = { discussions: [], races: [race()] };
    expect(ids(stores, { window: "workspace-2", loaded: [] })).toEqual([
      "orchestrate:lead",
    ]);
    expect(ids(stores, { window: "workspace-2", loaded: ["l1"] })).toEqual([
      "race:r1",
      "orchestrate:lead",
    ]);
  });
});

describe("teamActivityEvents", () => {
  it("posts nothing for what was already there", () => {
    const { events } = teamActivityEvents(null, [
      team({ status: "ready" }),
      discussion({ status: "finished", progress: "2 rounds" }),
    ]);
    expect(events).toEqual([]);
  });

  it("posts one entry when a discussion ends, on the chat that started it", () => {
    const first = teamActivityEvents(null, [discussion()]);
    const ended = discussion({
      status: "finished",
      progress: "4 rounds",
      endedAt: 40,
    });
    const { events, seen } = teamActivityEvents(first.seen, [ended]);
    expect(events).toEqual([
      {
        sessionId: "a",
        event: {
          id: "a:team:d1:ended:40",
          outcome: "completed",
          summary: "Discussion ended · 4 rounds",
          team: { id: "discuss:d1", kind: "discuss" },
        },
      },
    ]);
    expect(teamActivityEvents(seen, [ended]).events).toEqual([]);
    // Continued and finished again: a new ending, announced again.
    const continued = teamActivityEvents(seen, [discussion()]);
    const again = teamActivityEvents(continued.seen, [
      discussion({ status: "finished", progress: "5 rounds", endedAt: 90 }),
    ]);
    expect(again.events.map((entry) => entry.event.id)).toEqual([
      "a:team:d1:ended:90",
    ]);
  });

  it("posts one entry when a race is ready to compare, and again after a retry", () => {
    const lanes = (end: number) => [
      member("l0", { state: "done", startedAt: 0, durationMs: 50 }),
      member("l1", { state: "done", startedAt: 0, durationMs: end }),
      member("l2", { state: "failed" }),
    ];
    const start = teamActivityEvents(null, [team({})]);
    const ready = teamActivityEvents(start.seen, [
      team({ status: "ready", members: lanes(80) }),
    ]);
    expect(ready.events).toHaveLength(1);
    expect(ready.events[0]).toMatchObject({
      sessionId: "chat",
      event: {
        id: "chat:team:r1:ready:80",
        outcome: "completed",
        // One of the three failed: not "3 agents".
        summary: "Race ready to compare · 2 of 3 done",
      },
    });
    const retried = teamActivityEvents(ready.seen, [team({})]);
    expect(retried.events).toEqual([]);
    const again = teamActivityEvents(retried.seen, [
      team({ status: "ready", members: lanes(400) }),
    ]);
    expect(again.events[0].event.id).toBe("chat:team:r1:ready:400");
  });

  it("gives a notice the same id in every window, from the shared store", () => {
    // Window A holds the lanes, with their clocks; window B holds none.
    const a = team({
      status: "ready",
      mark: 700,
      members: [
        member("l0", { state: "done", startedAt: 0, durationMs: 650 }),
        member("l1", { state: "done", startedAt: 0, durationMs: 690 }),
      ],
    });
    const b = team({
      status: "ready",
      mark: 700,
      members: [
        member("l0", { state: "done" }),
        member("l1", { state: "done" }),
      ],
    });
    const id = (ready: TeamRun) =>
      teamActivityEvents(teamActivityEvents(null, [team({})]).seen, [ready])
        .events[0].event.id;
    expect(id(a)).toBe("chat:team:r1:ready:700");
    expect(id(b)).toBe(id(a));
    // A discussion's ending is keyed by its settled turns, not by when a
    // window last saw it change.
    const ended = (updatedAt: number) =>
      teamActivityEvents(teamActivityEvents(null, [discussion()]).seen, [
        discussion({
          status: "finished",
          mark: 8,
          updatedAt,
          endedAt: updatedAt,
        }),
      ]).events[0].event.id;
    expect(ended(40)).toBe("a:team:d1:ended:8");
    expect(ended(55)).toBe(ended(40));
  });

  it("posts nothing for a race whose agents you stopped", () => {
    const start = teamActivityEvents(null, [team({})]);
    const stopped = team({
      status: "ready",
      members: [
        member("l0", { state: "stopped" }),
        member("l1", { state: "stopped" }),
      ],
    });
    expect(teamActivityEvents(start.seen, [stopped]).events).toEqual([]);
  });

  it("posts one entry per need, in the chat to open", () => {
    const start = teamActivityEvents(null, [discussion()]);
    const paused = discussion({
      status: "needs-you",
      need: {
        sessionId: "b",
        kind: "paused",
        text: "Codex is busy with your own turn.",
        since: 7,
      },
    });
    const first = teamActivityEvents(start.seen, [paused]);
    expect(first.events).toEqual([
      {
        sessionId: "b",
        event: {
          id: "b:team:d1:paused:7",
          outcome: "failed",
          summary: "Discussion paused · Codex is busy with your own turn.",
          team: { id: "discuss:d1", kind: "discuss", need: true },
        },
      },
    ]);
    // The same pause with new words is not a new need.
    const ready = discussion({
      status: "needs-you",
      need: {
        sessionId: "a",
        kind: "paused",
        text: "Ready to continue.",
        since: 9,
      },
    });
    expect(teamActivityEvents(first.seen, [ready]).events).toEqual([]);
  });

  it("leaves members' own requests, stops and runs to others", () => {
    const start = teamActivityEvents(null, [
      team({}),
      discussion(),
      team({ id: "orchestrate:lead", kind: "orchestrate", key: "lead" }),
    ]);
    const { events } = teamActivityEvents(start.seen, [
      team({
        status: "needs-you",
        need: { sessionId: "l1", kind: "approval", text: "Approve", since: 2 },
      }),
      discussion({ status: "stopped" }),
      team({
        id: "orchestrate:lead",
        kind: "orchestrate",
        key: "lead",
        status: "finished",
      }),
    ]);
    expect(events).toEqual([]);
  });

  it("posts once when a run's lead stopped without finishing", () => {
    const run = (patch: Partial<TeamRun> = {}) =>
      team({
        id: "orchestrate:lead",
        kind: "orchestrate",
        key: "lead",
        origin: { sessionId: "lead" },
        ...patch,
      });
    const start = teamActivityEvents(null, [run()]);
    const stalled = run({
      status: "needs-you",
      need: {
        sessionId: "lead",
        kind: "error",
        text: "The lead stopped without finishing",
        since: 30,
      },
    });
    const first = teamActivityEvents(start.seen, [stalled]);
    expect(first.events).toEqual([
      {
        sessionId: "lead",
        event: {
          id: "lead:team:lead:error:30",
          outcome: "failed",
          summary: "Run needs you · The lead stopped without finishing",
          team: { id: "orchestrate:lead", kind: "orchestrate", need: true },
        },
      },
    ]);
    expect(teamActivityEvents(first.seen, [stalled]).events).toEqual([]);
    // Its pauses are the orchestrator's to announce.
    const paused = run({
      status: "needs-you",
      need: { sessionId: "lead", kind: "paused", text: "Paused", since: 1 },
    });
    expect(teamActivityEvents(start.seen, [paused]).events).toEqual([]);
  });

  it("posts a race's second need after a retry that fails again", () => {
    const lanes = (end: number) => [
      member("l0", { state: "failed", startedAt: 100, durationMs: end - 100 }),
      member("l1", { state: "stopped" }),
    ];
    const need = {
      sessionId: "chat",
      kind: "error" as const,
      text: "No agent finished. Retry one or discard the race.",
      // A race's need is dated from when it was created.
      since: 1,
    };
    const start = teamActivityEvents(null, [team({})]);
    const first = teamActivityEvents(start.seen, [
      team({ status: "needs-you", need, members: lanes(200) }),
    ]);
    expect(first.events).toHaveLength(1);
    const retried = teamActivityEvents(first.seen, [team({})]);
    const again = teamActivityEvents(retried.seen, [
      team({ status: "needs-you", need, members: lanes(500) }),
    ]);
    expect(again.events.map((entry) => entry.event.id)).toEqual([
      "chat:team:r1:error:500",
    ]);
    expect(again.events[0].event.id).not.toBe(first.events[0].event.id);
  });

  it("names the teams whose need has cleared", () => {
    const asking = team({
      id: "race:r2",
      status: "needs-you",
      need: { sessionId: "l1", kind: "approval", text: "Approve", since: 2 },
    });
    const paused = discussion({
      status: "needs-you",
      need: { sessionId: "b", kind: "paused", text: "Paused", since: 2 },
    });
    expect([...teamsNoLongerNeedingYou([team({}), asking, paused])]).toEqual([
      "race:r1",
      "race:r2",
    ]);
  });
});

const entry = (
  id: string,
  patch: Partial<ActivityEntry> = {},
): ActivityEntry => ({
  id,
  sessionId: "l0",
  outcome: "completed",
  title: "Race · Claude",
  summary: "Done.",
  cwd: "/work/site",
  harness: "claude",
  model: "m",
  createdAt: Date.now(),
  readAt: null,
  resolvedAt: null,
  ...patch,
});

describe("a member's own turn", () => {
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
    invoke.mockClear();
  });

  it("is remembered with its team by turn", () => {
    const turns = memberTurns(2);
    turns.add("l0:turn:one", { id: "race:r1", kind: "race" });
    expect(turns.teamOf("l0:turn:one:failed")).toEqual({
      id: "race:r1",
      kind: "race",
      member: true,
    });
    expect(turns.teamOf("l0:turn:mine:completed")).toBeUndefined();
    turns.add("l0:turn:two", { id: "race:r1", kind: "race" });
    turns.add("l0:turn:three", { id: "race:r1", kind: "race" });
    expect(turns.teamOf("l0:turn:one:completed")).toBeUndefined();
  });

  it("is recorded already read, with no banner, for its chat's status", async () => {
    saveNotificationsEnabled(true);
    await probeNotificationPermission();
    const lane = { ...newSession("claude", "/work/site"), id: "l0" };
    const result = await publishSessionActivity(
      lane,
      {
        id: "l0:turn:one:completed",
        outcome: "completed",
        team: { id: "race:r1", kind: "race", member: true },
      },
      false,
      false,
    );
    expect(result).toEqual({
      added: true,
      bannerSent: false,
      playSound: false,
    });
    expect(invoke).not.toHaveBeenCalledWith(
      "show_notification",
      expect.anything(),
    );
    const [saved] = getActivitySnapshot();
    expect(saved.readAt).not.toBeNull();
    expect(saved.team).toEqual({ id: "race:r1", kind: "race", member: true });
    // The team's own entry still interrupts while you are away.
    await publishSessionActivity(
      { ...lane, id: "chat" },
      {
        id: "chat:team:r1:ready:80",
        outcome: "completed",
        summary: "Race ready to compare · 2 agents",
        team: { id: "race:r1", kind: "race" },
      },
      false,
      false,
    );
    expect(invoke).toHaveBeenCalledWith(
      "show_notification",
      expect.objectContaining({ body: "Race ready to compare · 2 agents" }),
    );
  });

  it("leaves Clear finished with nothing to clear once only members' entries remain", () => {
    const member = {
      ...entry("l0:turn:t:completed"),
      team: { id: "race:r1", kind: "race" as const, member: true as const },
    };
    expect(canClearActivity([member])).toBe(false);
    expect(canClearActivity([member, entry("chat:turn:u:completed")])).toBe(
      true,
    );
  });

  it("is left out of lists and counts, so a team's end counts once", () => {
    recordActivity(
      entry("l0:turn:a:completed", {
        team: { id: "race:r1", kind: "race", member: true },
      }),
    );
    recordActivity(
      entry("chat:team:r1:ready:1", {
        sessionId: "chat",
        team: { id: "race:r1", kind: "race" },
      }),
    );
    const entries = getActivitySnapshot();
    expect(entries).toHaveLength(2);
    const sections = activitySections(entries);
    expect(sections.finished.map((row) => row.id)).toEqual([
      "chat:team:r1:ready:1",
    ]);
    expect(
      homeFinished(entries, homeScope([{ path: "/work/site" }], [])).map(
        (row) => row.id,
      ),
    ).toEqual(["chat:team:r1:ready:1"]);
    expect(
      newTurnEnds(entries, new Set(), Date.now()).map((row) => row.id),
    ).toEqual(["chat:team:r1:ready:1"]);
    expect(projectTurns(entries, "/work/site", 0).map((row) => row.id)).toEqual(
      ["chat:team:r1:ready:1"],
    );
    expect(
      completedDays([
        entry("x", { team: { id: "race:r1", kind: "race", member: true } }),
      ]),
    ).toEqual([]);
  });
});

it("counts members as seen while their team's chat is on screen", () => {
  const teams = [
    team({}),
    team({
      id: "orchestrate:lead",
      kind: "orchestrate",
      key: "lead",
      origin: { sessionId: "lead" },
      members: [member("lead"), member("w1"), member("w2")],
    }),
  ];
  const companions = teamCompanions(teams);
  expect(companions.get("chat")).toEqual(["l0", "l1"]);
  expect(companions.get("lead")).toEqual(["w1", "w2"]);
  const visible = visibleActivitySessionIds({
    workspaceVisible: true,
    visibleSurfaceIds: ["tab"],
    tabs: [
      {
        id: "tab",
        layout: { type: "leaf", id: "chat" },
      } as never,
    ],
    sessionIds: new Set(["chat", "l0", "l1", "lead", "w1", "w2"]),
    floatingSessionIds: [],
    companions,
    // A race's overview on screen shows its lanes too.
    panel: [],
  });
  expect([...visible].sort()).toEqual(["chat", "l0", "l1"]);
});

it("stops counting a finished team's members as seen in its chat", () => {
  const ended = teamCompanions([
    team({
      id: "discuss:d1",
      kind: "discuss",
      key: "d1",
      origin: { sessionId: "a" },
      status: "finished",
      members: [member("a"), member("b")],
    }),
  ]);
  // "Have Codex build it" after the discussion: that reply is its own news.
  expect(ended.get("a")).toBeUndefined();
});

describe("a team's need once it clears", () => {
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
  });

  it("leaves Needs you once the team no longer needs you", () => {
    const team = { id: "orchestrate:lead", kind: "orchestrate" as const };
    recordActivity({
      ...entry("lead:run:p:paused:5"),
      sessionId: "lead",
      outcome: "failed",
      summary: "Run paused · The lead's turn ended.",
      team: { ...team, need: true },
    });
    recordActivity({
      ...entry("other:turn:1:failed"),
      sessionId: "other",
      outcome: "failed",
    });
    const needs = () =>
      activitySections(getActivitySnapshot()).needsYou.map((item) => item.id);
    expect(needs()).toEqual(["other:turn:1:failed", "lead:run:p:paused:5"]);
    resolveTeamNeedActivity(new Set(["orchestrate:lead"]));
    expect(needs()).toEqual(["other:turn:1:failed"]);
    const settled = getActivitySnapshot().find(
      (item) => item.id === "lead:run:p:paused:5",
    )!;
    expect(settled.resolvedAt).toEqual(expect.any(Number));
    expect(settled.readAt).toEqual(expect.any(Number));
  });
});

describe("what a finished team did", () => {
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
  });

  it("says it in the team's end entry, for Activity and the memory keeper", () => {
    const team = { id: "orchestrate:lead", kind: "orchestrate" as const };
    recordActivity({
      ...entry("lead:run:p:finished:9"),
      sessionId: "lead",
      summary: "Run finished · 2 agents",
      team,
    });
    const [run] = teamEndSummaries({
      discussions: [],
      races: [],
      runs: [
        {
          version: 1,
          leadId: "lead",
          cwd: "/work/site",
          status: "finished",
          allowedHarnesses: ["codex"],
          maxWorkers: 2,
          cli: "aven",
          continuations: 0,
          requests: {},
          verdict: "Settings now load lazily.",
          tasks: [
            {
              id: "t1",
              sessionId: "w1",
              title: "Split the form",
              harness: "codex",
              model: "m",
              prompt: "",
              files: [],
              scopes: [],
              dependsOn: [],
              status: "completed",
              accepted: true,
              result: "",
              delivered: true,
              summary: "Moved the form into SettingsForm.tsx.",
            },
          ],
        },
      ],
    });
    expect(run).toEqual({
      teamId: "orchestrate:lead",
      summary:
        "Run finished · 1 agent · Settings now load lazily. · Split the form: Moved the form into SettingsForm.tsx.",
    });
    amendTeamEnd(run.teamId, run.summary);
    expect(getActivitySnapshot()[0].summary).toBe(run.summary);
    // The memory keeper's digest carries it.
    expect(projectTurns(getActivitySnapshot(), "/work/site", 0)).toHaveLength(
      1,
    );
  });

  it("keeps a long summary at the length an entry reads back, and writes it once", () => {
    const team = { id: "orchestrate:lead", kind: "orchestrate" as const };
    recordActivity({
      ...entry("lead:run:p:finished:9"),
      sessionId: "lead",
      summary: "Run finished · 2 agents",
      team,
    });
    const writes = vi.spyOn(globalThis.localStorage, "setItem");
    const long = `Run finished · 2 agents · ${"Moved the form. ".repeat(40)}`;
    amendTeamEnd(team.id, long);
    expect(writes).toHaveBeenCalledTimes(1);
    const kept = getActivitySnapshot()[0].summary;
    expect(kept).toHaveLength(240);
    expect(kept.endsWith("…")).toBe(true);
    // Read back, here or by another window, it matches: no rewrite.
    const raw = globalThis.localStorage.getItem(ACTIVITY_STORAGE_KEY);
    if (raw) globalThis.localStorage.setItem(ACTIVITY_STORAGE_KEY, `${raw} `);
    writes.mockClear();
    amendTeamEnd(team.id, long);
    expect(getActivitySnapshot()[0].summary).toBe(kept);
    expect(writes).not.toHaveBeenCalled();
  });
});
