import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { setDockTeamNeeds, syncDockBadge } from "./dockBadge";
import { pendingSessionActivityEvents } from "./notifications";
import { newSession, type Block, type Session } from "./session";
import {
  attentionSessionIds,
  sessionNeedsUser,
  teamAttention,
  teamNeedSessionIds,
  teamsNeedingYou,
} from "./teamAttention";
import type { TeamMember, TeamRun } from "./teamRuns";
import { homeLiveSessions, homeNeedsYou, homeScope } from "./workspaceHome";

const approval: Block = {
  id: "ask",
  role: "approval",
  text: "Run npm test",
  tool: { title: "npm test" },
  approval: { requestId: 7 },
};

const chat = (id: string, patch: Partial<Session> = {}): Session => ({
  ...newSession("claude", "/work/site"),
  id,
  title: `Claude Code · ${id}`,
  ...patch,
});

const member = (
  sessionId: string,
  state: TeamMember["state"],
  patch: Partial<TeamMember> = {},
): TeamMember => ({
  sessionId,
  harness: "claude",
  model: "m",
  label: sessionId,
  role: "lane",
  state,
  stateLabel: state,
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
    progress: "",
    members: [],
    startedAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

describe("whose request it is", () => {
  it("leaves an orchestration worker's requests to its lead", () => {
    const worker = chat("w", {
      orchestrationLeadId: "lead",
      blocks: [approval],
    });
    expect(sessionNeedsUser(worker)).toBe(false);
    expect(pendingSessionActivityEvents(worker)).toEqual([]);
    const lead = chat("lead", { blocks: [approval] });
    expect(sessionNeedsUser(lead)).toBe(true);
    expect(pendingSessionActivityEvents(lead)).toHaveLength(1);
  });

  it("counts a race lane's or discussion chat's own request as yours", () => {
    expect(
      teamAttention({
        kind: "race",
        phase: "running",
        members: [
          member("l0", "working"),
          member("l1", "needs-you", {
            asking: { kind: "question", text: "Which port?" },
          }),
        ],
        origin: "chat",
        since: 5,
      }),
    ).toEqual({
      status: "needs-you",
      need: {
        sessionId: "l1",
        kind: "question",
        text: "Which port?",
        since: 5,
        blocking: true,
      },
    });
  });

  it("never lets a worker's request make the run need you", () => {
    expect(
      teamAttention({
        kind: "orchestrate",
        phase: "running",
        members: [
          member("lead", "working", { role: "lead" }),
          member("w", "lead-deciding", { role: "worker" }),
        ],
        origin: "lead",
        since: 0,
      }),
    ).toEqual({ status: "running" });
  });
});

describe("teamAttention", () => {
  it("names the chat a paused team waits for, with its reason", () => {
    expect(
      teamAttention({
        kind: "discuss",
        phase: "paused",
        members: [member("a", "queued"), member("b", "queued")],
        origin: "a",
        since: 9,
        pause: { reason: "Codex is busy with your own turn.", sessionId: "b" },
      }).need,
    ).toEqual({
      sessionId: "b",
      kind: "paused",
      text: "Codex is busy with your own turn.",
      since: 9,
      blocking: true,
    });
    expect(
      teamAttention({
        kind: "orchestrate",
        phase: "paused",
        members: [],
        origin: "lead",
        since: 0,
      }).need,
    ).toMatchObject({ sessionId: "lead", text: "Paused" });
  });

  it("calls a race with every lane done ready, not waiting on you", () => {
    expect(
      teamAttention({
        kind: "race",
        phase: "running",
        members: [member("l0", "done"), member("l1", "failed")],
        origin: "chat",
        since: 0,
      }),
    ).toEqual({ status: "ready" });
    expect(
      teamAttention({
        kind: "race",
        phase: "running",
        members: [member("l0", "failed"), member("l1", "stopped")],
        origin: "chat",
        since: 0,
      }),
    ).toMatchObject({
      status: "needs-you",
      need: { sessionId: "chat", kind: "error" },
    });
    // Lanes that have not started yet are still on their way.
    expect(
      teamAttention({
        kind: "race",
        phase: "running",
        members: [member("l0", "queued"), member("l1", "done")],
        origin: "chat",
        since: 0,
      }).status,
    ).toBe("running");
  });

  it("is quiet once the team is over", () => {
    for (const phase of ["finished", "stopped"] as const)
      expect(
        teamAttention({
          kind: "discuss",
          phase,
          members: [member("a", "needs-you")],
          origin: "a",
          since: 0,
        }),
      ).toEqual({ status: phase });
  });
});

describe("where needs show", () => {
  const paused = team({
    id: "discuss:d1",
    kind: "discuss",
    key: "d1",
    origin: { sessionId: "a" },
    status: "needs-you",
    need: {
      sessionId: "b",
      kind: "paused",
      text: "Ready to continue.",
      since: 4,
    },
  });
  const ready = team({ status: "ready" });
  const asking = team({
    id: "race:r2",
    status: "needs-you",
    need: { sessionId: "l1", kind: "approval", text: "Approve", since: 8 },
  });

  it("lists teams that need you, newest first, never a ready race", () => {
    expect(teamsNeedingYou([paused, ready, asking]).map((t) => t.id)).toEqual([
      "race:r2",
      "discuss:d1",
    ]);
    // A member's own request already counts through its chat.
    expect([...teamNeedSessionIds([paused, ready, asking])]).toEqual(["b"]);
  });

  it("counts each chat waiting on you once", () => {
    const sessions = [
      chat("l1", { blocks: [approval] }),
      chat("w", { orchestrationLeadId: "lead", blocks: [approval] }),
      chat("b"),
    ];
    expect(
      [...attentionSessionIds(sessions, [paused, ready, asking])].sort(),
    ).toEqual(["b", "l1"]);
  });

  it("puts a paused team on Home's Needs you", () => {
    const sessions = [chat("a"), chat("b")];
    const rows = homeNeedsYou(
      homeLiveSessions(sessions, new Set()),
      [],
      homeScope([{ path: "/work/site" }], []),
      undefined,
      [paused, ready],
    );
    expect(rows).toEqual([
      {
        id: "b",
        kind: "paused",
        title: "Fix the login loop",
        cwd: "/work/site",
        detail: "Ready to continue.",
        at: 4,
      },
    ]);
  });

  it("badges the Dock for team needs and requests together", async () => {
    invoke.mockClear();
    setDockTeamNeeds(new Set(["b", "l1"]));
    syncDockBadge([chat("l1", { blocks: [approval] }), chat("x")]);
    expect(invoke).toHaveBeenLastCalledWith("set_dock_badge", { count: 2 });
    setDockTeamNeeds(new Set());
  });
});

beforeEach(() => {
  setDockTeamNeeds(new Set());
});
