import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeMode } from "../session";
import type { HarnessEvent } from "./types";

let onLine: ((line: string) => void) | undefined;
let onEvent: ((event: Record<string, unknown>) => void) | undefined;
const calls: Array<{ method: string; args: unknown[] }> = [];
let updateError: Error | undefined;

vi.mock("./child", () => ({
  resolveOpenCodeBinary: async () => ({ path: "/fake/opencode" }),
  execChild: async () => "1.14.19",
  freeHarnessPort: async () => 4096,
  spawnChild: async () =>
    onLine?.("opencode server listening on http://127.0.0.1:4096"),
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (value: string) => void) => {
    onLine = line;
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

const { bindOpenCodeSession, forgetOpenCodeSession, sendOpenCodeTurn } =
  await import("./opencode");

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

function finish() {
  onEvent!({
    type: "session.status",
    properties: { sessionID: "oc_1", status: { type: "idle" } },
  });
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
  onEvent = undefined;
  updateError = undefined;
});

afterEach(async () => {
  await forgetOpenCodeSession("opencode-live");
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
