import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "./activity";
import type { Session } from "./session";
import { clockTime } from "./sessionHoldUp";
import { sessionRunStatus } from "./sessionRunStatus";

const NOW = Date.UTC(2026, 10, 19, 15, 0, 0);
const RESET = NOW + 40 * 60_000;
const clock = clockTime(RESET, NOW);

function session(patch: Partial<Session> = {}): Session {
  return {
    id: "chat",
    harness: "codex",
    model: "model",
    modelSettings: {},
    runtimeMode: "full-access",
    title: "Task",
    cwd: "/repo",
    blocks: [
      {
        id: "user",
        role: "user",
        text: "Fix it",
        startedAt: NOW - 60_000,
        durationMs: 9_000,
      },
    ],
    usageHold: { harness: "codex", resetsAt: RESET, cutOff: true },
    ...patch,
  };
}

function ended(outcome: "failed" | "completed" | "stopped"): ActivityEntry {
  return {
    id: `chat:turn:runtime:${outcome}`,
    sessionId: "chat",
    outcome,
    title: "Task",
    summary: "",
    cwd: "/repo",
    harness: "codex",
    model: "model",
    createdAt: NOW - 50_000,
    readAt: null,
    resolvedAt: null,
  };
}

describe("a turn the usage limit cut off", () => {
  it("says when the limit resets, in place of a plain failure", () => {
    expect(sessionRunStatus(session(), [ended("failed")], NOW)).toMatchObject({
      kind: "failed",
      label: `Usage limit · resets ${clock}`,
      detail: "Messages you send wait until then",
      wakeAt: RESET,
      usageLimit: {
        resetsAt: RESET,
        canContinue: true,
        continueAtReset: false,
      },
    });
    expect(
      sessionRunStatus(
        session({
          usageHold: {
            harness: "codex",
            resetsAt: RESET,
            cutOff: true,
            continueAtReset: true,
          },
        }),
        [ended("completed")],
        NOW,
      ),
    ).toMatchObject({
      detail: "Aven continues the reply then",
      usageLimit: { continueAtReset: true },
    });
  });

  it("says the limit is reached when no reset time came with it", () => {
    expect(
      sessionRunStatus(
        session({ usageHold: { harness: "codex", cutOff: true } }),
        [ended("failed")],
        NOW,
      ),
    ).toMatchObject({
      kind: "failed",
      label: "Usage limit reached",
      usageLimit: { canContinue: false },
    });
  });

  it("says the limit has reset once it has", () => {
    expect(
      sessionRunStatus(
        session({
          usageHold: {
            harness: "codex",
            resetsAt: RESET,
            cutOff: true,
            reset: true,
          },
        }),
        [ended("failed")],
        NOW,
      ),
    ).toMatchObject({ kind: "finished", label: "Usage limit has reset" });
  });

  it("leaves a stop, another provider's limit and other failures alone", () => {
    expect(sessionRunStatus(session(), [ended("stopped")], NOW)?.label).toBe(
      "Stopped",
    );
    expect(
      sessionRunStatus(
        session({
          usageHold: { harness: "claude", resetsAt: RESET, cutOff: true },
        }),
        [ended("failed")],
        NOW,
      )?.label,
    ).toBe("Failed");
    expect(
      sessionRunStatus(
        session({ usageHold: undefined }),
        [ended("failed")],
        NOW,
      )?.label,
    ).toBe("Failed");
  });
});

describe("messages held by the usage limit", () => {
  it("say when they send instead of being ready to send", () => {
    const held = session({
      queuedMessages: [{ id: "q", text: "Then this", attachments: [] }],
      queueStatus: "active",
    });
    expect(sessionRunStatus(held, [ended("failed")], NOW)).toMatchObject({
      kind: "queued",
      label: "Queued",
      detail: `Sends at ${clock}`,
      wakeAt: RESET,
      usageLimit: { resetsAt: RESET, canContinue: false },
    });
    expect(sessionRunStatus(held, [ended("failed")], RESET)?.detail).toBe(
      "1 message ready to send",
    );
  });
});
