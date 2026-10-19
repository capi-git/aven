import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession, type Session } from "../session";
import { sanitizeSessionForPersist } from "../sessionStore";
import {
  appendUser,
  applyHarnessEvent,
  applyHarnessEvents,
  stopStreaming,
} from "./apply";
import type { HarnessEvent } from "./types";

let now = 0;

function stubStorage() {
  // Some Node versions give tests a working localStorage and some do not.
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
}

beforeEach(() => {
  stubStorage();
  now = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function running(): Session {
  return appendUser(newSession("claude", "/repo"), "Fix the build");
}

function apply(session: Session, ...events: HarnessEvent[]): Session {
  return events.reduce(applyHarnessEvent, session);
}

const retry: HarnessEvent = {
  type: "turn.waiting",
  set: { retry: { attempt: 1, retryAt: 21_000, reason: "busy" } },
};

describe("what a turn waits on", () => {
  it("keeps a retry until the agent's own output resumes", () => {
    const waiting = apply(running(), retry);
    expect(waiting.waitingOn).toEqual({
      retry: { attempt: 1, retryAt: 21_000, reason: "busy" },
    });
    for (const output of [
      { type: "message.delta", text: "Back" },
      { type: "reasoning.delta", text: "Hmm" },
      { type: "tool.started", callId: "c1", title: "Bash", kind: "execute" },
      { type: "plan", text: "1. Fix" },
    ] satisfies HarnessEvent[])
      expect(apply(waiting, output).waitingOn).toBeUndefined();
    expect(
      applyHarnessEvents(waiting, [
        { type: "message.delta", text: "Back" },
        { type: "message.delta", text: " again" },
      ]).waitingOn,
    ).toBeUndefined();
  });

  it("does not take a helper agent's progress for the lead's output", () => {
    const waiting = apply(running(), {
      type: "turn.waiting",
      set: { helpers: 5_000 },
    });
    const progress = apply(
      waiting,
      {
        type: "tool.started",
        callId: "agent:1",
        title: "Inspect",
        kind: "agent",
      },
      {
        type: "tool.updated",
        callId: "agent:1",
        kind: "agent",
        status: "in_progress",
        detail: "Read app.ts",
      },
      {
        type: "agent.updated",
        agentId: "1",
        title: "Inspect",
        status: "running",
      },
    );
    expect(progress.waitingOn).toEqual({ helpers: 5_000 });
  });

  it("keeps when helpers and a start began, and replaces a retry or limit", () => {
    let session = apply(
      running(),
      { type: "turn.waiting", set: { helpers: 5_000, starting: 2_000 } },
      { type: "turn.waiting", set: { helpers: 9_000, starting: 3_000 } },
      retry,
      {
        type: "turn.waiting",
        set: { retry: { attempt: 2 }, usageLimit: { resetsAt: 60_000 } },
      },
    );
    expect(session.waitingOn).toEqual({
      helpers: 5_000,
      starting: 2_000,
      retry: { attempt: 2 },
      usageLimit: { resetsAt: 60_000 },
    });
    session = apply(
      session,
      { type: "turn.waiting", clear: ["usageLimit", "helpers"] },
      { type: "session.started" },
    );
    expect(session.waitingOn).toEqual({ retry: { attempt: 2 } });
    session = apply(session, { type: "turn.waiting", clear: ["retry"] });
    expect(session.waitingOn).toBeUndefined();
  });

  it("returns the same session when nothing changes", () => {
    const waiting = apply(running(), retry);
    expect(apply(waiting, retry)).toBe(waiting);
    expect(
      apply(waiting, { type: "turn.waiting", clear: ["usageLimit"] }),
    ).toBe(waiting);
    expect(apply(waiting, { type: "session.started" })).toBe(waiting);
  });

  it("starts each turn clean and drops what is left when it ends", () => {
    const waiting = apply(running(), retry);
    expect(stopStreaming(waiting).waitingOn).toBeUndefined();
    expect(appendUser(waiting, "Next").waitingOn).toBeUndefined();
  });
});

describe("when a call started running", () => {
  it("notes it once, keeps it through updates, and restarts it when allowed", () => {
    let session = apply(running(), {
      type: "tool.started",
      callId: "c1",
      title: "npm test",
      kind: "execute",
      status: "pending",
    });
    expect(session.blocks.at(-1)?.tool?.startedAt).toBe(1_000);
    now = 4_000;
    session = apply(session, {
      type: "approval.requested",
      requestId: 7,
      title: "npm test",
      kind: "execute",
      callId: "c1",
    });
    session = apply(session, {
      type: "tool.updated",
      callId: "c1",
      kind: "execute",
      status: "pending",
      detail: "waiting",
    });
    expect(session.blocks.at(-1)?.tool?.startedAt).toBe(1_000);
    now = 9_000;
    session = apply(session, {
      type: "approval.resolved",
      requestId: 7,
      decision: "allow",
    });
    expect(session.blocks.at(-1)?.tool?.startedAt).toBe(9_000);
  });

  it("is never saved", () => {
    const session = apply(running(), {
      type: "tool.started",
      callId: "c1",
      title: "npm test",
      kind: "execute",
    });
    expect(session.blocks.at(-1)?.tool?.startedAt).toBe(1_000);
    const saved = sanitizeSessionForPersist(session).blocks.at(-1);
    expect(saved?.tool).toBeDefined();
    expect(saved?.tool).not.toHaveProperty("startedAt");
  });
});
