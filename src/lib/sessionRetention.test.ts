import { describe, expect, it } from "vitest";
import type { OrchestrationRun } from "./orchestration";
import { newSession, type Session } from "./session";
import { retainedSessionIds } from "./sessionRetention";

const chat = (id: string, patch: Partial<Session> = {}): Session => ({
  ...newSession("claude", "/repo"),
  id,
  ...patch,
});

const run = (status: OrchestrationRun["status"]): OrchestrationRun => ({
  version: 1,
  leadId: "lead",
  cwd: "/repo",
  status,
  allowedHarnesses: ["claude"],
  maxWorkers: 2,
  cli: "aven",
  tasks: [
    {
      id: "task",
      sessionId: "worker",
      title: "Settings UI",
      harness: "claude",
      model: "sonnet",
      prompt: "Build it",
      files: ["src"],
      scopes: ["/repo/src"],
      dependsOn: [],
      status: "completed",
      accepted: false,
      result: "",
      delivered: false,
    },
  ],
  continuations: 0,
  requests: {},
});

describe("chats kept loaded without a tab", () => {
  // The lead's tab was closed: only an unrelated chat is open.
  const sessions = [
    chat("lead"),
    chat("worker", { orchestrationLeadId: "lead" }),
    chat("other"),
    chat("parked"),
  ];
  const open = new Set(["other"]);

  it("keeps the lead and its workers while the run is running or paused", () => {
    for (const status of ["active", "paused"] as const) {
      const kept = retainedSessionIds(sessions, open, [run(status)]);
      expect(kept.has("lead")).toBe(true);
      expect(kept.has("worker")).toBe(true);
      expect(kept.has("parked")).toBe(false);
    }
  });

  it("lets an idle lead go once its run is over", () => {
    for (const status of ["finished", "stopped"] as const) {
      const kept = retainedSessionIds(sessions, open, [run(status)]);
      expect(kept.has("lead")).toBe(false);
      expect(kept.has("worker")).toBe(false);
    }
  });

  it("keeps a discussion's chats, and a discussing lead's workers", () => {
    const kept = retainedSessionIds(
      sessions,
      open,
      [run("finished")],
      ["lead", ""],
    );
    expect(kept.has("lead")).toBe(true);
    expect(kept.has("worker")).toBe(true);
    expect(kept.has("")).toBe(false);
    expect(kept.has("parked")).toBe(false);
  });

  it("still keeps open tabs, Inbox chats and a working worker's lead", () => {
    const kept = retainedSessionIds(
      [
        chat("lead"),
        chat("worker", { orchestrationLeadId: "lead", busy: true }),
        chat("inbox", {
          inboxAsk: {} as Session["inboxAsk"],
        }),
      ],
      open,
      [],
    );
    expect([...kept].sort()).toEqual(["inbox", "lead", "other", "worker"]);
  });

  it("keeps a bot's chat while Aven works for it, and parks it when idle", () => {
    const sessions = [chat("bot-chat"), chat("parked")];
    expect(
      retainedSessionIds(sessions, new Set(), [], [], ["bot-chat"]).has(
        "bot-chat",
      ),
    ).toBe(true);
    expect(
      retainedSessionIds(sessions, new Set(), [], [], []).has("bot-chat"),
    ).toBe(false);
  });
});
