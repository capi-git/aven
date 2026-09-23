import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "./activity";
import type { Block, Session } from "./session";
import { sessionRunStatus } from "./sessionRunStatus";

function user(id = "user", startedAt: number | null = 1_000): Block {
  return {
    id,
    role: "user",
    text: "Please help",
    ...(startedAt !== null ? { startedAt } : {}),
  };
}
function session(patch: Partial<Session> = {}): Session {
  return {
    id: "session",
    harness: "codex",
    model: "model",
    modelSettings: {},
    runtimeMode: "full-access",
    title: "Task",
    cwd: "/tmp/project",
    blocks: [user()],
    ...patch,
  };
}
function activity(patch: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: "session:turn:runtime-uuid:completed",
    sessionId: "session",
    outcome: "completed",
    title: "Task",
    summary: "Private response text",
    cwd: "/tmp/project",
    harness: "codex",
    model: "model",
    createdAt: 2_000,
    readAt: null,
    resolvedAt: null,
    ...patch,
  };
}
function tool(kind: string, status = "in_progress"): Block {
  return {
    id: "tool",
    role: "tool",
    text: "private lengthy command and arguments",
    streaming: true,
    tool: { kind, status },
  };
}
const queue = [{ id: "queued", text: "Next request", attachments: [] }];

describe("sessionRunStatus", () => {
  it("keeps a fresh unused session quiet", () => {
    expect(sessionRunStatus(session({ blocks: [] }), [activity()])).toBeNull();
  });

  it("keeps an active turn working after commentary and completed tools", () => {
    const value = sessionRunStatus(
      session({
        busy: true,
        blocks: [
          user(),
          {
            id: "message",
            role: "assistant",
            text: "I will check next",
            streaming: false,
          },
          tool("execute", "completed"),
        ],
      }),
      [activity()],
    );
    expect(value).toEqual({
      kind: "working",
      label: "Working",
      detail: "Agent is working",
      startedAt: 1_000,
      canStop: true,
    });
  });

  it.each([
    ["execute", "Running command"],
    ["edit", "Editing file"],
    ["read", "Reading file"],
    ["search", "Searching"],
    ["agent", "Subagents are working"],
    ["other", "Using a tool"],
  ])("shows a short %s phase without raw command text", (kind, detail) => {
    expect(
      sessionRunStatus(
        session({ busy: true, blocks: [user(), tool(kind)] }),
        [],
      )?.detail,
    ).toBe(detail);
  });

  it.each([
    ["reasoning", "Thinking"],
    ["assistant", "Writing response"],
    ["plan", "Planning"],
  ] as const)("shows active %s output", (role, detail) => {
    expect(
      sessionRunStatus(
        session({
          busy: true,
          blocks: [
            user(),
            { id: "stream", role, text: "private", streaming: true },
          ],
        }),
        [],
      )?.detail,
    ).toBe(detail);
  });

  it("does not borrow stale pending tools from an older turn", () => {
    expect(
      sessionRunStatus(
        session({
          busy: true,
          blocks: [user("old", 100), tool("execute"), user("new", 1_000)],
        }),
        [],
      )?.detail,
    ).toBe("Agent is working");
  });

  it("keeps the original run clock and active tools across untimed steering", () => {
    expect(
      sessionRunStatus(
        session({
          busy: true,
          blocks: [user(), tool("execute"), user("steer", null)],
        }),
        [],
      ),
    ).toMatchObject({
      kind: "working",
      startedAt: 1_000,
      detail: "Running command",
    });
  });

  it("prioritizes current questions over activity outcomes and working state", () => {
    const value = sessionRunStatus(
      session({ busy: true, pendingQuestion: { requestId: 7, questions: [] } }),
      [activity()],
    );
    expect(value).toMatchObject({
      kind: "waiting",
      label: "Waiting for you",
      detail: "Answer the question below",
      canStop: true,
    });
  });

  it("shows pending approvals even when busy is false, without offering Stop", () => {
    expect(
      sessionRunStatus(
        session({
          blocks: [user(), { ...tool("execute"), approval: { requestId: 5 } }],
        }),
        [activity()],
      ),
    ).toMatchObject({
      kind: "waiting",
      detail: "Approval needed",
      canStop: false,
    });
  });

  it("does not mistake resolved requests or old ledger requests for live waiting", () => {
    const value = sessionRunStatus(
      session({
        blocks: [
          user(),
          {
            ...tool("execute", "completed"),
            approval: { requestId: 5, decided: "allow" },
          },
        ],
      }),
      [activity({ id: "session:turn:user:question:1", outcome: "question" })],
    );
    expect(value?.kind).toBe("idle");
  });

  it.each([
    ["completed", "finished", "Finished"],
    ["failed", "failed", "Failed"],
    ["stopped", "stopped", "Stopped"],
  ] as const)(
    "uses explicit %s activity for the current run",
    (outcome, kind, label) => {
      const value = sessionRunStatus(
        session({ blocks: [{ ...user(), durationMs: 900 }] }),
        [activity({ id: `session:turn:runtime-uuid:${outcome}`, outcome })],
      );
      expect(value).toMatchObject({
        kind,
        label,
        durationMs: 900,
        canStop: false,
      });
      expect(value?.detail).not.toContain("Private response");
    },
  );

  it("uses the latest relevant terminal event regardless of ledger ordering/read state", () => {
    const value = sessionRunStatus(session(), [
      activity(),
      activity({
        id: "session:turn:runtime-uuid:failed",
        outcome: "failed",
        createdAt: 2_100,
        readAt: 2_200,
      }),
      activity({
        id: "other:turn:uuid:stopped",
        outcome: "stopped",
        sessionId: "other",
        createdAt: 5_000,
      }),
    ]);
    expect(value?.kind).toBe("failed");
  });

  it.each([
    "Failed to authenticate: OAuth session expired and could not be refreshed",
    "Claude Code authentication failed. Run claude auth login in Aven’s terminal, then retry.",
    "Not logged in · Please run /login",
  ])("offers Claude login recovery for a failed provider error: %s", (text) => {
    const value = sessionRunStatus(session({
      harness: "claude",
      blocks: [user(), { id: "error", role: "system", text }],
    }), [activity({ id: "session:turn:runtime-uuid:failed", outcome: "failed" })]);
    expect(value).toMatchObject({ kind: "failed", label: "Sign in required", recovery: "claude-login", canStop: false });
  });

  it("does not infer Claude login state from assistant prose, old errors, or other providers", () => {
    const error: Block = { id: "error", role: "system", text: "Failed to authenticate: OAuth session expired and could not be refreshed" };
    const failed = [activity({ id: "session:turn:runtime-uuid:failed", outcome: "failed" })];
    for (const candidate of [
      session({ harness: "claude", blocks: [user(), { ...error, role: "assistant" }] }),
      session({ harness: "claude", blocks: [user("old", 100), error, user()] }),
      session({ harness: "codex", blocks: [user(), error] }),
    ]) {
      expect(sessionRunStatus(candidate, failed)).toMatchObject({ label: "Failed" });
      expect(sessionRunStatus(candidate, failed)?.recovery).toBeUndefined();
    }
    const candidate = session({ harness: "claude", blocks: [user(), error] });
    expect(sessionRunStatus(candidate, [activity()])?.recovery).toBeUndefined();
    expect(sessionRunStatus({ ...candidate, busy: true }, failed)?.kind).toBe("working");
  });

  it("ignores completion from before the current turn began", () => {
    expect(
      sessionRunStatus(session(), [activity({ createdAt: 999 })])?.kind,
    ).toBe("idle");
  });

  it("rejects an older known user identity even when its event arrived later", () => {
    const value = sessionRunStatus(
      session({ blocks: [user("old", 10), user("current", 1_000)] }),
      [activity({ id: "session:turn:old:completed", createdAt: 3_000 })],
    );
    expect(value?.kind).toBe("idle");
  });

  it("requires an exact turn identity when old transcripts have no start time", () => {
    const current = session({ blocks: [user("legacy", null)] });
    expect(sessionRunStatus(current, [activity()])?.kind).toBe("idle");
    expect(
      sessionRunStatus(current, [
        activity({ id: "session:turn:legacy:completed" }),
      ])?.kind,
    ).toBe("finished");
  });

  it("does not reuse a finished historical clock for an untimed new message", () => {
    const current = session({
      blocks: [{ ...user("old"), durationMs: 100 }, user("new", null)],
    });
    expect(sessionRunStatus(current, [activity()])?.kind).toBe("idle");
    expect(
      sessionRunStatus({ ...current, busy: true }, [])?.startedAt,
    ).toBeUndefined();
  });

  it("does not infer completed or failed outcomes from prose, duration, or stale streaming flags", () => {
    const value = sessionRunStatus(
      session({
        blocks: [
          { ...user(), durationMs: 500 },
          tool("execute"),
          {
            id: "answer",
            role: "assistant",
            text: "Done! Everything is complete.",
            streaming: true,
          },
          { id: "system", role: "system", text: "An old error" },
        ],
      }),
      [],
    );
    expect(value).toEqual({
      kind: "idle",
      label: "Not running",
      detail: "Ready for your next message",
      canStop: false,
    });
  });

  it("rejects malformed or mismatched activity identities", () => {
    for (const id of [
      "unrelated",
      "session:turn::completed",
      "session:turn:user:failed",
      "other:turn:user:completed",
    ]) {
      expect(sessionRunStatus(session(), [activity({ id })])?.kind).toBe(
        "idle",
      );
    }
  });

  it("shows queued work ahead of historical completion", () => {
    expect(
      sessionRunStatus(session({ queuedMessages: queue }), [activity()]),
    ).toEqual({
      kind: "queued",
      label: "Queued",
      detail: "1 message ready to send",
      canStop: false,
    });
  });

  it("describes paused and resuming queues without claiming they are executing", () => {
    expect(
      sessionRunStatus(
        session({ queuedMessages: queue, queueStatus: "paused" }),
        [],
      ),
    ).toMatchObject({
      kind: "queued",
      label: "Queue paused",
      detail: "1 message waiting",
      canStop: false,
    });
    expect(
      sessionRunStatus(
        session({ queuedMessages: queue, queueStatus: "resuming" }),
        [],
      ),
    ).toMatchObject({
      kind: "queued",
      detail: "Waiting for the continued turn",
      canStop: false,
    });
  });

  it("does not claim an edited queued head is ready to send", () => {
    expect(
      sessionRunStatus(
        session({ queuedMessages: queue, editingQueuedMessageId: "queued" }),
        [],
      )?.detail,
    ).toBe("Finish editing the queued message");
  });

  it("keeps busy turns above queued follow-ups and discards stale recorded durations", () => {
    const value = sessionRunStatus(
      session({
        busy: true,
        blocks: [{ ...user(), durationMs: 10 }],
        queuedMessages: queue,
        queueStatus: "paused",
      }),
      [activity()],
    );
    expect(value).toMatchObject({ kind: "working", canStop: true });
    expect(value?.durationMs).toBeUndefined();
    expect(value?.startedAt).toBeUndefined();
  });
});
