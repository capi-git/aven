import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "./activity";
import { createDiscussion, type Discussion } from "./discussions";
import type { OrchestrationRun, OrchestrationTask } from "./orchestration";
import type { RaceRecord } from "./race";
import { newSession, type Block, type Session } from "./session";
import {
  discussionTeam,
  orchestrationTeam,
  raceHeadline,
  raceTeam,
  teamAnchor,
  teamCompanions,
  teamOf,
  teamRole,
  teamRunsFrom,
  teamSessionIds,
  type TeamLookup,
  QUIET_PAUSE_AFTER_MS,
} from "./teamRuns";
import { teamNeedSessionIds, teamsNeedingYou } from "./teamAttention";
import { teamRowInfo } from "./teamGrouping";

const party = (sessionId: string, harness: "claude" | "codex") => ({
  sessionId,
  harness,
  model: harness === "claude" ? "Sonnet 5" : "GPT-5",
  title: `${harness} chat`,
  cwd: "/work/site",
});

function discussion(patch: Partial<Discussion> = {}): Discussion {
  return {
    ...createDiscussion({
      id: "d1",
      owner: "main",
      a: party("a", "claude"),
      b: party("b", "codex"),
      topic: "Pick a state library\nwith details",
      rounds: 2,
      now: 1_000,
    }),
    ...patch,
  };
}

const session = (
  id: string,
  patch: Partial<Session> = {},
  blocks: Block[] = [],
): Session => ({
  ...newSession("claude", "/work/site"),
  id,
  blocks,
  ...patch,
});

function lookup(
  sessions: Session[] = [],
  activity: ActivityEntry[] = [],
  detail = false,
): TeamLookup {
  const byId = new Map(sessions.map((entry) => [entry.id, entry]));
  return { session: (id) => byId.get(id), activity, detail };
}

const approval: Block = {
  id: "ask",
  role: "approval",
  text: "Run npm test",
  tool: { title: "npm test" },
  approval: { requestId: 7 },
};

describe("discussionTeam", () => {
  it("describes a running discussion from the chat that started it", () => {
    const team = discussionTeam(
      discussion({ settled: 1, delivered: true }),
      lookup(
        [
          session("b", { busy: true }, [
            { id: "u", role: "user", text: "relay", startedAt: 5 },
            {
              id: "t",
              role: "tool",
              text: "Edit",
              tool: {
                kind: "edit",
                preview: { kind: "write", path: "/work/site/App.tsx" },
              },
            },
          ]),
        ],
        [],
        true,
      ),
    );
    expect(team).toMatchObject({
      id: "discuss:d1",
      kind: "discuss",
      origin: { sessionId: "a" },
      project: "/work/site",
      title: "Pick a state library",
      status: "running",
      progress: "Round 1 of 2",
    });
    expect(team.members.map((member) => [member.role, member.state])).toEqual([
      ["opener", "queued"],
      ["responder", "working"],
    ]);
    expect(team.members[1].label).toBe("Codex");
    expect(team.members[1].fullName).toBe("Codex · GPT-5");
    expect(team.members[1].doing).toContain("App.tsx");
    expect(team.need).toBeUndefined();
  });

  it("leaves out what members are doing unless asked", () => {
    const team = discussionTeam(
      discussion({ settled: 1 }),
      lookup([session("b", { busy: true })]),
    );
    expect(team.members[1].doing).toBeUndefined();
  });

  it("needs you when paused, naming the chat it waits for", () => {
    const team = discussionTeam(
      discussion({
        status: "paused",
        reason: "Codex is busy with your own turn.",
        blockedBy: "b",
      }),
      lookup(),
    );
    expect(team.status).toBe("needs-you");
    expect(team.need).toMatchObject({
      sessionId: "b",
      kind: "paused",
      text: "Codex is busy with your own turn.",
    });
  });

  it("puts a member's own approval first", () => {
    const team = discussionTeam(
      discussion(),
      lookup([session("a", { busy: true }, [approval])]),
    );
    expect(team.status).toBe("needs-you");
    expect(team.need).toMatchObject({ sessionId: "a", kind: "approval" });
    expect(team.members[0]).toMatchObject({
      state: "needs-you",
      asking: {
        kind: "approval",
        text: "Claude wants your approval: npm test",
      },
    });
  });

  it("reads finished and stopped endings", () => {
    const done = discussionTeam(
      discussion({
        status: "ended",
        settled: 4,
        ended: { kind: "completed" },
        updatedAt: 9_000,
      }),
      lookup(),
    );
    expect(done).toMatchObject({
      status: "finished",
      progress: "2 rounds",
      result: { headline: "Discussion finished · 2 rounds" },
      endedAt: 9_000,
    });
    const stopped = discussionTeam(
      discussion({ status: "ended", settled: 2, ended: { kind: "stopped" } }),
      lookup(),
    );
    expect(stopped).toMatchObject({
      status: "stopped",
      progress: "Stopped after 1 of 2 rounds",
    });
    expect(stopped.result).toBeUndefined();
  });
});

function race(patch: Partial<RaceRecord> = {}): RaceRecord {
  return {
    id: "r1",
    project: "/work/site",
    root: "/work/site",
    base: "a".repeat(40),
    prompt: "Fix the login loop",
    createdAt: 100,
    uncommitted: false,
    untracked: false,
    state: "running",
    origin: { sessionId: "chat", blockId: "msg" },
    lanes: ["l0", "l1"].map((sessionId, slot) => ({
      sessionId,
      harness: slot ? ("codex" as const) : ("claude" as const),
      model: slot ? "gpt-5" : "opus",
      label: slot ? "Codex · GPT-5" : "Claude Code · Opus",
      path: `/data/races/r1/${slot}`,
      branch: `aven/race/r1-${slot}`,
    })),
    ...patch,
  };
}

const lane = (id: string, busy: boolean, reply = true): Session =>
  session(id, { busy }, [
    { id: `${id}-u`, role: "user", text: "Go", startedAt: 1_000 },
    ...(busy || !reply
      ? []
      : [
          {
            id: `${id}-r`,
            role: "assistant" as const,
            text: "Done.",
          },
        ]),
  ]);

const outcome = (
  sessionId: string,
  kind: "completed" | "failed",
): ActivityEntry => ({
  id: `${sessionId}:turn:x:${kind}`,
  sessionId,
  outcome: kind,
  title: "",
  summary: "",
  cwd: "/work/site",
  harness: "claude",
  model: "m",
  createdAt: 2_000,
  readAt: null,
  resolvedAt: null,
});

describe("raceTeam", () => {
  it("starts from the chat it was sent from, with one member per lane", () => {
    const team = raceTeam(
      race({ stats: [{ files: 3, additions: 20, deletions: 4 }, null] }),
      lookup(
        [lane("l0", false), lane("l1", true)],
        [outcome("l0", "completed")],
      ),
    );
    expect(team).toMatchObject({
      id: "race:r1",
      origin: { sessionId: "chat", blockId: "msg" },
      status: "running",
      progress: "1 of 2 done",
    });
    expect(team.members.map((member) => member.state)).toEqual([
      "done",
      "working",
    ]);
    expect(team.members[0].changes).toEqual({
      files: 3,
      additions: 20,
      deletions: 4,
    });
  });

  it("gives a watcher how each lane ended, in its first lines, once it stopped", () => {
    const finished = session("l0", {}, [
      { id: "u", role: "user", text: "Go", startedAt: 1_000 },
      {
        id: "r",
        role: "assistant",
        text: "Fixed the loop.\n\nThe cookie was read twice.\nAdded a test.\nRan it.",
      },
    ]);
    const look = (detail: boolean) =>
      lookup(
        [finished, lane("l1", true)],
        [outcome("l0", "completed")],
        detail,
      );
    const watched = raceTeam(race(), look(true));
    expect(watched.members[0].reply).toBe(
      "Fixed the loop.\nThe cookie was read twice.\nAdded a test.",
    );
    expect(watched.members[1].reply).toBeUndefined();
    // A bar or a sidebar row never carries it.
    expect(raceTeam(race(), look(false)).members[0].reply).toBeUndefined();
  });

  it("is ready, not waiting on you, once every lane is done", () => {
    const team = raceTeam(
      race(),
      lookup(
        [lane("l0", false), lane("l1", false)],
        [outcome("l0", "completed"), outcome("l1", "completed")],
      ),
    );
    expect(team.status).toBe("ready");
    expect(team.need).toBeUndefined();
    expect(team.progress).toBe("Ready to compare · 2 of 2 done");
  });

  it("needs you when no lane finished", () => {
    const team = raceTeam(
      race(),
      lookup(
        [lane("l0", false), lane("l1", false)],
        [outcome("l0", "failed"), outcome("l1", "failed")],
      ),
    );
    expect(team.status).toBe("needs-you");
    expect(team.need).toMatchObject({ sessionId: "chat", kind: "error" });
  });

  it("has no chat it started from when raced from the palette", () => {
    const team = raceTeam(race({ origin: undefined }), lookup());
    // No lane stands in for one: lane 0 is an agent like the others ...
    expect(team.origin).toEqual({ sessionId: "" });
    expect(teamRole(team, "l0")).toBe("member");
    expect(teamCompanions([team]).size).toBe(0);
    // ... though it is where the race opens from.
    expect(teamAnchor(team)).toBe("l0");
  });

  it("records what a kept race kept, and why", () => {
    const kept = race({
      state: "kept",
      finishedAt: 5_000,
      outcome: { kind: "lane", lane: 1, files: 7, why: "Smaller and tested." },
    });
    expect(raceHeadline(kept)).toBe("Kept Codex's version · 7 files");
    expect(raceTeam(kept, lookup())).toMatchObject({
      status: "finished",
      endedAt: 5_000,
      result: {
        headline: "Kept Codex's version · 7 files",
        why: "Smaller and tested.",
      },
    });
    expect(raceTeam(race({ state: "discarded" }), lookup()).status).toBe(
      "stopped",
    );
  });
});

const task = (
  id: string,
  patch: Partial<OrchestrationTask> = {},
): OrchestrationTask => ({
  id,
  sessionId: `w-${id}`,
  title: `Task ${id}`,
  harness: "codex",
  model: "gpt-5",
  prompt: "Do it",
  files: ["src"],
  scopes: ["/work/site/src"],
  dependsOn: [],
  status: "queued",
  accepted: false,
  result: "",
  delivered: true,
  ...patch,
});

function run(patch: Partial<OrchestrationRun> = {}): OrchestrationRun {
  return {
    version: 1,
    leadId: "lead",
    cwd: "/work/site",
    status: "active",
    allowedHarnesses: ["codex"],
    maxWorkers: 2,
    cli: "aven",
    tasks: [
      task("1", { status: "running" }),
      task("2"),
      task("3", { status: "completed", accepted: true, touched: ["a", "b"] }),
    ],
    continuations: 0,
    requests: {},
    proposalId: "plan",
    title: "Split the settings page",
    lead: { harness: "claude", model: "Opus" },
    startedAt: 50,
    ...patch,
  };
}

describe("orchestrationTeam", () => {
  it("lists the lead, then each worker", () => {
    const team = orchestrationTeam(
      run(),
      lookup([session("lead", { busy: true })]),
    );
    expect(team).toMatchObject({
      id: "orchestrate:lead",
      origin: { sessionId: "lead", blockId: "plan" },
      title: "Split the settings page",
      status: "running",
      progress: "1 working · 1 queued",
      startedAt: 50,
    });
    expect(
      team.members.map((member) => [member.role, member.stateLabel]),
    ).toEqual([
      ["lead", "Reviewing"],
      ["worker", "Working"],
      ["worker", "Queued"],
      ["worker", "Accepted"],
    ]);
    expect(team.members[0].label).toBe("Claude");
    expect(team.members[0].fullName).toBe("Claude Code · Opus");
    expect(team.members[3].changes).toEqual({ files: 2 });
  });

  it("names each agent's model as people read it, never by its id", () => {
    const named = orchestrationTeam(
      run({
        allowedModels: [
          { harness: "codex", model: "codex:gpt-9", name: "GPT-9" },
        ],
        tasks: [task("1", { model: "codex:gpt-9" })],
        lead: undefined,
      }),
      lookup([session("lead", { harness: "claude", model: "claude:x-1" })]),
    );
    // The plan's name; the lead's own model keeps its identity.
    expect(named.members.map((member) => member.model)).toEqual([
      "x-1",
      "GPT-9",
    ]);
  });

  it("gives a watcher what each worker waits for, is asked and touched", () => {
    const team = orchestrationTeam(
      run({
        tasks: [
          task("1", { status: "running" }),
          task("2", { dependsOn: ["1"] }),
          task("3", { scopes: ["/work/site/src/app"] }),
          task("4", {
            status: "completed",
            accepted: true,
            touched: ["a", "b", "c", "d", "e", "f", "g"],
          }),
          task("5", { status: "running", scopes: ["/work/site/docs"] }),
        ],
      }),
      lookup([session("w-5", { busy: true }, [approval])], [], true),
    );
    const [, , dependent, overlapping, done, asking] = team.members;
    expect(dependent.waiting).toBe("Waiting for review: Task 1");
    expect(overlapping.waiting).toBe("Waiting for files: Task 1");
    expect(done.files).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(done.changes).toEqual({ files: 7 });
    expect(asking).toMatchObject({
      state: "lead-deciding",
      asking: {
        kind: "approval",
        text: "Codex gpt-5 wants approval: npm test",
      },
    });
    // Still never yours to answer.
    expect(team.need).toBeUndefined();
    const plain = orchestrationTeam(run(), lookup([], [], false));
    expect(plain.members[2].waiting).toBeUndefined();
    expect(plain.members[3].files).toBeUndefined();
  });

  it("leaves a worker's request to its lead", () => {
    const team = orchestrationTeam(
      run(),
      lookup([session("w-1", { busy: true }, [approval])]),
    );
    expect(team.members[1]).toMatchObject({
      state: "lead-deciding",
      stateLabel: "Lead deciding",
    });
    expect(team.status).toBe("running");
    expect(team.need).toBeUndefined();
  });

  it("needs you when paused or when the lead asks", () => {
    const paused = orchestrationTeam(
      run({
        status: "paused",
        error: "Aven closed while the run was going.",
        pausedAt: Date.now() - 60_000,
      }),
      lookup(),
    );
    expect(paused.status).toBe("needs-you");
    expect(paused.need).toMatchObject({
      sessionId: "lead",
      kind: "paused",
      text: "Aven closed while the run was going.",
    });
    expect(teamsNeedingYou([paused])).toEqual([paused]);
    const asking = orchestrationTeam(
      run(),
      lookup([session("lead", {}, [approval])]),
    );
    expect(asking.need).toMatchObject({ sessionId: "lead", kind: "approval" });
  });

  it("waits quietly when it paused long ago", () => {
    const old = Date.now() - QUIET_PAUSE_AFTER_MS - 1;
    const team = orchestrationTeam(
      run({ status: "paused", error: "Stopped by you.", pausedAt: old }),
      lookup(),
    );
    // Its own card and bar still say why, with Resume ...
    expect(team.status).toBe("needs-you");
    expect(team.need).toMatchObject({ kind: "paused", quiet: true });
    // ... but the Dock, Home, Activity and the sidebar don't count it.
    expect(teamsNeedingYou([team])).toEqual([]);
    expect(teamNeedSessionIds([team]).size).toBe(0);
    expect(teamRowInfo(team)).toMatchObject({ needsYou: false });
    // Paused by an earlier version, with no date: seen once more.
    const undated = orchestrationTeam(
      run({ status: "paused", error: "Stopped by you." }),
      lookup(),
    );
    expect(undated.need?.quiet).toBeUndefined();
    expect(teamsNeedingYou([undated])).toEqual([undated]);
  });

  it("ends with the lead's verdict", () => {
    const team = orchestrationTeam(
      run({
        status: "finished",
        endedAt: 900,
        verdict: "All three pages split and tested.",
        tasks: [
          task("1", { status: "completed", accepted: true }),
          task("2", { status: "cancelled" }),
        ],
      }),
      lookup(),
    );
    expect(team).toMatchObject({
      status: "finished",
      progress: "Finished · 2 agents · 1 cancelled",
      endedAt: 900,
      result: {
        headline: "Run finished · 2 agents",
        why: "All three pages split and tested.",
      },
    });
  });
});

describe("teamOf", () => {
  const stores = {
    discussions: [
      discussion({ status: "ended", ended: { kind: "completed" } }),
      discussion({ id: "d2", startedAt: 5_000 }),
    ],
    races: [race()],
    runs: [run()],
  };
  const teams = teamRunsFrom(stores, lookup());

  it("knows every chat a store record involves", () => {
    expect(teamSessionIds(stores).sort()).toEqual(
      ["a", "b", "chat", "l0", "l1", "lead", "w-1", "w-2", "w-3"].sort(),
    );
  });

  it("leaves finished discussions' chats and an ended run's agents unwatched", () => {
    const ended = teamSessionIds({
      discussions: stores.discussions.map((discussion) => ({
        ...discussion,
        status: "ended" as const,
      })),
      races: [],
      runs: stores.runs.map((run) => ({
        ...run,
        status: "finished" as const,
        tasks: run.tasks.map((task) => ({
          ...task,
          status: "completed" as const,
        })),
      })),
    });
    // The lead still names an old run that has no title.
    expect(ended).toEqual(["lead"]);
  });

  it("finds a chat's team, open ones first", () => {
    expect(teamOf("a", teams)?.id).toBe("discuss:d2");
    expect(teamOf("l1", teams)?.id).toBe("race:r1");
    expect(teamOf("chat", teams)?.id).toBe("race:r1");
    expect(teamOf("w-2", teams)?.id).toBe("orchestrate:lead");
    expect(teamOf("nobody", teams)).toBeUndefined();
  });

  it("tells the chat a team started from from its members", () => {
    const raced = teams.find((team) => team.kind === "race")!;
    expect(teamRole(raced, "chat")).toBe("origin");
    expect(teamRole(raced, "l0")).toBe("member");
    expect(teamRole(raced, "a")).toBeNull();
  });

  it("leaves development previews out", () => {
    expect(
      teamRunsFrom(
        {
          discussions: [discussion({ preview: true })],
          races: [],
          runs: [],
        },
        lookup(),
      ),
    ).toEqual([]);
  });
});
