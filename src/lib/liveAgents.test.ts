import { describe, expect, it } from "vitest";
import {
  backgroundWorkerIdsForStop,
  formatLiveElapsed,
  isCurrentSessionAgentSource,
  liveAgentsFromSessions,
  workerAgentsByLead,
} from "./liveAgents";
import { newSession, type Block, type Session } from "./session";

function chat(cwd: string, patch: Partial<Session> = {}): Session {
  const session = newSession("claude", cwd);
  session.title = "claude · Fix the sidebar";
  session.blocks = [
    { id: "u1", role: "user", text: "hello", startedAt: 1_000 },
  ];
  return { ...session, ...patch, blocks: patch.blocks ?? session.blocks };
}

function edit(
  id: string,
  path = "src/App.tsx",
  status = "in_progress",
): Block {
  const fileName = path.split("/").pop() ?? path;
  return {
    id,
    role: "tool",
    text: `Edited ${path}`,
    tool: {
      kind: "edit",
      title: `Edited ${path}`,
      status,
      preview: { kind: "write", path, fileName },
    },
  };
}

describe("backgroundWorkerIdsForStop", () => {
  it("stops finished worker runtimes with active or unknown native children", () => {
    const worker = (
      id: string,
      status: NonNullable<Session["liveAgents"]>[number]["status"],
      leadId = "lead",
    ) =>
      chat("/repo", {
        id,
        orchestrationLeadId: leadId,
        busy: false,
        liveAgents: [{ id: "child", title: "Review", status }],
      });
    const sessions = [
      worker("running", "running"),
      worker("waiting", "waiting"),
      worker("unknown", "unknown"),
      worker("done", "completed"),
      worker("other", "running", "another-lead"),
    ];
    expect(backgroundWorkerIdsForStop(sessions, "lead")).toEqual([
      "running",
      "waiting",
      "unknown",
    ]);
    expect(
      backgroundWorkerIdsForStop(sessions, "lead", new Set(["running"])),
    ).toEqual(["waiting", "unknown"]);
  });
});

describe("liveAgentsFromSessions", () => {
  it("shows detached provider workers after the parent reply is complete", () => {
    const lead = chat("/repo", {
      liveAgents: [
        { id: "first", title: "Inventory", status: "completed" },
        { id: "second", title: "Review", status: "running" },
      ],
    });
    expect(
      liveAgentsFromSessions([lead], new Set([lead.id]))[0],
    ).toMatchObject({
      id: lead.id,
      activity: "1 background agent working",
      done: false,
      durationMs: undefined,
    });
  });

  it("keeps uncertain agent state visible without claiming completion", () => {
    const lead = chat("/repo", {
      liveAgents: [{ id: "worker", title: "Review", status: "unknown" }],
    });
    expect(
      liveAgentsFromSessions([lead], new Set([lead.id]))[0],
    ).toMatchObject({
      activity: "Agent status unavailable",
      done: false,
    });
  });

  it("shows an idle managed lead when one of its workers is still running", () => {
    const lead = chat("/repo", { id: "lead" });
    const worker = chat("/repo", {
      id: "worker",
      busy: true,
      orchestrationLeadId: "lead",
    });
    expect(liveAgentsFromSessions([lead, worker])).toMatchObject([
      {
        id: "lead",
        activity: "1 background agent working",
        done: false,
      },
    ]);
    expect(
      liveAgentsFromSessions([lead, { ...worker, busy: false }]),
    ).toEqual([]);
  });

  it("labels waiting workers and settles only after the last one ends", () => {
    const lead = chat("/repo", {
      liveAgents: [{ id: "worker", title: "Review", status: "waiting" }],
    });
    expect(liveAgentsFromSessions([lead])[0]?.activity).toBe(
      "1 background agent waiting",
    );
    const finished: Session = {
      ...lead,
      liveAgents: [{ id: "worker", title: "Review", status: "completed" }],
    };
    expect(
      liveAgentsFromSessions([finished], new Set([lead.id]))[0],
    ).toMatchObject({ activity: "Done", done: true });
  });
  it("keeps internal workers in their lead's agent panel", () => {
    const lead = chat("/repo", { id: "lead", busy: true });
    const worker = chat("/repo", {
      id: "worker",
      busy: true,
      orchestrationLeadId: "lead",
    });
    expect(
      liveAgentsFromSessions([lead, worker]).map((agent) => agent.id),
    ).toEqual(["lead"]);
  });
  it("skips idle sessions", () => {
    expect(liveAgentsFromSessions([chat("/tmp/a")])).toEqual([]);
  });

  it("maps a busy turn into a live agent", () => {
    const session = chat("/tmp/agent-terminal", {
      busy: true,
      blocks: [
        { id: "u1", role: "user", text: "hello", startedAt: 1_000 },
        edit("t1"),
      ],
    });
    expect(liveAgentsFromSessions([session])).toEqual([
      {
        id: session.id,
        cwd: "/tmp/agent-terminal",
        title: "Fix the sidebar",
        harness: "claude",
        activity: "Edited src/App.tsx",
        startedAt: 1_000,
        durationMs: undefined,
        needsApproval: false,
        done: false,
      },
    ]);
  });

  it("puts sessions waiting on approval first", () => {
    const working = chat("/tmp/a", {
      busy: true,
      blocks: [
        { id: "u1", role: "user", text: "go", startedAt: 1_000 },
        edit("t1"),
      ],
    });
    const waiting = chat("/tmp/b", {
      busy: true,
      blocks: [
        { id: "u1", role: "user", text: "go", startedAt: 2_000 },
        {
          id: "a1",
          role: "approval",
          text: "run rm",
          approval: { requestId: 1 },
        },
      ],
    });
    expect(
      liveAgentsFromSessions([working, waiting]).map((row) => row.id),
    ).toEqual([waiting.id, working.id]);
    expect(liveAgentsFromSessions([working, waiting])[0]?.needsApproval).toBe(
      true,
    );
  });

  it("treats a parked clarifying question as needing approval", () => {
    const waiting = chat("/tmp/ask", {
      busy: true,
      pendingQuestion: {
        requestId: 4,
        title: "Which file?",
        questions: [
          {
            id: "q1",
            prompt: "Which file?",
            multiSelect: false,
            allowCustom: true,
            options: [{ id: "a.ts", label: "a.ts" }],
          },
        ],
      },
    });
    expect(liveAgentsFromSessions([waiting])[0]).toMatchObject({
      id: waiting.id,
      activity: "Which file?",
      needsApproval: true,
      done: false,
    });
  });

  it("sorts working agents by longest-running turn first", () => {
    const newer = chat("/tmp/new", {
      busy: true,
      blocks: [{ id: "u1", role: "user", text: "go", startedAt: 5_000 }],
    });
    const older = chat("/tmp/old", {
      busy: true,
      blocks: [{ id: "u1", role: "user", text: "go", startedAt: 1_000 }],
    });
    expect(
      liveAgentsFromSessions([newer, older]).map((row) => row.cwd),
    ).toEqual(["/tmp/old", "/tmp/new"]);
  });

  it("keeps an unfocused finished session until it is seen", () => {
    const finished = chat("/tmp/done", {
      blocks: [
        {
          id: "u1",
          role: "user",
          text: "go",
          startedAt: 1_000,
          durationMs: 12_000,
        },
        edit("t1", "src/App.tsx", "completed"),
      ],
    });
    expect(liveAgentsFromSessions([finished])).toEqual([]);
    expect(
      liveAgentsFromSessions([finished], new Set([finished.id])),
    ).toEqual([
      {
        id: finished.id,
        cwd: "/tmp/done",
        title: "Fix the sidebar",
        harness: "claude",
        activity: "Done",
        startedAt: 1_000,
        durationMs: 12_000,
        needsApproval: false,
        done: true,
      },
    ]);
  });

  it("keeps a working session above a finished one", () => {
    const working = chat("/tmp/a", {
      busy: true,
      blocks: [{ id: "u1", role: "user", text: "go", startedAt: 5_000 }],
    });
    const finished = chat("/tmp/b", {
      blocks: [
        {
          id: "u1",
          role: "user",
          text: "go",
          startedAt: 1_000,
          durationMs: 8_000,
        },
      ],
    });
    expect(
      liveAgentsFromSessions([finished, working], new Set([finished.id])).map(
        (row) => row.cwd,
      ),
    ).toEqual(["/tmp/a", "/tmp/b"]);
  });
});

describe("isCurrentSessionAgentSource", () => {
  it("accepts updates from the current runtime after the lead is idle", () => {
    expect(isCurrentSessionAgentSource(chat("/repo"), "claude", 2, 2)).toBe(
      true,
    );
  });
  it("rejects events from a stopped runtime, removed session, or previous provider", () => {
    expect(isCurrentSessionAgentSource(chat("/repo"), "claude", 1, 2)).toBe(
      false,
    );
    expect(isCurrentSessionAgentSource(undefined, "claude", 2, 2)).toBe(
      false,
    );
    expect(
      isCurrentSessionAgentSource(
        chat("/repo", { harness: "codex" }),
        "claude",
        2,
        2,
      ),
    ).toBe(false);
  });
});

describe("workerAgentsByLead", () => {
  it("projects native children of managed workers without transcript churn", () => {
    const worker = chat("/repo", {
      id: "worker",
      orchestrationLeadId: "lead",
      liveAgents: [{ id: "child", title: "Asset check", status: "running" }],
    });
    const first = workerAgentsByLead([worker]);
    expect(first.get("lead")).toEqual([
      {
        id: "worker:child",
        title: "Fix the sidebar · Asset check",
        status: "running",
      },
    ]);
    expect(
      workerAgentsByLead(
        [
          {
            ...worker,
            blocks: [
              ...worker.blocks,
              { id: "text", role: "assistant", text: "Update" },
            ],
          },
        ],
        first,
      ),
    ).toBe(first);
    const finished = workerAgentsByLead(
      [
        {
          ...worker,
          liveAgents: [
            { id: "child", title: "Asset check", status: "completed" },
          ],
        },
      ],
      first,
    );
    expect(finished).not.toBe(first);
    expect(finished.get("lead")?.[0]?.status).toBe("completed");
    expect(workerAgentsByLead([], finished).size).toBe(0);
  });
});

describe("formatLiveElapsed", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatLiveElapsed(0, 1_000)).toBe("1s");
    expect(formatLiveElapsed(0, 38_000)).toBe("38s");
    expect(formatLiveElapsed(0, 72_000)).toBe("1m 12s");
    expect(formatLiveElapsed(0, 120_000)).toBe("2m");
    expect(formatLiveElapsed(0, 3_600_000)).toBe("1h");
    expect(formatLiveElapsed(0, 3_720_000)).toBe("1h 2m");
  });
});
