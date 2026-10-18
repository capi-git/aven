import { describe, expect, it } from "vitest";
import { defaultRect } from "./discussionPanel";
import type { DiscussionThreadItem } from "./discussionThread";
import type { TeamMember, TeamRun } from "./teamRuns";
import {
  popOutShownChats,
  closeInPanel,
  EMPTY_TEAM_PANEL,
  loadTeamPanel,
  markSeen,
  openInPanel,
  parseTeamWatchAction,
  TEAM_ACTIONS,
  TEAM_WATCH_ACTION_KINDS,
  popIn,
  popOut,
  poppedBack,
  POP_OUT_REPLY_CHARS,
  popOutView,
  pruneTeamPanel,
  readTeamWatchRequest,
  saveTeamPanel,
  shrinkPanel,
  TEAM_PANEL_PREFIX,
  teamPills,
  teamPillText,
  teamWatchTitle,
  watchStarted,
  type TeamWatchView,
} from "./teamWatch";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const WINDOW = { width: 1400, height: 900 };

const member = (
  sessionId: string,
  patch: Partial<TeamMember> = {},
): TeamMember => ({
  sessionId,
  harness: "claude",
  model: "Opus",
  label: "Claude · Opus",
  role: "lane",
  state: "working",
  stateLabel: "Working",
  ...patch,
});

const team = (patch: Partial<TeamRun> & Pick<TeamRun, "id">): TeamRun => ({
  kind: "race",
  key: patch.id.slice(patch.id.indexOf(":") + 1),
  origin: { sessionId: "chat" },
  project: "/work",
  title: "Fix the loop",
  status: "running",
  progress: "0 of 2 done",
  members: [member("l0"), member("l1", { harness: "codex" })],
  startedAt: 0,
  updatedAt: 0,
  ...patch,
});

describe("the team panel's state", () => {
  it("opens the first team as the panel, then as the user last left it", () => {
    let state = watchStarted(EMPTY_TEAM_PANEL, "discuss:d1");
    expect(state).toMatchObject({
      watching: ["discuss:d1"],
      expanded: "discuss:d1",
    });
    state = { ...state, rect: defaultRect(WINDOW) };
    // Shrunk to a pill: the next one starts as a pill too.
    state = shrinkPanel(state);
    expect(state).toMatchObject({ expanded: null, mode: "pill" });
    state = watchStarted(state, "discuss:d2");
    expect(state).toMatchObject({
      watching: ["discuss:d2", "discuss:d1"],
      expanded: null,
    });
    // Watched again: the next one opens as the panel, the other is a pill.
    state = openInPanel(state, "race:r1");
    expect(state).toMatchObject({ expanded: "race:r1", mode: "open" });
    state = watchStarted(state, "discuss:d3");
    expect(state).toMatchObject({
      watching: ["discuss:d3", "race:r1", "discuss:d2", "discuss:d1"],
      expanded: "discuss:d3",
    });
  });

  it("remembers a team the user closed, until it is watched again", () => {
    let state = openInPanel(openInPanel(EMPTY_TEAM_PANEL, "race:r1"), "d:x");
    state = closeInPanel(state, "race:r1");
    expect(state).toMatchObject({ watching: ["d:x"], dismissed: ["race:r1"] });
    expect(closeInPanel(state, "race:r1")).toBe(state);
    state = openInPanel(state, "race:r1");
    expect(state.dismissed).toEqual([]);
    expect(state.expanded).toBe("race:r1");
  });

  it("pops a team out, brings it forward on Watch, and takes it back as a pill or the panel", () => {
    let state = openInPanel(EMPTY_TEAM_PANEL, "race:r1");
    state = popOut(state, "race:r1");
    expect(state).toMatchObject({ popped: ["race:r1"], expanded: null });
    // Watch while it is out: it stays out and comes forward.
    const raised = openInPanel(state, "race:r1", 42);
    expect(raised).toMatchObject({
      popped: ["race:r1"],
      expanded: null,
      raised: { id: "race:r1", at: 42 },
    });
    // Its window closed: a pill here.
    const back = poppedBack(state, "race:r1");
    expect(back).toMatchObject({
      popped: [],
      expanded: null,
      watching: ["race:r1"],
    });
    expect(poppedBack(back, "race:r1")).toBe(back);
    // ↙ in its window: the panel here.
    expect(popIn(state, "race:r1")).toMatchObject({
      popped: [],
      expanded: "race:r1",
      mode: "open",
    });
  });

  it("forgets teams that are gone, but only for stores that have loaded", () => {
    let state = openInPanel(
      openInPanel(openInPanel(EMPTY_TEAM_PANEL, "discuss:d1"), "race:r1"),
      "orchestrate:lead",
    );
    state = markSeen(state, "discuss:d1", 4);
    const pruned = pruneTeamPanel(
      state,
      new Set(["race:r1"]),
      new Set(["discuss", "race"]),
    );
    expect(pruned.watching).toEqual(["orchestrate:lead", "race:r1"]);
    expect(pruned.seen).toEqual({});
    expect(
      pruneTeamPanel(
        pruned,
        new Set(["race:r1"]),
        new Set(["discuss", "race"]),
      ),
    ).toBe(pruned);
  });

  it("is remembered per window, without what is popped out, and survives damaged storage", () => {
    const storage = memoryStorage();
    const state = {
      ...markSeen(openInPanel(EMPTY_TEAM_PANEL, "discuss:d1"), "discuss:d1", 2),
      dismissed: ["race:r9"],
      popped: ["race:r2"],
      rect: { x: 40, y: 60, width: 500, height: 600 },
    };
    saveTeamPanel(storage, "main", state);
    expect(storage.values.has(`${TEAM_PANEL_PREFIX}main`)).toBe(true);
    expect(loadTeamPanel(storage, "main")).toEqual({ ...state, popped: [] });
    expect(loadTeamPanel(storage, "window-2")).toEqual(EMPTY_TEAM_PANEL);
    storage.setItem(`${TEAM_PANEL_PREFIX}main`, "{not json");
    expect(loadTeamPanel(storage, "main")).toEqual(EMPTY_TEAM_PANEL);
    storage.setItem(
      `${TEAM_PANEL_PREFIX}main`,
      JSON.stringify({
        watching: ["race:r1", 4, "race:r1", "bare"],
        expanded: "gone",
        mode: "pill",
        rect: { x: "1" },
        seen: { "discuss:d1": -1, "discuss:d2": 3.7 },
      }),
    );
    expect(loadTeamPanel(storage, "main")).toEqual({
      mode: "pill",
      watching: ["race:r1"],
      expanded: null,
      dismissed: [],
      seen: { "discuss:d2": 3 },
      popped: [],
    });
  });
});

describe("a focused pop-out", () => {
  it("counts as seen only the open team's members it shows", () => {
    const race = {
      status: "running" as const,
      origin: { sessionId: "chat" },
      members: [{ sessionId: "l0" }, { sessionId: "l1" }],
    } as unknown as TeamRun;
    // Not the chat the race was sent from, which it doesn't show.
    expect(popOutShownChats(race)).toEqual(["l0", "l1"]);
    // A finished team's members are ordinary chats again.
    expect(popOutShownChats({ ...race, status: "finished" })).toEqual([]);
  });
});

describe("pills", () => {
  const here = new Set(["chat"]);

  it("stack the watched teams, then every open team started here", () => {
    const teams = [
      team({ id: "race:r1" }),
      team({ id: "race:r2", origin: { sessionId: "elsewhere" } }),
      team({
        id: "orchestrate:lead",
        kind: "orchestrate",
        status: "needs-you",
      }),
      team({ id: "race:r3", status: "ready" }),
      team({ id: "race:old", status: "finished" }),
      team({ id: "race:preview", preview: true }),
    ];
    let state = openInPanel(EMPTY_TEAM_PANEL, "race:r2");
    state = shrinkPanel(state);
    expect(teamPills(state, teams, here)).toEqual([
      "race:r2",
      "race:r1",
      "orchestrate:lead",
      "race:r3",
    ]);
    // The open panel, a popped-out team and a closed one get no pill.
    state = openInPanel(state, "race:r1");
    state = popOut(state, "race:r3");
    state = closeInPanel(state, "orchestrate:lead");
    expect(teamPills(state, teams, here)).toEqual(["race:r2"]);
    // A team that ended stays only while watched.
    expect(
      teamPills(shrinkPanel(openInPanel(state, "race:old")), teams, here),
    ).toEqual(["race:old", "race:r1", "race:r2"]);
  });

  it("say where each kind stands and what is happening", () => {
    expect(
      teamPillText(
        team({
          id: "discuss:d1",
          kind: "discuss",
          progress: "Round 2 of 4",
          members: [
            member("a", { state: "queued" }),
            member("b", { harness: "codex", label: "Codex", state: "working" }),
          ],
        }),
      ),
    ).toEqual({ progress: "Round 2 of 4", status: "Codex is replying…" });
    expect(
      teamPillText(team({ id: "race:r1", progress: "1 of 2 done" })),
    ).toEqual({ progress: "1 of 2 done", status: "Racing" });
    expect(
      teamPillText(
        team({
          id: "race:r1",
          status: "ready",
          progress: "Ready to compare · 2 of 2 done",
        }),
      ),
    ).toEqual({ progress: "2 of 2 done", status: "Ready to compare" });
    expect(
      teamPillText(
        team({
          id: "race:r1",
          status: "finished",
          progress: "Kept Codex (2 files)",
        }),
      ),
    ).toEqual({ progress: "Race", status: "Kept Codex (2 files)" });
    expect(
      teamPillText(
        team({
          id: "orchestrate:lead",
          kind: "orchestrate",
          status: "needs-you",
          progress: "Paused",
          need: {
            sessionId: "lead",
            kind: "paused",
            text: "The lead stopped.",
            since: 0,
          },
        }),
      ),
    ).toEqual({ progress: "Paused", status: "Needs you" });
    expect(
      teamPillText(
        team({
          id: "orchestrate:lead",
          kind: "orchestrate",
          progress: "2 working · 1 queued",
          members: [member("lead", { role: "lead", state: "queued" })],
        }),
      ),
    ).toEqual({ progress: "2 working · 1 queued", status: "Orchestrating" });
  });

  it("titles the panel by kind", () => {
    expect(teamWatchTitle({ kind: "race", title: "Fix the loop" })).toBe(
      "Race · “Fix the loop”",
    );
    expect(
      teamWatchTitle({ kind: "orchestrate", title: "x".repeat(80) }),
    ).toHaveLength("Run · “”".length + 60);
  });
});

describe("what a popped-out panel may ask", () => {
  const race = team({ id: "race:r1" });
  const discussion = team({
    id: "discuss:d1",
    kind: "discuss",
    origin: { sessionId: "a" },
    members: [member("a"), member("b")],
  });

  it("lists every action some team takes, and nothing else, for the host", () => {
    expect(new Set(TEAM_WATCH_ACTION_KINDS)).toEqual(
      new Set(Object.values(TEAM_ACTIONS).flat()),
    );
    expect(TEAM_WATCH_ACTION_KINDS).toHaveLength(
      new Set(TEAM_WATCH_ACTION_KINDS).size,
    );
  });

  it("takes only the actions each kind of team has", () => {
    expect(parseTeamWatchAction({ kind: "compare" }, race)).toEqual({
      kind: "compare",
    });
    expect(parseTeamWatchAction({ kind: "jump-in", text: "Hi" }, race)).toBe(
      null,
    );
    expect(parseTeamWatchAction({ kind: "finish" }, race)).toBe(null);
    expect(
      parseTeamWatchAction({ kind: "jump-in", text: "Hi" }, discussion),
    ).toEqual({ kind: "jump-in", text: "Hi" });
    expect(parseTeamWatchAction({ kind: "rm -rf" }, race)).toBe(null);
    expect(parseTeamWatchAction("stop", race)).toBe(null);
    expect(parseTeamWatchAction({ kind: "stop" }, null)).toBe(null);
  });

  it("opens only the team's own chats, sends sane messages and builds on a side", () => {
    expect(
      parseTeamWatchAction({ kind: "open-chat", sessionId: "l1" }, race),
    ).toEqual({ kind: "open-chat", sessionId: "l1" });
    expect(
      parseTeamWatchAction({ kind: "open-chat", sessionId: "chat" }, race),
    ).toEqual({ kind: "open-chat", sessionId: "chat" });
    expect(
      parseTeamWatchAction({ kind: "open-chat", sessionId: "other" }, race),
    ).toBe(null);
    expect(
      parseTeamWatchAction({ kind: "jump-in", text: "  " }, discussion),
    ).toBe(null);
    expect(
      parseTeamWatchAction(
        { kind: "jump-in", text: "x".repeat(5_000) },
        discussion,
      ),
    ).toBe(null);
    expect(
      parseTeamWatchAction({ kind: "build", side: "b" }, discussion),
    ).toEqual({ kind: "build", side: "b" });
    expect(parseTeamWatchAction({ kind: "build", side: "c" }, discussion)).toBe(
      null,
    );
  });

  it("asks a reviewer of a race only, never one of its own agents", () => {
    expect(
      parseTeamWatchAction({ kind: "review", sessionId: "chat" }, race),
    ).toEqual({ kind: "review", sessionId: "chat" });
    expect(
      parseTeamWatchAction({ kind: "review", sessionId: "l1" }, race),
    ).toBe(null);
    expect(parseTeamWatchAction({ kind: "review" }, race)).toBe(null);
    expect(
      parseTeamWatchAction({ kind: "review", sessionId: "b" }, discussion),
    ).toBe(null);
  });

  it("reads a request's team and id, or nothing", () => {
    expect(
      readTeamWatchRequest({
        team: "race:r1",
        requestId: "a-1",
        action: { kind: "stop" },
      }),
    ).toEqual({ team: "race:r1", requestId: "a-1", action: { kind: "stop" } });
    expect(readTeamWatchRequest({ team: "chat:x", requestId: "a" })).toBe(null);
    expect(readTeamWatchRequest({ team: "race:r1", requestId: "" })).toBe(null);
    expect(readTeamWatchRequest(null)).toBe(null);
  });

  it("leaves the relay out of a discussion's snapshot and cuts very long replies", () => {
    const items: DiscussionThreadItem[] = [
      { kind: "topic", key: "topic", text: "Cache?" },
      {
        kind: "reply",
        key: "turn-0",
        side: "a",
        turn: 0,
        text: "y".repeat(POP_OUT_REPLY_CHARS + 50),
        stance: null,
      },
    ];
    const view = {
      team: discussion,
      discussion: {
        record: { relay: "secret in flight" } as never,
        items,
        cwd: { a: "/a", b: "/b" },
      },
      can: {
        jumpIn: true,
        build: true,
        openChat: true,
        openAgents: false,
        compare: false,
      },
    } satisfies TeamWatchView;
    const sent = popOutView(view);
    expect(sent.discussion?.record.relay).toBe("");
    const reply = sent.discussion?.items[1];
    expect(reply?.kind === "reply" && reply.text?.length).toBe(
      POP_OUT_REPLY_CHARS + 1,
    );
    expect(sent.discussion?.items[0]).toBe(items[0]);
    const race = { team, can: view.can } as never;
    expect(popOutView(race)).toBe(race);
  });
});
