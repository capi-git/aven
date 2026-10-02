import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeMode } from "../session";
import type { HarnessEvent } from "./types";

let onLine: ((line: string) => void) | undefined;
let onChildExit: ((code: number | null) => void) | undefined;
const closeHarnessSse = vi.fn(async (_id: string) => undefined);
const killChild = vi.fn(async (_id: string) => undefined);
let onEvent: ((event: Record<string, unknown>) => void) | undefined;
const calls: Array<{ method: string; args: unknown[] }> = [];
let updateError: Error | undefined;

vi.mock("./child", () => ({
  closeHarnessSse,
  resolveOpenCodeBinary: async () => ({ path: "/fake/opencode" }),
  execChild: async () => "1.14.19",
  freeHarnessPort: async () => 4096,
  spawnChild: async () =>
    onLine?.("opencode server listening on http://127.0.0.1:4096"),
  killChild,
  unwatchChild: () => undefined,
  watchChild: (
    _id: string,
    line: (value: string) => void,
    exit: (code: number | null) => void,
  ) => {
    onLine = line;
    onChildExit = exit;
  },
}));

vi.mock("./opencodeClient", () => ({
  OpenCodeHttpError: class extends Error {},
  OpenCodeClient: class {
    async createSession(...args: unknown[]) {
      calls.push({ method: "create", args });
      return { id: "oc_1", directory: "/repo" };
    }
    async getSession(...args: unknown[]) {
      calls.push({ method: "get", args });
      return { id: "oc_1", directory: "/repo" };
    }
    async updateSession(...args: unknown[]) {
      calls.push({ method: "update", args });
      if (updateError) throw updateError;
      return { id: "oc_1", directory: "/repo" };
    }
    async promptAsync(...args: unknown[]) {
      calls.push({ method: "prompt", args });
    }
    async replyPermission(...args: unknown[]) {
      calls.push({ method: "reply", args });
    }
    async rejectQuestion(...args: unknown[]) {
      calls.push({ method: "rejectQuestion", args });
    }
    async abortSession() {}
    async closeEvents() {}
    async subscribeEvents(_id: string, callback: typeof onEvent) {
      onEvent = callback;
    }
  },
}));

const {
  bindOpenCodeSession,
  forgetOpenCodeSession,
  sendOpenCodeTurn,
  stopOpenCodeSession,
} = await import("./opencode");

const fullPermission = [{ permission: "*", pattern: "*", action: "allow" }];

function send(mode: RuntimeMode, events: HarnessEvent[] = []) {
  return sendOpenCodeTurn({
    sessionId: "opencode-live",
    cwd: "/repo",
    model: "opencode:anthropic/claude-sonnet-4-6",
    runtimeMode: mode,
    text: "check the project",
    onEvent: (event) => events.push(event),
  });
}

async function waitForPrompt(count: number) {
  await vi.waitFor(() => {
    expect(calls.filter((call) => call.method === "prompt")).toHaveLength(
      count,
    );
  });
}

function status(type: "busy" | "idle") {
  onEvent!({
    type: "session.status",
    properties: { sessionID: "oc_1", status: { type } },
  });
}

/** OpenCode reports busy while it works on a prompt, then idle. */
function finish() {
  status("busy");
  status("idle");
}

function askPermission(id: string) {
  onEvent!({
    type: "permission.asked",
    properties: {
      sessionID: "oc_1",
      id,
      permission: "bash",
      patterns: ["npm test"],
    },
  });
}

beforeEach(() => {
  calls.length = 0;
  onLine = undefined;
  onChildExit = undefined;
  closeHarnessSse.mockReset().mockResolvedValue(undefined);
  killChild.mockClear();
  onEvent = undefined;
  updateError = undefined;
});

afterEach(async () => {
  await forgetOpenCodeSession("opencode-live");
});

describe("OpenCode turn boundaries", () => {
  const settled = (turn: Promise<void>) => {
    let done = false;
    void turn.then(() => (done = true));
    return async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return done;
    };
  };

  it("ignores an idle or error left over from before this prompt", async () => {
    const turn = send("supervised", []);
    await waitForPrompt(1);
    const isDone = settled(turn);
    // A stopped turn's abort reports idle and an error after the next prompt.
    status("idle");
    onEvent!({
      type: "session.error",
      properties: { sessionID: "oc_1", error: { name: "MessageAbortedError" } },
    });
    expect(await isDone()).toBe(false);
    finish();
    expect(await isDone()).toBe(true);
  });

  it("still ends when a server never reports busy", async () => {
    const turn = send("supervised", []);
    await waitForPrompt(1);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      status("idle");
      await vi.advanceTimersByTimeAsync(5_000);
    } finally {
      vi.useRealTimers();
    }
    await turn;
  });

  it("waits for the idle that follows this prompt's busy", async () => {
    const turn = send("supervised", []);
    await waitForPrompt(1);
    const isDone = settled(turn);
    status("idle");
    expect(await isDone()).toBe(false);
    status("busy");
    expect(await isDone()).toBe(false);
    status("idle");
    expect(await isDone()).toBe(true);
  });
});

describe("OpenCode access propagation", () => {
  it("creates Full access sessions and allows residual permission requests without hiding questions", async () => {
    const events: HarnessEvent[] = [];
    const turn = send("full-access", events);
    await waitForPrompt(1);
    expect(calls.find((call) => call.method === "create")?.args).toEqual([
      { permission: fullPermission },
    ]);
    askPermission("permission_1");
    expect(calls.find((call) => call.method === "reply")?.args).toEqual([
      "permission_1",
      "once",
    ]);
    expect(events.some((event) => event.type === "approval.requested")).toBe(
      false,
    );
    onEvent!({
      type: "question.asked",
      properties: {
        sessionID: "oc_1",
        id: "question_1",
        questions: [
          {
            question: "Which branch?",
            header: "Branch",
            options: [{ label: "Main", description: "Use main" }],
          },
        ],
      },
    });
    expect(events.some((event) => event.type === "question.asked")).toBe(true);
    finish();
    await turn;
  });

  it("applies mode changes before the next prompt, including restoring supervised approvals", async () => {
    const first = send("supervised");
    await waitForPrompt(1);
    finish();
    await first;
    const next = send("full-access");
    await waitForPrompt(2);
    expect(calls.find((call) => call.method === "update")?.args).toEqual([
      "oc_1",
      { permission: fullPermission },
    ]);
    expect(calls.map((call) => call.method)).toEqual([
      "create",
      "prompt",
      "update",
      "prompt",
    ]);
    finish();
    await next;
    const events: HarnessEvent[] = [];
    const supervised = send("supervised", events);
    await waitForPrompt(3);
    expect(
      calls.filter((call) => call.method === "update").at(-1)?.args,
    ).toEqual([
      "oc_1",
      {
        permission: [
          { permission: "*", pattern: "*", action: "ask" },
          { permission: "question", pattern: "*", action: "allow" },
        ],
      },
    ]);
    askPermission("permission_2");
    expect(events.some((event) => event.type === "approval.requested")).toBe(
      true,
    );
    expect(calls.some((call) => call.method === "reply")).toBe(false);
    finish();
    await supervised;
  });

  it("does not run with stale permissions if a mode update fails", async () => {
    const first = send("full-access");
    await waitForPrompt(1);
    finish();
    await first;
    updateError = new Error("permission update failed");
    await expect(send("supervised")).rejects.toThrow(
      "permission update failed",
    );
    expect(calls.filter((call) => call.method === "prompt")).toHaveLength(1);
  });

  it("reapplies the saved mode before resuming a provider session", async () => {
    bindOpenCodeSession("opencode-live", "oc_1", "/repo");
    const turn = send("full-access");
    await waitForPrompt(1);
    expect(calls.map((call) => call.method)).toEqual([
      "get",
      "update",
      "prompt",
    ]);
    expect(calls.find((call) => call.method === "update")?.args).toEqual([
      "oc_1",
      { permission: fullPermission },
    ]);
    finish();
    await turn;
  });

  it("surfaces a restore permission failure rather than silently using the old mode", async () => {
    bindOpenCodeSession("opencode-live", "oc_1", "/repo");
    updateError = new Error("permission update failed");
    await expect(send("supervised")).rejects.toThrow(
      "permission update failed",
    );
    expect(calls.some((call) => call.method === "prompt")).toBe(false);
  });
});

describe("OpenCode event stream cleanup", () => {
  it("closes the event stream after the server exits on its own", async () => {
    const events: HarnessEvent[] = [];
    const turn = send("supervised", events);
    await waitForPrompt(1);
    onChildExit?.(1);
    await expect(turn).rejects.toThrow("OpenCode server exited");
    expect(events).toContainEqual({ type: "session.ended", code: 1 });
    killChild.mockClear();

    await stopOpenCodeSession("opencode-live");
    expect(closeHarnessSse).toHaveBeenCalledExactlyOnceWith("opencode-live");
    expect(killChild).toHaveBeenCalledExactlyOnceWith("opencode-live");
  });

  it("still kills the child when closing an ended stream fails", async () => {
    const turn = send("supervised", []);
    await waitForPrompt(1);
    onChildExit?.(1);
    await turn.catch(() => undefined);
    killChild.mockClear();
    closeHarnessSse.mockRejectedValueOnce(new Error("SSE close failed"));

    await expect(stopOpenCodeSession("opencode-live")).resolves.toBeUndefined();
    expect(closeHarnessSse).toHaveBeenCalledExactlyOnceWith("opencode-live");
    expect(killChild).toHaveBeenCalledExactlyOnceWith("opencode-live");
  });

  it("leaves a live session's stream to its client", async () => {
    const turn = send("supervised", []);
    await waitForPrompt(1);
    finish();
    await turn;

    await stopOpenCodeSession("opencode-live");
    expect(closeHarnessSse).not.toHaveBeenCalled();
  });
});
