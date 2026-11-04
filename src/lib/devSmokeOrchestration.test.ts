import { describe, expect, it } from "vitest";
import {
  describeOrchestrationRun,
  runHoldsProject,
} from "./devSmokeOrchestration";
import type { OrchestrationRun, OrchestrationTask } from "./orchestration";
import { newSession, type Session } from "./session";

function task(patch: Partial<OrchestrationTask> = {}): OrchestrationTask {
  return {
    id: "note-a",
    sessionId: "worker-a",
    title: "Write note A",
    harness: "claude",
    model: "claude:sonnet-5",
    prompt: "Write notes/a.md.",
    files: ["notes/a.md"],
    scopes: ["/repo/notes/a.md"],
    dependsOn: [],
    status: "running",
    accepted: false,
    result: "",
    delivered: true,
    ...patch,
  };
}

function run(patch: Partial<OrchestrationRun> = {}): OrchestrationRun {
  return {
    version: 1,
    leadId: "lead",
    cwd: "/repo",
    status: "active",
    allowedHarnesses: ["claude"],
    maxWorkers: 2,
    cli: "aven",
    tasks: [task()],
    continuations: 0,
    requests: {},
    ...patch,
  };
}

function chat(id: string, patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", "/repo"), id, ...patch };
}

describe("the real-app check's report on a run it gave up on", () => {
  it("names where the run, its lead, each agent and the wake-up stood", () => {
    const sessions = [
      chat("lead", {
        busy: false,
        blocks: [
          {
            id: "u",
            role: "user",
            text: "The user confirmed the orchestration card.",
          },
          {
            id: "a",
            role: "assistant",
            text: "AVEN_SMOKE_OK   Still\nsupervising.",
          },
        ],
      }),
      chat("worker-a", {
        busy: true,
        pendingQuestion: {
          requestId: 3,
          questions: [
            {
              id: "title",
              prompt: "Which title?",
              multiSelect: false,
              allowCustom: false,
              options: [{ id: "short", label: "Short" }],
            },
          ],
        },
      }),
      chat("worker-b", { busy: false }),
    ];
    const active = run({
      continuations: 1,
      tasks: [
        task(),
        task({
          id: "note-b",
          sessionId: "worker-b",
          title: "Write note B",
          status: "completed",
          delivered: false,
        }),
      ],
    });
    expect(
      describeOrchestrationRun(active, sessions, {
        waking: false,
        announced: [],
        blocked: ["note-a:3"],
      }),
    ).toBe(
      [
        "run active, lead woken 1 time",
        "lead idle, last said “AVEN_SMOKE_OK Still supervising.”",
        "agent “Write note A” running; its working, asking (requestId 3)",
        "agent “Write note B” completed, result not delivered to the lead; its idle",
        "wake-up not in flight, lead told of no request, blocked now: note-a:3",
      ].join("; "),
    );
  });

  it("says what it cannot see, and keeps the lead's long reply short", () => {
    const paused = run({
      status: "paused",
      error: "The lead's turn ended with an error.",
      continuations: 2,
      tasks: [
        task({
          status: "failed",
          delivered: true,
          error: "Stopped because Aven couldn't save the run.",
        }),
      ],
    });
    const sessions = [
      chat("lead", {
        busy: true,
        queuedMessages: [{ id: "q", text: "later", attachments: [] }],
        blocks: [{ id: "a", role: "assistant", text: "x".repeat(200) }],
      }),
    ];
    expect(describeOrchestrationRun(paused, sessions)).toBe(
      [
        "run paused (The lead's turn ended with an error.), lead woken 2 times",
        `lead working, 1 queued, last said “${"x".repeat(79)}…”`,
        "agent “Write note A” failed, error “Stopped because Aven couldn't save the run.”; its chat not open",
      ].join("; "),
    );
    expect(describeOrchestrationRun(undefined, sessions)).toBe("no run");
  });

  it("knows which runs still keep the project's other chats from working", () => {
    expect(runHoldsProject(undefined)).toBe(false);
    expect(runHoldsProject(run())).toBe(true);
    expect(runHoldsProject(run({ status: "paused" }))).toBe(true);
    expect(
      runHoldsProject(
        run({ status: "finished", tasks: [task({ status: "completed" })] }),
      ),
    ).toBe(false);
    // A stopped run whose agent is still being stopped holds it too.
    expect(
      runHoldsProject(
        run({ status: "stopped", tasks: [task({ status: "cancelling" })] }),
      ),
    ).toBe(true);
  });
});
