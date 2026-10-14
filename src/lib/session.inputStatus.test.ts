import { describe, expect, it } from "vitest";
import {
  sessionIsWaitingForInput,
  sessionNeedsInput,
  type Session,
} from "./session";

function session(patch: Partial<Session> = {}): Session {
  return {
    id: "session",
    harness: "codex",
    model: "model",
    modelSettings: {},
    runtimeMode: "full-access",
    title: "Task",
    cwd: "/tmp/project",
    blocks: [],
    ...patch,
  };
}

describe("session input status", () => {
  it("keeps optional questions actionable without marking work as paused", () => {
    const current = session({
      busy: true,
      pendingQuestion: { requestId: 1, questions: [], blocking: false },
    });
    expect(sessionNeedsInput(current)).toBe(true);
    expect(sessionIsWaitingForInput(current)).toBe(false);
  });

  it("preserves waiting behavior for existing blocking questions", () => {
    const current = session({
      harness: "claude",
      busy: true,
      pendingQuestion: { requestId: 1, questions: [] },
    });
    expect(sessionNeedsInput(current)).toBe(true);
    expect(sessionIsWaitingForInput(current)).toBe(true);
  });

  it("waits for approval even when a question can be answered in parallel", () => {
    const current = session({
      busy: true,
      pendingQuestion: { requestId: 1, questions: [], blocking: false },
      blocks: [
        {
          id: "approval",
          role: "approval",
          text: "Allow?",
          approval: { requestId: 2 },
        },
      ],
    });
    expect(sessionIsWaitingForInput(current)).toBe(true);
    current.blocks[0].approval!.decided = "allow";
    expect(sessionIsWaitingForInput(current)).toBe(false);
    expect(sessionNeedsInput(current)).toBe(true);
  });
});
