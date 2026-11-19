import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeUsageHold,
  canDispatchQueuedHead,
  CONTINUE_AT_RESET_TEXT,
  nextUsageReset,
  queuedMessageForSubmit,
  releaseUsageHold,
  setContinueAtReset,
  shouldEnqueueSubmission,
} from "./messageQueue";
import { newSession, type QueuedMessage, type Session } from "./session";
import { sanitizeSessionForPersist } from "./sessionStore";

const NOW = 1_800_000_000_000;
const RESET = NOW + 40 * 60_000;

function stubStorage() {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
}

beforeEach(() => {
  stubStorage();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function queued(id: string): QueuedMessage {
  return { id, text: id, attachments: [] };
}

function chat(patch: Partial<Session> = {}): Session {
  return {
    ...newSession("claude", "/tmp/project"),
    usageHold: { harness: "claude", resetsAt: RESET, cutOff: true },
    ...patch,
  };
}

describe("the usage limit holds the queue", () => {
  it("does not send the queued head until the limit resets", () => {
    const held = chat({ queuedMessages: [queued("a")], queueStatus: "active" });
    expect(canDispatchQueuedHead(held)).toBe(false);
    expect(queuedMessageForSubmit(held, "a", "dispatch")).toBeUndefined();
    // "Send now" still sends by hand.
    expect(queuedMessageForSubmit(held, "a", "steer")?.id).toBe("a");
    vi.setSystemTime(RESET);
    expect(canDispatchQueuedHead(held)).toBe(true);
  });

  it("queues a new message instead of sending it into the limit", () => {
    expect(shouldEnqueueSubmission(chat(), "steer")).toBe(true);
    expect(shouldEnqueueSubmission(chat(), "queue")).toBe(true);
    // A queued row sent by hand goes.
    expect(shouldEnqueueSubmission(chat(), "queue", "a")).toBe(false);
    expect(shouldEnqueueSubmission(chat(), "steer", undefined, RESET)).toBe(
      false,
    );
  });

  it("holds nothing back without a reset time, or for another provider", () => {
    const unknown = chat({ usageHold: { harness: "claude", cutOff: true } });
    expect(activeUsageHold(unknown)).toBeUndefined();
    expect(shouldEnqueueSubmission(unknown, "steer")).toBe(false);
    const switched = { ...chat(), harness: "codex" as const };
    expect(activeUsageHold(switched)).toBeUndefined();
    expect(
      canDispatchQueuedHead({ ...switched, queuedMessages: [queued("a")] }),
    ).toBe(true);
  });

  it("is never saved", () => {
    expect(sanitizeSessionForPersist(chat())).not.toHaveProperty("usageHold");
  });
});

describe("at reset", () => {
  it("lets the hold go and leaves queued messages to send", () => {
    const held = chat({
      cwd: "/tmp/project",
      queuedMessages: [queued("a")],
      queueStatus: "active",
      usageHold: { harness: "claude", resetsAt: RESET },
    });
    expect(releaseUsageHold(held, RESET - 1)).toBe(held);
    const released = releaseUsageHold(held, RESET);
    expect(released.usageHold).toBeUndefined();
    expect(released.queuedMessages).toEqual([queued("a")]);
    expect(canDispatchQueuedHead(released, RESET)).toBe(true);
  });

  it("says a cut-off turn's limit has reset, without holding", () => {
    const released = releaseUsageHold(chat(), RESET);
    expect(released.usageHold).toEqual({
      harness: "claude",
      resetsAt: RESET,
      cutOff: true,
      reset: true,
    });
    expect(activeUsageHold(released, RESET - 1)).toBeUndefined();
    expect(releaseUsageHold(released, RESET + 1)).toBe(released);
    expect(nextUsageReset([released])).toBeUndefined();
  });

  it("queues a short continue when Continue at is on and nothing is queued", () => {
    const on = setContinueAtReset(chat(), true);
    expect(on.usageHold?.continueAtReset).toBe(true);
    const released = releaseUsageHold(on, RESET);
    expect(released.usageHold).toBeUndefined();
    expect(released.queuedMessages).toEqual([
      expect.objectContaining({ text: CONTINUE_AT_RESET_TEXT }),
    ]);
    expect(released.queueStatus).toBe("active");
    // The user's own queued message continues instead.
    const withQueue = releaseUsageHold(
      { ...on, queuedMessages: [queued("mine")] },
      RESET,
    );
    expect(withQueue.queuedMessages).toEqual([queued("mine")]);
  });

  it("offers Continue at only for a cut-off turn with a reset to come", () => {
    const notCut = chat({ usageHold: { harness: "claude", resetsAt: RESET } });
    expect(setContinueAtReset(notCut, true)).toBe(notCut);
    const unknown = chat({ usageHold: { harness: "claude", cutOff: true } });
    expect(setContinueAtReset(unknown, true)).toBe(unknown);
    const on = setContinueAtReset(chat(), true);
    expect(setContinueAtReset(on, true)).toBe(on);
    expect(setContinueAtReset(on, false).usageHold?.continueAtReset).toBe(
      undefined,
    );
  });

  it("finds the next reset among chats", () => {
    expect(
      nextUsageReset([
        chat(),
        chat({ usageHold: { harness: "codex", resetsAt: NOW + 5 } }),
        chat({ usageHold: undefined }),
      ]),
    ).toBe(NOW + 5);
    expect(nextUsageReset([])).toBeUndefined();
  });
});
