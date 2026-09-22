import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendSteerUser,
  appendUser,
  applyHarnessEvent,
  stopStreaming,
} from "./harness/apply";
import { newSession } from "./session";
import { appendSteerFailure } from "./sessionSteerFailure";

let now = 0;
beforeEach(() => {
  now = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());

function runningSteer() {
  let session = appendUser(newSession("codex", "/tmp"), "Build the page");
  session = applyHarnessEvent(session, {
    type: "tool.started",
    callId: "read-file",
    title: "Read the component",
    status: "running",
  });
  session = appendSteerUser(session, "Use the blue theme");
  // Provider output can arrive while the follow-up request is still pending.
  return applyHarnessEvent(session, {
    type: "message.delta",
    key: "original-response",
    text: "Building",
  });
}

describe("failed steering requests", () => {
  it("keeps the original turn and streams active through a rejection and later output", () => {
    const running = runningSteer();
    now = 8_000;
    let session = appendSteerFailure(
      running,
      new Error("The follow-up request was rejected"),
    );
    expect(session.busy).toBe(true);
    expect(session.blocks[0]?.durationMs).toBeUndefined();
    running.blocks.forEach((block, index) => {
      expect(session.blocks[index]).toBe(block);
    });
    expect(session.blocks.at(-1)).toMatchObject({
      role: "system",
      text: "Could not send the steering message. The follow-up request was rejected",
    });
    expect(running.blocks).toHaveLength(4);

    session = applyHarnessEvent(session, {
      type: "message.delta",
      key: "original-response",
      text: " the page",
    });
    expect(session.busy).toBe(true);
    expect(
      session.blocks.find((block) => block.role === "assistant"),
    ).toMatchObject({
      text: "Building the page",
      streaming: true,
    });
    session = applyHarnessEvent(session, {
      type: "tool.updated",
      callId: "read-file",
      status: "completed",
    });
    expect(session.busy).toBe(true);

    now = 15_000;
    session = stopStreaming(session);
    expect(session.busy).toBe(false);
    expect(session.blocks.some((block) => block.streaming)).toBe(false);
  });

  it("preserves pending questions and approvals instead of dismissing them", () => {
    let session = runningSteer();
    session = applyHarnessEvent(session, {
      type: "approval.requested",
      requestId: 1,
      callId: "read-file",
      title: "Read the component",
    });
    session = applyHarnessEvent(session, {
      type: "question.asked",
      requestId: 2,
      questions: [],
    });
    const pendingQuestion = session.pendingQuestion;
    const blocks = session.blocks;
    session = appendSteerFailure(
      session,
      new Error("Could not prepare attachment"),
    );
    expect(session.busy).toBe(true);
    expect(session.pendingQuestion).toBe(pendingQuestion);
    blocks.forEach((block, index) => expect(session.blocks[index]).toBe(block));
    expect(
      session.blocks.find((block) => block.approval)?.approval?.decided,
    ).toBeUndefined();
  });

  it("still stops on a genuine provider error after the steering request fails", () => {
    let session = appendSteerFailure(
      runningSteer(),
      new Error("Follow-up rejected"),
    );
    now = 9_000;
    session = applyHarnessEvent(session, {
      type: "session.error",
      message: "Provider process exited",
    });
    expect(session.busy).toBe(false);
    expect(session.blocks.some((block) => block.streaming)).toBe(false);
    expect(session.blocks.at(-1)?.text).toBe("Provider process exited");
  });

  it("does not restart a turn that finished before the steering request rejected", () => {
    let session = appendUser(newSession("codex", "/tmp"), "Build the page");
    now = 5_000;
    session = stopStreaming(session);
    now = 12_000;
    session = appendSteerFailure(session, "No active turn to steer");
    expect(session.busy).toBe(false);
    expect(session.blocks.some((block) => block.streaming)).toBe(false);
    expect(session.blocks[0]?.durationMs).toBe(4_000);
    expect(session.blocks.at(-1)?.text).toContain("No active turn to steer");
  });

  it("shows a useful notice even if the adapter throws no error message", () => {
    const session = appendSteerFailure(runningSteer(), undefined);
    expect(session.blocks.at(-1)?.text).toBe(
      "Could not send the steering message.",
    );
    expect(session.busy).toBe(true);
  });
});
