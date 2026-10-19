import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, Session } from "./session";
import {
  COMMAND_HOLD_UP_MS,
  STARTING_HOLD_UP_MS,
  holdUpAt,
  holdUpHint,
  sessionHoldUps,
} from "./sessionHoldUp";

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

function user(): Block {
  return { id: "user", role: "user", text: "Fix it", startedAt: NOW - 60_000 };
}

function shell(startedAt: number, status = "in_progress"): Block {
  return {
    id: "shell",
    role: "tool",
    text: "npm test",
    streaming: true,
    tool: { kind: "execute", status, startedAt },
  };
}

function session(patch: Partial<Session> = {}): Session {
  return {
    id: "chat",
    harness: "claude",
    model: "claude:sonnet-5",
    modelSettings: {},
    runtimeMode: "full-access",
    title: "Task",
    cwd: "/repo",
    blocks: [user()],
    busy: true,
    ...patch,
  };
}

const helpers: Session["liveAgents"] = [
  { id: "a", title: "Inspect", status: "running" },
  { id: "b", title: "Review", status: "running" },
  { id: "c", title: "Docs", status: "running" },
  { id: "d", title: "Paused", status: "waiting" },
  { id: "e", title: "Done", status: "completed" },
];

function line(current: Session, now = NOW) {
  return holdUpAt(sessionHoldUps(current), now).words?.line;
}

describe("sessionHoldUps", () => {
  it("lists every hold-up, most specific first", () => {
    const current = session({
      waitingOn: {
        retry: { attempt: 1, retryAt: NOW + 20_000, reason: "busy" },
        usageLimit: { resetsAt: NOW + 3_600_000 },
        starting: NOW - 5_000,
        helpers: NOW - 60_000,
      },
      blocks: [user(), shell(NOW - 30_000)],
      liveAgents: helpers,
    });
    expect(sessionHoldUps(current).map((holdUp) => holdUp.kind)).toEqual([
      "retrying",
      "usage-limit",
      "starting",
      "command",
      "helpers",
    ]);
  });

  it("holds nothing up while the chat needs you", () => {
    expect(
      sessionHoldUps(
        session({
          waitingOn: { retry: { attempt: 1 } },
          pendingQuestion: { requestId: 1, questions: [] },
        }),
      ),
    ).toEqual([]);
  });

  it("counts only running helpers, after the reply or with no turn at all", () => {
    expect(
      sessionHoldUps(
        session({ waitingOn: { helpers: NOW }, liveAgents: helpers }),
      ),
    ).toEqual([{ kind: "helpers", count: 3, since: NOW }]);
    expect(
      sessionHoldUps(session({ busy: false, liveAgents: helpers })),
    ).toEqual([{ kind: "helpers", count: 3 }]);
    // Agents the lead still waits on mid-reply are its work, not a hold-up.
    expect(sessionHoldUps(session({ liveAgents: helpers }))).toEqual([]);
  });

  it("finds a command still running behind parallel calls, and only then", () => {
    const read: Block = {
      id: "read",
      role: "tool",
      text: "Read app.ts",
      tool: { kind: "read", status: "completed", startedAt: NOW - 1_000 },
    };
    expect(
      sessionHoldUps(session({ blocks: [user(), shell(NOW - 1_000), read] })),
    ).toEqual([{ kind: "command", since: NOW - 1_000, command: "npm test" }]);
    const reply: Block = { id: "reply", role: "assistant", text: "Done" };
    expect(
      sessionHoldUps(session({ blocks: [user(), shell(NOW), reply] })),
    ).toEqual([]);
    expect(
      sessionHoldUps(
        session({ blocks: [user(), shell(NOW - 1_000, "completed")] }),
      ),
    ).toEqual([]);
  });
});

describe("holdUpAt", () => {
  it("words a retry with its countdown and the try it starts", () => {
    const current = session({
      waitingOn: {
        retry: { attempt: 1, retryAt: NOW + 20_000, reason: "busy" },
      },
    });
    expect(holdUpAt(sessionHoldUps(current), NOW)).toEqual({
      words: {
        kind: "retrying",
        label: "Claude is busy",
        detail: "Retrying in 20s (try 2)",
        line: "Claude is busy · retrying in 20s (try 2)",
      },
      wakeAt: NOW + 1_000,
    });
    expect(line(current, NOW + 20_000)).toBe(
      "Claude is busy · retrying now (try 2)",
    );
    // A retry that never reported back stops holding the chat up.
    expect(line(current, NOW + 50_000)).toBeUndefined();
  });

  it.each([
    ["rate-limit", "Too many requests"],
    ["server", "Claude had an error"],
    ["connection", "Can’t reach Claude"],
    ["no-response", "Claude isn’t responding"],
  ] as const)("names a %s retry plainly", (reason, label) => {
    expect(
      holdUpAt(
        sessionHoldUps(session({ waitingOn: { retry: { reason } } })),
        NOW,
      ).words,
    ).toMatchObject({ label, line: `${label} · retrying` });
  });

  it("names the usage limit as a rate-limited retry's cause", () => {
    expect(
      line(
        session({
          harness: "codex",
          waitingOn: {
            retry: { attempt: 2, reason: "rate-limit" },
            usageLimit: {},
          },
        }),
      ),
    ).toBe("Usage limit reached · retrying (try 3)");
    expect(line(session({ harness: "codex", waitingOn: { retry: {} } }))).toBe(
      "Codex is busy · retrying",
    );
  });

  it("says when a reached usage limit resets, until it does", () => {
    const resetsAt = NOW + 40 * 60_000;
    const current = session({ waitingOn: { usageLimit: { resetsAt } } });
    const clock = new Date(resetsAt).toLocaleString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(holdUpAt(sessionHoldUps(current), NOW)).toEqual({
      words: {
        kind: "usage-limit",
        label: "Usage limit reached",
        detail: `Resets ${clock}`,
        line: `Usage limit reached · resets ${clock}`,
      },
      wakeAt: resetsAt,
    });
    expect(line(current, resetsAt)).toBeUndefined();
    expect(line(session({ waitingOn: { usageLimit: {} } }))).toBe(
      "Usage limit reached",
    );
  });

  it("says the agent is starting only after a second", () => {
    const current = session({ waitingOn: { starting: NOW } });
    expect(holdUpAt(sessionHoldUps(current), NOW + 999)).toEqual({
      wakeAt: NOW + STARTING_HOLD_UP_MS,
    });
    expect(line(current, NOW + STARTING_HOLD_UP_MS)).toBe("Starting Claude…");
  });

  it("names a command only once it has run ten seconds", () => {
    const current = session({ blocks: [user(), shell(NOW)] });
    expect(holdUpAt(sessionHoldUps(current), NOW + 9_999)).toEqual({
      wakeAt: NOW + COMMAND_HOLD_UP_MS,
    });
    expect(holdUpAt(sessionHoldUps(current), NOW + 10_000)).toEqual({
      words: {
        kind: "command",
        label: "Running a command",
        detail: "npm test · 10s",
        line: "Running a command · 10s",
      },
      wakeAt: NOW + 11_000,
    });
    expect(line(current, NOW + 125_000)).toBe("Running a command · 2m");
    expect(holdUpAt(sessionHoldUps(current), NOW + 125_000).wakeAt).toBe(
      NOW + 180_000,
    );
  });

  it("falls through a hold-up that is too new to the next one", () => {
    const current = session({
      waitingOn: { helpers: NOW - 19 * 60_000 - 4_000 },
      blocks: [user(), shell(NOW - 2_000)],
      liveAgents: helpers,
    });
    expect(holdUpAt(sessionHoldUps(current), NOW)).toEqual({
      words: {
        kind: "helpers",
        label: "Waiting on 3 helper agents",
        detail: "Reply done · 19m",
        line: "Waiting on 3 helper agents · 19m",
      },
      // The command reaches ten seconds before the minute turns.
      wakeAt: NOW + 8_000,
    });
  });

  it("keeps quiet when nothing holds the chat up", () => {
    expect(holdUpAt(sessionHoldUps(session()), NOW)).toEqual({});
  });
});

describe("holdUpHint", () => {
  it("names a retry, the usage limit or helpers without a clock", () => {
    expect(
      holdUpHint(
        sessionHoldUps(
          session({
            waitingOn: { retry: { attempt: 1, retryAt: NOW + 20_000 } },
          }),
        ),
        NOW,
      ),
    ).toBe("Claude is busy · retrying (try 2)");
    expect(
      holdUpHint(
        sessionHoldUps(
          session({
            waitingOn: { helpers: NOW - 60_000 },
            liveAgents: helpers,
          }),
        ),
        NOW,
      ),
    ).toBe("Waiting on 3 helper agents");
  });

  it("leaves short-lived starts and commands to the run card", () => {
    expect(
      holdUpHint(
        sessionHoldUps(
          session({
            waitingOn: { starting: NOW - 5_000 },
            blocks: [user(), shell(NOW - 60_000)],
          }),
        ),
        NOW,
      ),
    ).toBeUndefined();
    expect(
      holdUpHint(
        sessionHoldUps(
          session({ waitingOn: { usageLimit: { resetsAt: NOW - 1 } } }),
        ),
        NOW,
      ),
    ).toBeUndefined();
  });
});
