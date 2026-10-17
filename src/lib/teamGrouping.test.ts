import { describe, expect, it } from "vitest";
import {
  groupHomeRunning,
  groupRunningChats,
  sidebarTeams,
} from "./teamGrouping";
import type { TeamMember, TeamRun } from "./teamRuns";
import type { HomeRunning } from "./workspaceHome";

const member = (
  sessionId: string,
  state: TeamMember["state"] = "working",
  harness: TeamMember["harness"] = "claude",
): TeamMember => ({
  sessionId,
  harness,
  model: "m",
  label: sessionId,
  role: "lane",
  state,
  stateLabel: state,
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
    progress: "1 of 2 done",
    members: [member("l0", "done"), member("l1", "working", "codex")],
    startedAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

const row = (id: string, startedAt?: number): HomeRunning => ({
  id,
  title: id,
  cwd: "/work/site",
  ...(startedAt !== undefined ? { startedAt } : {}),
  doing: "Edit App.tsx",
});

describe("a team as one row", () => {
  it("folds a race's lanes into one row for the chat it was sent from", () => {
    const rows = groupHomeRunning(
      [row("solo", 5), row("l1", 20), row("l0", 10)],
      [team({})],
    );
    expect(rows).toEqual([
      row("solo", 5),
      {
        id: "chat",
        title: "Fix the login loop",
        cwd: "/work/site",
        startedAt: 10,
        doing: "Racing · 1 of 2 done",
        team: {
          id: "race:r1",
          kind: "race",
          status: "Racing · 1 of 2 done",
          members: [
            { sessionId: "l0", harness: "claude" },
            { sessionId: "l1", harness: "codex" },
          ],
          count: 2,
          working: 1,
          needsYou: false,
        },
      },
    ]);
  });

  it("folds a discussion's two chats and a run's lead into one row each", () => {
    const discussion = team({
      id: "discuss:d1",
      kind: "discuss",
      key: "d1",
      origin: { sessionId: "a" },
      title: "Pick a library",
      progress: "Round 1 of 2",
      members: [member("a", "queued"), member("b")],
    });
    const run = team({
      id: "orchestrate:lead",
      kind: "orchestrate",
      key: "lead",
      origin: { sessionId: "lead" },
      title: "Split settings",
      status: "needs-you",
      need: { sessionId: "lead", kind: "paused", text: "Paused", since: 1 },
      members: [member("lead", "queued"), member("w1")],
    });
    const rows = groupHomeRunning([row("b"), row("lead")], [discussion, run]);
    expect(rows.map((entry) => [entry.id, entry.doing])).toEqual([
      ["a", "Discussing · Round 1 of 2"],
      ["lead", "Orchestrating · Needs you"],
    ]);
  });

  it("leaves a race ready to compare, and chats outside teams, alone", () => {
    const rows = [row("l0"), row("other")];
    expect(groupHomeRunning(rows, [team({ status: "ready" })])).toEqual(rows);
  });

  it("groups Activity's running chats the same way", () => {
    const groups = groupRunningChats(
      [{ id: "x" }, { id: "l0" }, { id: "l1" }],
      [team({})],
    );
    expect(
      groups.map((group) =>
        group.kind === "chat"
          ? group.item.id
          : `${group.team.id}: ${group.items.map((item) => item.id).join(",")}`,
      ),
    ).toEqual(["x", "race:r1: l0,l1"]);
  });

  it("folds an open race's lanes into one sidebar row", () => {
    expect(
      sidebarTeams([
        team({}),
        team({ id: "race:r2", key: "r2", status: "finished" }),
        team({
          id: "discuss:d1",
          kind: "discuss",
          origin: { sessionId: "a" },
        }),
      ]).map((entry) => [entry.originId, entry.memberIds]),
    ).toEqual([["chat", ["l0", "l1"]]]);
    // From the palette, the first lane stands for the race.
    expect(
      sidebarTeams([team({ origin: { sessionId: "l0" } })])[0].memberIds,
    ).toEqual(["l1"]);
  });
});
