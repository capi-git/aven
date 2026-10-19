import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_STATUS_HINT,
  chatHoldUpHints,
  chatStatusHint,
} from "./chatStatus";
import type { Session } from "./session";

const NOW = Date.UTC(2026, 9, 19, 15, 0, 0);

function stubStorage() {
  // Some Node versions give tests a working localStorage and some do not.
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
}

beforeEach(stubStorage);
afterEach(() => {
  vi.unstubAllGlobals();
});

function session(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    harness: "claude",
    model: "claude:sonnet-5",
    modelSettings: {},
    runtimeMode: "full-access",
    title: "Task",
    cwd: "/repo",
    blocks: [{ id: "u", role: "user", text: "Go", startedAt: NOW - 1_000 }],
    busy: true,
    ...patch,
  };
}

describe("what the sidebar says holds a chat up", () => {
  it("names a retry, a usage limit or helpers, and leaves other chats out", () => {
    const clock = new Date(NOW + 40 * 60_000).toLocaleString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(
      chatHoldUpHints(
        [
          session("retry", {
            waitingOn: { retry: { attempt: 1, retryAt: NOW + 5_000 } },
          }),
          session("limit", {
            waitingOn: { usageLimit: { resetsAt: NOW + 40 * 60_000 } },
          }),
          session("helpers", {
            waitingOn: { helpers: NOW - 60_000 },
            liveAgents: [
              { id: "a", title: "Inspect", status: "running" },
              { id: "b", title: "Done", status: "completed" },
            ],
          }),
          session("working"),
          session("starting", { waitingOn: { starting: NOW - 5_000 } }),
          session("idle", { busy: false }),
        ],
        NOW,
      ),
    ).toEqual({
      retry: "Claude is busy · retrying (try 2)",
      limit: `Usage limit reached · resets ${clock}`,
      helpers: "Waiting on 1 helper agent",
    });
  });

  it("puts the hold-up in place of a working word's own hint only", () => {
    expect(chatStatusHint("working", "Waiting on 1 helper agent")).toBe(
      "Waiting on 1 helper agent",
    );
    expect(chatStatusHint("racing", "Claude is busy · retrying")).toBe(
      "Claude is busy · retrying",
    );
    expect(chatStatusHint("needs-you", "Claude is busy · retrying")).toBe(
      CHAT_STATUS_HINT["needs-you"],
    );
    expect(chatStatusHint("working")).toBe(CHAT_STATUS_HINT.working);
  });
});
