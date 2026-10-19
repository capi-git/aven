import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, Session } from "./session";
import { sessionRunStatus } from "./sessionRunStatus";
import { currentActivity } from "./sessionDoing";

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

const user: Block = {
  id: "user",
  role: "user",
  text: "Fix it",
  startedAt: NOW - 20 * 60_000,
};
const reply: Block = {
  id: "reply",
  role: "assistant",
  text: "Started three helpers; I'll report when they finish.",
  streaming: true,
};
function shell(startedAt: number): Block {
  return {
    id: "shell",
    role: "tool",
    text: "npm test",
    streaming: true,
    tool: { kind: "execute", status: "in_progress", startedAt },
  };
}
const helpers: Session["liveAgents"] = [
  { id: "a", title: "Inspect", status: "running" },
  { id: "b", title: "Review", status: "running" },
  { id: "c", title: "Docs", status: "running" },
  { id: "d", title: "Done", status: "completed" },
];

function session(patch: Partial<Session> = {}): Session {
  return {
    id: "chat",
    harness: "claude",
    model: "claude:sonnet-5",
    modelSettings: {},
    runtimeMode: "full-access",
    title: "Task",
    cwd: "/repo",
    blocks: [user],
    busy: true,
    ...patch,
  };
}

describe("what holds a working chat up", () => {
  it("names the most specific hold-up first", () => {
    const everything = session({
      waitingOn: {
        retry: { attempt: 1, retryAt: NOW + 20_000, reason: "busy" },
        usageLimit: { resetsAt: NOW + 40 * 60_000 },
        starting: NOW - 5_000,
        helpers: NOW - 60_000,
      },
      blocks: [user, shell(NOW - 30_000)],
      liveAgents: helpers,
      pendingQuestion: { requestId: 1, questions: [] },
    });
    const label = (current: Session) =>
      sessionRunStatus(current, [], NOW)?.label;
    expect(label(everything)).toBe("Needs you");
    let current: Session = { ...everything, pendingQuestion: undefined };
    expect(label(current)).toBe("Claude is busy");
    current = {
      ...current,
      waitingOn: { ...current.waitingOn, retry: undefined },
    };
    expect(label(current)).toBe("Usage limit reached");
    current = {
      ...current,
      waitingOn: { ...current.waitingOn, usageLimit: undefined },
    };
    expect(label(current)).toBe("Starting Claude…");
    current = {
      ...current,
      waitingOn: { ...current.waitingOn, starting: undefined },
    };
    expect(label(current)).toBe("Running a command");
    current = { ...current, blocks: [user, reply] };
    expect(label(current)).toBe("Waiting on 3 helper agents");
    current = { ...current, waitingOn: undefined };
    expect(label(current)).toBe("Working");
  });

  it("says a retry in full, with the run's clock and Stop", () => {
    expect(
      sessionRunStatus(
        session({
          waitingOn: {
            retry: { attempt: 1, retryAt: NOW + 20_000, reason: "busy" },
          },
        }),
        [],
        NOW,
      ),
    ).toEqual({
      kind: "working",
      label: "Claude is busy",
      detail: "Retrying in 20s (try 2)",
      doing: "Claude is busy",
      holdUp: "retrying",
      wakeAt: NOW + 1_000,
      startedAt: NOW - 20 * 60_000,
      canStop: true,
    });
  });

  it("stops saying a reply is being written once only helpers run", () => {
    const current = session({
      blocks: [user, reply],
      waitingOn: { helpers: NOW - 19 * 60_000 - 4_000 },
      liveAgents: helpers,
    });
    expect(
      sessionRunStatus({ ...current, waitingOn: undefined }, [], NOW),
    ).toMatchObject({ detail: "3 agents active · Writing a reply" });
    expect(sessionRunStatus(current, [], NOW)).toMatchObject({
      kind: "working",
      label: "Waiting on 3 helper agents",
      detail: "Reply done · 19m",
      doing: "Waiting on 3 helper agents",
      holdUp: "helpers",
    });
    expect(currentActivity(current)).toBe("Waiting on 3 helper agents");
  });

  it("names a command only after ten seconds, and wakes the card then", () => {
    const current = session({ blocks: [user, shell(NOW - 9_000)] });
    expect(sessionRunStatus(current, [], NOW)).toMatchObject({
      label: "Working",
      detail: "npm test",
      doing: "npm test",
      wakeAt: NOW + 1_000,
    });
    expect(sessionRunStatus(current, [], NOW + 1_000)).toMatchObject({
      label: "Running a command",
      detail: "npm test · 10s",
      doing: "npm test",
      holdUp: "command",
    });
  });

  it("offers Resume while the queue is paused", () => {
    const queued = [{ id: "q", text: "Next", attachments: [] }];
    expect(
      sessionRunStatus(
        session({
          busy: false,
          queuedMessages: queued,
          queueStatus: "paused",
        }),
        [],
        NOW,
      ),
    ).toMatchObject({
      kind: "queued",
      label: "Queue paused",
      detail: "1 message waiting",
      canResume: true,
    });
    expect(
      sessionRunStatus(
        session({ busy: false, queuedMessages: queued }),
        [],
        NOW,
      )?.canResume,
    ).toBeUndefined();
  });
});
