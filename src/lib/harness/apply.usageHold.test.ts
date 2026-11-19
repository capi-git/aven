import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession, type Session } from "../session";
import { appendUser, applyHarnessEvent, stopStreaming } from "./apply";
import type { HarnessEvent } from "./types";

function stubStorage() {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
}

beforeEach(stubStorage);
afterEach(() => vi.unstubAllGlobals());

function running(): Session {
  return appendUser(newSession("claude", "/repo"), "Fix the build");
}

function apply(session: Session, ...events: HarnessEvent[]): Session {
  return events.reduce(applyHarnessEvent, session);
}

const limit = (resetsAt?: number): HarnessEvent => ({
  type: "turn.waiting",
  set: { usageLimit: resetsAt !== undefined ? { resetsAt } : {} },
});

describe("the chat's usage hold", () => {
  it("starts with the limit and outlasts the agent's own output", () => {
    const held = apply(running(), limit(60_000), {
      type: "message.delta",
      text: "You've hit your limit · resets 3pm",
    });
    expect(held.waitingOn).toBeUndefined();
    expect(held.usageHold).toEqual({ harness: "claude", resetsAt: 60_000 });
  });

  it("marks a turn the limit ended as cut off", () => {
    const ended = stopStreaming(apply(running(), limit(60_000)));
    expect(ended.usageHold).toEqual({
      harness: "claude",
      resetsAt: 60_000,
      cutOff: true,
    });
    // Ending again, or an idle chat, changes nothing more.
    expect(stopStreaming(ended).usageHold).toEqual(ended.usageHold);
    const idle = {
      ...newSession("claude", "/repo"),
      usageHold: { harness: "claude" as const },
    };
    expect(stopStreaming(idle).usageHold).toEqual({ harness: "claude" });
  });

  it("keeps the hold when the same limit is reported again", () => {
    const ended = stopStreaming(apply(running(), limit(60_000)));
    expect(apply(ended, limit(60_500)).usageHold).toBe(ended.usageHold);
    expect(apply(ended, limit()).usageHold).toBe(ended.usageHold);
    expect(apply(ended, limit(9_000_000)).usageHold).toEqual({
      harness: "claude",
      resetsAt: 9_000_000,
    });
  });

  it("lets go when the limit no longer holds, or a new turn asks again", () => {
    const held = apply(running(), limit(60_000));
    expect(
      apply(held, { type: "turn.waiting", clear: ["usageLimit"] }).usageHold,
    ).toBeUndefined();
    expect(appendUser(stopStreaming(held), "Go on").usageHold).toBeUndefined();
  });
});
