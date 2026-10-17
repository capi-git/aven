// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => "granted"),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { activitySections } from "../chrome/ActivityPanel";
import {
  getActivitySnapshot,
  recordActivity,
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
import { teamActivityEvents } from "./teamActivity";
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
    const ended = discussion({ status: "finished", progress: "4 rounds" });
    const { events, seen } = teamActivityEvents(first.seen, [ended]);
    expect(events).toEqual([
      {
        sessionId: "a",
        event: {
          id: "a:team:d1:ended",
          outcome: "completed",
          summary: "Discussion ended · 4 rounds",
          team: { id: "discuss:d1", kind: "discuss" },
        },
      },
    ]);
    expect(teamActivityEvents(seen, [ended]).events).toEqual([]);
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
        summary: "Race ready to compare · 3 agents",
      },
    });
    const retried = teamActivityEvents(ready.seen, [team({})]);
    expect(retried.events).toEqual([]);
    const again = teamActivityEvents(retried.seen, [
      team({ status: "ready", members: lanes(400) }),
    ]);
    expect(again.events[0].event.id).toBe("chat:team:r1:ready:400");
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
