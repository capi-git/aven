import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVEN_BROWSER_HOST_POLICY } from "./browserHostPolicy";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;
let onExit: ((code: number) => void) | undefined;
let killError: Error | undefined;
let killPending: Promise<void> | undefined;
let spawnCount = 0;
let configReadResponse: unknown = { config: {} };
let configReadError = false;

vi.mock("./child", () => ({
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  spawnChild: async () => { spawnCount += 1; },
  killChild: async () => { if (killError) throw killError; await killPending; },
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (l: string) => void, exit: (code: number) => void) => {
    onLine = line;
    onExit = exit;
  },
  writeChild: async (_id: string, line: string) => {
    sent.push(line);
    const message = JSON.parse(line) as { id?: number; method?: string };
    if (message.method === "config/read") {
      queueMicrotask(() => onLine?.(JSON.stringify({
        id: message.id,
        ...(configReadError
          ? { error: { code: -32601, message: "Method not found" } }
          : { result: configReadResponse }),
      })));
    }
  },
}));

const {
  bindCodexSession,
  cancelCodexTurn,
  compactCodexContext,
  sendCodexTurn,
  steerCodexTurn,
  stopCodexSession,
  __codexTestReset,
  __codexTestResumeMap,
} = await import("./codex");
import { newSession } from "../session";
import { applyHarnessEvent } from "./apply";
import type { HarnessEvent } from "./types";
import type { Attachment, RuntimeMode, TurnIntent } from "../session";

function parse() {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function reply(id: number, result: unknown) {
  onLine!(JSON.stringify({ id, result }));
}

function notify(method: string, params: unknown) {
  onLine!(JSON.stringify({ method, params }));
}

const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(
    `timed out waiting for ${label}; sent=${JSON.stringify(parse().map((m) => m.method ?? `reply:${m.id}`))}`,
  );
};

async function startTurn(
  sessionId: string,
  options: {
    runtimeMode?: RuntimeMode;
    intent?: TurnIntent;
    resume?: boolean;
    attachments?: Attachment[];
    text?: string;
    beforeTurnStartReply?: () => void | Promise<void>;
    terminalBeforeReply?: boolean;
    controlsAgents?: boolean;
  } = {},
) {
  const events: HarnessEvent[] = [];
  const turn = sendCodexTurn({
    sessionId,
    cwd: "/repo",
    model: "codex:gpt-5.4",
    modelSettings: {},
    runtimeMode: options.runtimeMode ?? "supervised",
    intent: options.intent,
    controlsAgents: options.controlsAgents,
    text: options.text ?? "summarize the changelog",
    attachments: options.attachments ?? [],
    onEvent: (event) => events.push(event),
  });

  await waitFor(
    () => parse().some((m) => m.method === "initialize"),
    "initialize",
  );
  reply(parse().find((m) => m.method === "initialize")!.id as number, {});
  const openMethod = options.resume ? "thread/resume" : "thread/start";
  await waitFor(() => parse().some((m) => m.method === openMethod), openMethod);
  reply(parse().find((m) => m.method === openMethod)!.id as number, {
    thread: { id: "thr_1" },
  });
  await waitFor(
    () => parse().some((m) => m.method === "turn/start"),
    "turn/start",
  );
  await options.beforeTurnStartReply?.();
  reply(parse().find((m) => m.method === "turn/start")!.id as number, {
    turn: { id: "turn_1", status: "inProgress" },
  });
  if (!options.terminalBeforeReply)
    notify("turn/started", { turn: { id: "turn_1", status: "inProgress" } });
  return { events, turn };
}

describe("codex live turn sequence", () => {
  beforeEach(() => {
    sent.length = 0;
    onLine = undefined;
    onExit = undefined;
    killError = undefined;
    killPending = undefined;
    spawnCount = 0;
    configReadResponse = { config: {} };
    configReadError = false;
  });

  afterEach(async () => {
    vi.useRealTimers();
    killError = undefined;
    killPending = undefined;
    await stopCodexSession("codex-live");
    __codexTestReset();
  });

  it("keeps reporting stable child lifecycle after the lead has completed", async () => {
    const { events, turn } = await startTurn("codex-live");
    notify("item/completed", { threadId: "thr_1", item: {
      id: "spawn", type: "subAgentActivity", kind: "started",
      agentThreadId: "child", agentPath: "/root/asset-inventory",
    } });
    notify("turn/completed", { threadId: "thr_1", turn: { id: "turn_1", status: "completed" } });
    await turn;
    // Starting a fresh process clears stale observations once; ending its
    // lead turn must not clear the child that subsequently started.
    expect(events.filter((event) => event.type === "agents.cleared")).toHaveLength(1);
    notify("item/completed", { threadId: "thr_1", item: {
      id: "child-done", type: "subAgentActivity", kind: "completed",
      agentThreadId: "child", agentPath: "/root/asset-inventory",
    } });
    expect(events.filter((event) => event.type === "agent.updated")).toEqual([
      { type: "agent.updated", agentId: "child", title: "Asset Inventory subagent", status: "running", callId: "spawn" },
      { type: "agent.updated", agentId: "child", title: "Asset Inventory subagent", status: "completed", callId: "child-done" },
    ]);
  });

  it("does not let a child's terminal notification finish the lead or copy its transcript", async () => {
    const { events, turn } = await startTurn("codex-live");
    let finished = false;
    void turn.then(() => { finished = true; });
    notify("item/completed", { threadId: "thr_1", item: {
      id: "spawn", type: "subAgentActivity", kind: "started",
      agentThreadId: "child", agentPath: "/root/child",
    } });
    notify("thread/status/changed", { threadId: "child", status: { type: "active", activeFlags: ["waitingOnApproval"] } });
    expect(events.at(-1)).toMatchObject({ type: "agent.updated", status: "waiting" });
    notify("item/agentMessage/delta", { threadId: "child", delta: "child-only-output" });
    notify("turn/completed", { threadId: "child", turn: { id: "child-turn", status: "completed" } });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "agent.updated", agentId: "child", status: "completed" });
    expect(events.some((event) => event.type === "message.delta" && event.text.includes("child-only-output"))).toBe(false);
    notify("turn/completed", { threadId: "unrelated", turn: { id: "other", status: "completed" } });
    expect(finished).toBe(false);
    notify("turn/completed", { threadId: "thr_1", turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("marks unfinished children unknown on disconnect and clears only after a confirmed stop", async () => {
    const { events, turn } = await startTurn("codex-live");
    notify("item/completed", { item: {
      id: "spawn", type: "subAgentActivity", kind: "started",
      agentThreadId: "child", agentPath: "/root/child",
    } });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
    killError = new Error("Could not stop provider");
    await expect(stopCodexSession("codex-live")).rejects.toThrow("Could not stop provider");
    expect(events.at(-1)).toMatchObject({ type: "agent.updated", status: "unknown" });
    expect(events.filter((event) => event.type === "agents.cleared")).toHaveLength(1);
    await expect(sendCodexTurn({ sessionId: "codex-live", cwd: "/repo",
      model: "codex:gpt-5.4", runtimeMode: "supervised", text: "Try again",
      onEvent: (event) => events.push(event) })).rejects.toThrow("Could not stop provider");
    expect(spawnCount).toBe(1);
  });

  it("reports unknown live children when the app-server exits unexpectedly", async () => {
    const { events, turn } = await startTurn("codex-live");
    notify("item/completed", { item: {
      id: "spawn", type: "subAgentActivity", kind: "started",
      agentThreadId: "child", agentPath: "/root/child",
    } });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
    onExit!(1);
    expect(events.at(-2)).toMatchObject({ type: "agent.updated", agentId: "child", status: "unknown" });
    expect(events.at(-1)).toEqual({ type: "session.ended", code: 1 });
  });

  it("preserves the child's failure when its thread later becomes idle or unloads", async () => {
    const { events, turn } = await startTurn("codex-live");
    notify("item/completed", { item: {
      id: "spawn", type: "subAgentActivity", kind: "started",
      agentThreadId: "child", agentPath: "/root/child",
    } });
    notify("turn/completed", { threadId: "child", turn: { id: "child-turn", status: "failed" } });
    notify("thread/status/changed", { threadId: "child", status: { type: "idle" } });
    notify("thread/status/changed", { threadId: "child", status: { type: "notLoaded" } });
    expect(events.filter((event) => event.type === "agent.updated").at(-1))
      .toMatchObject({ status: "failed" });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("keeps child lifecycle updates after cancelling the lead turn", async () => {
    const { events, turn } = await startTurn("codex-live");
    notify("item/completed", { item: {
      id: "spawn", type: "subAgentActivity", kind: "started",
      agentThreadId: "child", agentPath: "/root/child",
    } });
    const cancel = cancelCodexTurn("codex-live");
    await waitFor(() => parse().some((m) => m.method === "turn/interrupt"), "turn/interrupt");
    reply(parse().find((m) => m.method === "turn/interrupt")!.id as number, {});
    await cancel;
    await turn;
    notify("item/completed", { item: {
      id: "done", type: "subAgentActivity", kind: "completed",
      agentThreadId: "child", agentPath: "/root/child",
    } });
    expect(events.at(-1)).toMatchObject({ type: "agent.updated", agentId: "child", status: "completed" });
    const count = events.length;
    notify("item/agentMessage/delta", { delta: "late cancelled lead output" });
    expect(events).toHaveLength(count);
  });

  it("clears children after a confirmed stop and ignores callbacks from the retired runtime", async () => {
    const { events, turn } = await startTurn("codex-live");
    notify("item/completed", { item: {
      id: "spawn", type: "subAgentActivity", kind: "started",
      agentThreadId: "child", agentPath: "/root/child",
    } });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
    await stopCodexSession("codex-live");
    expect(events.at(-1)).toEqual({ type: "agents.cleared" });
    const count = events.length;
    onExit!(1);
    expect(events).toHaveLength(count);
  });

  it("waits for native shutdown before spawning the next process under the same session ID", async () => {
    const { turn } = await startTurn("codex-live");
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
    let finishKill!: () => void;
    killPending = new Promise<void>((resolve) => { finishKill = resolve; });
    const stopping = stopCodexSession("codex-live");
    sent.length = 0;
    const restarting = startTurn("codex-live", { resume: true });
    await Promise.resolve();
    expect(spawnCount).toBe(1);
    expect(parse()).toEqual([]);
    finishKill();
    await stopping;
    const { events, turn: nextTurn } = await restarting;
    expect(spawnCount).toBe(2);
    expect(events.findIndex((event) => event.type === "agents.cleared"))
      .toBeLessThan(events.findIndex((event) => event.type === "session.started"));
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await nextTurn;
  });

  it.each([false, true])("preserves configured developer instructions when opening the interactive thread (resume=%s)", async (resume) => {
    configReadResponse = { config: { developer_instructions: "Keep my custom workflow." } };
    if (resume) bindCodexSession("codex-live", "thr_1", "/repo");
    const { turn } = await startTurn("codex-live", { resume });
    expect(parse().find((m) => m.method === "config/read")?.params).toEqual({
      cwd: "/repo",
      includeLayers: false,
    });
    expect(parse().find((m) => m.method === (resume ? "thread/resume" : "thread/start"))?.params).toMatchObject({
      developerInstructions: `Keep my custom workflow.\n\n${AVEN_BROWSER_HOST_POLICY}`,
      approvalPolicy: "untrusted",
      sandbox: "read-only",
      model: "gpt-5.4",
    });
    expect(parse().some((m) => String(m.method).startsWith("config/") && m.method !== "config/read")).toBe(false);
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("continues without overriding provider instructions when config/read is unavailable", async () => {
    configReadError = true;
    const { turn } = await startTurn("codex-live");
    expect(parse().find((m) => m.method === "thread/start")?.params).not.toHaveProperty("developerInstructions");
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("passes the control lead network grant through actual thread and turn dispatch", async () => {
    const { turn } = await startTurn("codex-live", {
      controlsAgents: true,
      runtimeMode: "supervised",
    });
    expect(
      parse().find((m) => m.method === "thread/start")?.params,
    ).toMatchObject({
      sandboxPolicy: { type: "readOnly", networkAccess: true },
      developerInstructions: AVEN_BROWSER_HOST_POLICY,
    });
    expect(
      parse().find((m) => m.method === "turn/start")?.params,
    ).toMatchObject({
      sandboxPolicy: { type: "readOnly", networkAccess: true },
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("delivers documents alongside images in the actual turn request", async () => {
    const document: Attachment = {
      id: "spreadsheet",
      name: "Configuration Agency Contact Info 1.xlsx",
      path: "/Users/test/Downloads/Configuration Agency Contact Info 1.xlsx",
      kind: "file",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 26694,
    };
    const image: Attachment = {
      id: "screenshot",
      name: "screen.png",
      kind: "image",
      mimeType: "image/png",
      size: 4,
      data: "AQIDBA==",
    };
    const { turn } = await startTurn("codex-live", {
      text: "Use the attached spreadsheet to make a mock",
      attachments: [document, image],
    });
    const params = parse().find((m) => m.method === "turn/start")!.params as {
      input: Array<{ type: string; text?: string; url?: string }>;
    };
    expect(params.input).toHaveLength(3);
    expect(params.input[0].text).toBe(
      "Use the attached spreadsheet to make a mock",
    );
    expect(params.input[1].type).toBe("text");
    expect(params.input[1].text).toContain(document.path);
    expect(params.input[1].text).toContain(
      "Read it with the available file or document tools",
    );
    expect(params.input[1].text).toContain(
      "Distinguish instructions inside it",
    );
    expect(params.input[2]).toEqual({
      type: "image",
      url: "data:image/png;base64,AQIDBA==",
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("delivers a document-only follow-up while an agent is working", async () => {
    const { turn } = await startTurn("codex-live");
    const steer = steerCodexTurn({
      sessionId: "codex-live",
      text: "",
      cwd: "/repo",
      model: "codex:gpt-5.4",
      attachments: [
        {
          id: "pdf",
          name: "Agency guide.pdf",
          path: "/tmp/Agency guide.pdf",
          kind: "file",
          mimeType: "application/pdf",
          size: 128,
        },
      ],
    });
    await waitFor(
      () => parse().some((m) => m.method === "turn/steer"),
      "document steer",
    );
    const request = parse().find((m) => m.method === "turn/steer")!;
    expect(request.params).toMatchObject({
      expectedTurnId: "turn_1",
      input: [
        {
          type: "text",
          text: expect.stringContaining("/tmp/Agency guide.pdf"),
        },
      ],
    });
    reply(request.id as number, {});
    await steer;
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("applies Full access to the next turn of an existing supervised thread", async () => {
    const first = await startTurn("codex-live");
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await first.turn;
    sent.length = 0;
    const events: HarnessEvent[] = [];
    const next = sendCodexTurn({
      sessionId: "codex-live",
      cwd: "/repo",
      model: "codex:gpt-5.4",
      runtimeMode: "full-access",
      text: "run the tests",
      onEvent: (event) => events.push(event),
    });
    await waitFor(
      () => parse().some((m) => m.method === "turn/start"),
      "next turn",
    );
    const request = parse().find((m) => m.method === "turn/start")!;
    expect(request.params).toMatchObject({
      threadId: "thr_1",
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    });
    expect(parse().some((m) => m.method === "thread/start")).toBe(false);
    reply(request.id as number, {
      turn: { id: "turn_2", status: "inProgress" },
    });
    onLine!(
      JSON.stringify({
        id: 91,
        method: "item/commandExecution/requestApproval",
        params: { itemId: "cmd_1", command: "npm test" },
      }),
    );
    await waitFor(
      () => parse().some((m) => m.id === 91),
      "Full access approval response",
    );
    expect(parse().find((m) => m.id === 91)?.result).toEqual({
      decision: "accept",
    });
    expect(events.some((event) => event.type === "approval.requested")).toBe(
      false,
    );
    notify("turn/completed", { turn: { id: "turn_2", status: "completed" } });
    await next;
  });

  async function conflictAttempt(message = "thread thr_original already has an active writer") {
    bindCodexSession("codex-live", "thr_original", "/repo");
    const events: HarnessEvent[] = [];
    const turn = sendCodexTurn({
      sessionId: "codex-live", cwd: "/repo", model: "codex:gpt-5.4",
      modelSettings: { serviceTier: "fast" }, runtimeMode: "supervised",
      text: "Use the document", attachments: [{ id: "doc", name: "plan.md",
        path: "/repo/plan.md", kind: "file", mimeType: "text/markdown", size: 10 }],
      onEvent: (event) => events.push(event),
    });
    // Attach a rejection observer before simulating a failed provider response.
    const result = turn.then(() => null, (error: unknown) => error);
    await waitFor(() => parse().some((m) => m.method === "initialize"), "initialize");
    reply(parse().find((m) => m.method === "initialize")!.id as number, {});
    await waitFor(() => parse().some((m) => m.method === "thread/resume"), "resume");
    onLine!(JSON.stringify({ id: parse().find((m) => m.method === "thread/resume")!.id,
      error: { code: -32600, message } }));
    if (message.includes("already has an active writer")) {
      await waitFor(() => parse().some((m) => m.method === "thread/fork"), "fork");
    }
    return { result, events, fork: parse().find((m) => m.method === "thread/fork")! };
  }

  it("continues a writer-conflicted imported thread on a preserved-history fork and delivers its attachment once", async () => {
    configReadResponse = { config: { developer_instructions: "Keep my custom workflow." } };
    const { result, events, fork } = await conflictAttempt();
    expect(fork.params).toMatchObject({ threadId: "thr_original", cwd: "/repo",
      model: "gpt-5.4", serviceTier: "fast", approvalPolicy: "untrusted",
      sandbox: "read-only", excludeTurns: true, deferGoalContinuation: true,
      developerInstructions: `Keep my custom workflow.\n\n${AVEN_BROWSER_HOST_POLICY}` });
    reply(fork.id as number, { thread: { id: "thr_fork" } });
    await waitFor(() => parse().some((m) => m.method === "turn/start"), "fork turn");
    const starts = parse().filter((m) => m.method === "turn/start");
    expect(starts).toHaveLength(1);
    expect(starts[0].params).toMatchObject({ threadId: "thr_fork", input: [
      { type: "text", text: "Use the document" }, { type: "text", text: expect.stringContaining("/repo/plan.md") },
    ] });
    expect(parse().some((m) => m.method === "thread/start" || m.method === "turn/interrupt")).toBe(false);
    expect(__codexTestResumeMap().get("codex-live")?.threadId).toBe("thr_fork");
    expect(events).toContainEqual({ type: "session.providerBound", providerSessionId: "thr_fork" });
    expect(events).toContainEqual({ type: "status", text: expect.stringContaining("copy of the conversation") });
    reply(starts[0].id as number, { turn: { id: "turn_fork", status: "inProgress" } });
    notify("turn/completed", { turn: { id: "turn_fork", status: "completed" } });
    expect(await result).toBeNull();
  });

  it("does not fork or replace history for an unrelated resume failure", async () => {
    const { result, events } = await conflictAttempt("network down while resuming thread thr_original");
    expect(await result).toBeInstanceOf(Error);
    expect(__codexTestResumeMap().get("codex-live")?.threadId).toBe("thr_original");
    expect(events.some((event) => event.type === "session.providerBound")).toBe(false);
    expect(parse().some((m) => ["thread/fork", "thread/start", "turn/start"].includes(m.method as string))).toBe(false);
  });

  it.each(["error", "missing id", "same id"])("preserves the original binding and does not send on fork failure: %s", async (failure) => {
    const { result, events, fork } = await conflictAttempt();
    if (failure === "error") {
      onLine!(JSON.stringify({ id: fork.id, error: { code: -32000, message: "fork unavailable" } }));
    } else {
      reply(fork.id as number, { thread: { id: failure === "same id" ? "thr_original" : "" } });
    }
    expect(await result).toBeInstanceOf(Error);
    expect(__codexTestResumeMap().get("codex-live")?.threadId).toBe("thr_original");
    expect(events.some((event) => event.type === "session.providerBound")).toBe(false);
    expect(parse().some((m) => m.method === "thread/start" || m.method === "turn/start")).toBe(false);
  });

  it("overrides provider defaults when restoring a Full access session", async () => {
    bindCodexSession("codex-live", "thr_1", "/repo");
    const { turn } = await startTurn("codex-live", {
      runtimeMode: "full-access",
      resume: true,
    });
    expect(
      parse().find((m) => m.method === "thread/resume")?.params,
    ).toMatchObject({
      threadId: "thr_1",
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      developerInstructions: AVEN_BROWSER_HOST_POLICY,
    });
    expect(
      parse().find((m) => m.method === "turn/start")?.params,
    ).toMatchObject({
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
  });

  it("keeps the same item identity when its delta arrives before turn/start has replied", async () => {
    const { events, turn } = await startTurn("codex-live", {
      beforeTurnStartReply: () => {
        notify("item/agentMessage/delta", {
          itemId: "early",
          delta: "Early reply",
        });
      },
    });
    notify("item/completed", {
      item: { id: "early", type: "agentMessage", text: "Early reply" },
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
    const session = events.reduce(
      applyHarnessEvent,
      newSession("codex", "/tmp"),
    );
    expect(
      session.blocks
        .filter((block) => block.role === "assistant")
        .map((block) => block.text),
    ).toEqual(["Early reply"]);
  });

  it("keeps adjacent provider messages separate without replaying their completed snapshots", async () => {
    const { events, turn } = await startTurn("codex-live");
    for (const [id, text] of [
      ["a", "First."],
      ["b", "Second."],
    ]) {
      notify("item/agentMessage/delta", {
        threadId: "thr_1",
        turnId: "turn_1",
        itemId: id,
        delta: text,
      });
      notify("item/completed", {
        threadId: "thr_1",
        turnId: "turn_1",
        item: { id, type: "agentMessage", text },
      });
    }
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
    const session = events.reduce(
      applyHarnessEvent,
      newSession("codex", "/tmp"),
    );
    expect(
      session.blocks
        .filter((block) => block.role === "assistant")
        .map((block) => block.text),
    ).toEqual(["First.", "Second."]);
  });

  it("preserves repeated token deltas and routes late completion text to the correct item", async () => {
    const { events, turn } = await startTurn("codex-live");
    notify("item/agentMessage/delta", { itemId: "a", delta: "ha" });
    notify("item/agentMessage/delta", { itemId: "a", delta: "ha" });
    notify("item/started", {
      item: {
        id: "cmd",
        type: "commandExecution",
        command: "pwd",
        status: "inProgress",
      },
    });
    notify("item/agentMessage/delta", { itemId: "b", delta: "Next" });
    notify("item/completed", {
      item: { id: "a", type: "agentMessage", text: "haha!" },
    });
    notify("item/completed", {
      item: { id: "b", type: "agentMessage", text: "Next" },
    });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
    const session = events.reduce(
      applyHarnessEvent,
      newSession("codex", "/tmp"),
    );
    expect(
      session.blocks
        .filter((block) => block.role === "assistant")
        .map((block) => block.text),
    ).toEqual(["haha!", "Next"]);
    expect(
      session.blocks
        .filter((block) => block.role === "assistant")
        .every((block) => !block.streaming),
    ).toBe(true);
  });

  it("stays busy after an agent message until turn/completed", async () => {
    const { events, turn } = await startTurn("codex-live");
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    notify("item/completed", {
      item: {
        id: "msg_1",
        type: "agentMessage",
        text: "I'll inspect the changelog first.",
      },
    });

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(settled).toBe(false);
    vi.useRealTimers();

    notify("item/started", {
      item: {
        id: "cmd_1",
        type: "commandExecution",
        command: "git log -1",
        status: "inProgress",
      },
    });
    expect(settled).toBe(false);
    expect(events.some((event) => event.type === "tool.started")).toBe(true);

    notify("turn/completed", {
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
    expect(settled).toBe(true);
  });

  it("does not inherit a duplicate idle terminal or let an older turn finish a new request", async () => {
    const { turn } = await startTurn("codex-live");
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
    // Previously this idle duplicate populated turnEndPending and immediately
    // resolved the next turn's promise as soon as its start RPC returned.
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    sent.length = 0;
    const events: HarnessEvent[] = [];
    let settled = false;
    const next = sendCodexTurn({ sessionId: "codex-live", cwd: "/repo",
      model: "codex:gpt-5.4", runtimeMode: "supervised", text: "Redesign the page",
      onEvent: (event) => events.push(event) });
    void next.then(() => { settled = true; });
    await waitFor(() => parse().some((message) => message.method === "turn/start"), "next turn/start");
    // Even a previously unseen stale ID must not become the new turn's ID
    // when its start/terminal frames arrive before the authoritative response.
    notify("turn/started", { turn: { id: "old_unseen", status: "inProgress" } });
    notify("turn/completed", { turn: { id: "old_unseen", status: "completed" } });
    const request = parse().find((message) => message.method === "turn/start")!;
    reply(request.id as number, { turn: { id: "turn_2", status: "inProgress" } });
    notify("item/completed", { threadId: "thr_1", turnId: "turn_2", item: {
      id: "progress", type: "agentMessage", phase: "commentary", text: "I'll redesign the page now.",
    } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    notify("turn/completed", { turn: { id: "old_unseen", status: "completed" } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    notify("item/started", { threadId: "thr_1", turnId: "turn_2", item: {
      id: "edit", type: "commandExecution", command: "apply_patch", status: "inProgress",
    } });
    expect(events.some((event) => event.type === "tool.started")).toBe(true);
    notify("turn/completed", { turn: { id: "turn_2", status: "completed" } });
    await next;
    expect(settled).toBe(true);
  });

  it("matches a fast terminal to the start RPC response instead of an earlier mismatched terminal", async () => {
    const { events, turn } = await startTurn("codex-live", {
      terminalBeforeReply: true,
      beforeTurnStartReply: async () => {
        for (let index = 0; index < 20; index++) {
          notify("turn/completed", { turn: { id: `replayed_${index}`, status: "completed" } });
        }
        notify("turn/started", { turn: { id: "unrelated_old", status: "inProgress" } });
        notify("turn/completed", { turn: { id: "unrelated_old", status: "failed", error: { message: "Old failure" } } });
        notify("item/completed", { item: { id: "answer", type: "agentMessage", phase: "final_answer", text: "Done" } });
        notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
        await new Promise((resolve) => setTimeout(resolve, 10));
      },
    });
    await expect(turn).resolves.toBeUndefined();
    expect(events.some((event) => event.type === "session.error")).toBe(false);
  });

  it("interrupts the returned turn ID when Stop is pressed before turn/start responds", async () => {
    let cancelled!: Promise<void>;
    const { turn } = await startTurn("codex-live", {
      beforeTurnStartReply: async () => {
        notify("turn/started", { turn: { id: "old_unseen", status: "inProgress" } });
        cancelled = cancelCodexTurn("codex-live");
        await Promise.resolve();
        expect(parse().some((message) => message.method === "turn/interrupt")).toBe(false);
      },
    });
    await waitFor(() => parse().some((message) => message.method === "turn/interrupt"), "pending-turn interrupt");
    const interrupt = parse().find((message) => message.method === "turn/interrupt")!;
    expect(interrupt.params).toEqual({ threadId: "thr_1", turnId: "turn_1" });
    reply(interrupt.id as number, {});
    await cancelled;
    await turn;
  });

  it("keeps queued turn callbacks separate until that turn owns the provider", async () => {
    const { events, turn } = await startTurn("codex-live");
    const nextEvents: HarnessEvent[] = [];
    const next = sendCodexTurn({ sessionId: "codex-live", cwd: "/repo",
      model: "codex:gpt-5.4", runtimeMode: "supervised", text: "Next request",
      onEvent: (event) => nextEvents.push(event) });
    await Promise.resolve();
    notify("item/agentMessage/delta", { itemId: "first", delta: "First turn output" });
    expect(events).toContainEqual(expect.objectContaining({ type: "message.delta", text: "First turn output" }));
    expect(nextEvents).toEqual([]);
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
    await waitFor(() => parse().filter((message) => message.method === "turn/start").length === 2, "queued turn/start");
    const request = parse().filter((message) => message.method === "turn/start").at(-1)!;
    reply(request.id as number, { turn: { id: "turn_2", status: "inProgress" } });
    notify("turn/completed", { turn: { id: "turn_2", status: "completed" } });
    await next;
  });

  it.each([
    {
      method: "turn/completed",
      terminal: { status: "failed" },
      message: "Codex turn failed",
    },
    {
      method: "turn/completed",
      terminal: { status: "failed", error: { message: "Quota exceeded" } },
      message: "Quota exceeded",
    },
    {
      method: "turn/completed",
      terminal: { status: "interrupted" },
      message: "Codex turn was interrupted",
    },
    {
      method: "turn/completed",
      terminal: { status: "cancelled" },
      message: "Codex turn was cancelled",
    },
    {
      method: "turn/aborted",
      terminal: {},
      message: "Codex turn was interrupted",
    },
  ])(
    "rejects remote $method as $message instead of completing successfully",
    async ({ method, terminal, message }) => {
      const { events, turn } = await startTurn("codex-live");
      const rejected = expect(turn).rejects.toThrow(message);
      notify(method, { turn: { id: "turn_1", ...terminal } });
      await rejected;
      expect(events.filter((event) => event.type === "session.error")).toEqual([
        { type: "session.error", message },
      ]);
      expect(events).toContainEqual({ type: "message.completed" });
      expect(events).toContainEqual({ type: "reasoning.completed" });
    },
  );

  it("retains an early terminal failure until turn/start responds and permits a fresh turn", async () => {
    const { events, turn } = await startTurn("codex-live", {
      terminalBeforeReply: true,
      beforeTurnStartReply: async () => {
        notify("turn/completed", {
          turn: { id: "turn_1", status: "failed" },
        });
        // A complete event loop before the request reply exercises early
        // promise rejection handling, not only same-microtask ordering.
        await new Promise((resolve) => setTimeout(resolve, 15));
      },
    });
    await expect(turn).rejects.toThrow("Codex turn failed");
    expect(events.filter((event) => event.type === "session.error")).toEqual([
      { type: "session.error", message: "Codex turn failed" },
    ]);
    await expect(
      steerCodexTurn({
        sessionId: "codex-live",
        cwd: "/repo",
        model: "codex:gpt-5.4",
        text: "More instructions",
      }),
    ).rejects.toThrow("No active turn to steer");

    sent.length = 0;
    const nextEvents: HarnessEvent[] = [];
    const next = sendCodexTurn({
      sessionId: "codex-live",
      cwd: "/repo",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      text: "Try a fresh task",
      onEvent: (event) => nextEvents.push(event),
    });
    await waitFor(
      () => parse().some((message) => message.method === "turn/start"),
      "fresh turn",
    );
    const request = parse().find((message) => message.method === "turn/start")!;
    reply(request.id as number, { turn: { id: "turn_2", status: "inProgress" } });
    notify("turn/completed", { turn: { id: "turn_2", status: "completed" } });
    await expect(next).resolves.toBeUndefined();
    expect(nextEvents.some((event) => event.type === "session.error")).toBe(false);
  });

  it("keeps a locally requested Stop separate from a remote abort failure", async () => {
    const { events, turn } = await startTurn("codex-live");
    const cancelled = cancelCodexTurn("codex-live");
    await waitFor(
      () => parse().some((message) => message.method === "turn/interrupt"),
      "local interrupt",
    );
    notify("turn/aborted", { turn: { id: "turn_1" } });
    const interrupt = parse().find(
      (message) => message.method === "turn/interrupt",
    )!;
    reply(interrupt.id as number, {});
    await cancelled;
    await expect(turn).resolves.toBeUndefined();
    expect(events.some((event) => event.type === "session.error")).toBe(false);
  });

  it("keeps plan turns read-only without surfacing approval prompts", async () => {
    const { events, turn } = await startTurn("codex-live", {
      runtimeMode: "auto",
      intent: "plan",
    });
    const turnStart = parse().find(
      (message) => message.method === "turn/start",
    );
    expect(turnStart?.params).toMatchObject({
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly" },
      collaborationMode: { mode: "plan" },
    });

    onLine!(
      JSON.stringify({
        id: 91,
        method: "item/commandExecution/requestApproval",
        params: { itemId: "cmd_1", command: "git status --short" },
      }),
    );
    await waitFor(
      () => parse().some((message) => message.id === 91),
      "silent plan denial",
    );

    expect(events.some((event) => event.type === "approval.requested")).toBe(
      false,
    );
    expect(parse().find((message) => message.id === 91)?.result).toEqual({
      decision: "decline",
    });

    notify("turn/completed", {
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
  });

  it("uses thread/compact/start and waits for its turn to complete", async () => {
    const { turn } = await startTurn("codex-live");
    notify("turn/completed", {
      turn: { id: "turn_1", status: "completed" },
    });
    await turn;
    sent.length = 0;

    const compact = compactCodexContext({
      sessionId: "codex-live",
      cwd: "/repo",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });
    await waitFor(
      () =>
        parse().some((message) => message.method === "thread/compact/start"),
      "thread/compact/start",
    );
    const request = parse().find(
      (message) => message.method === "thread/compact/start",
    )!;
    expect(request.params).toEqual({ threadId: "thr_1" });
    reply(request.id as number, {});

    let settled = false;
    void compact.then(() => {
      settled = true;
    });
    notify("turn/started", {
      turn: { id: "compact_1", status: "inProgress" },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);

    notify("turn/completed", {
      turn: { id: "compact_1", status: "completed" },
    });
    await compact;
    expect(settled).toBe(true);
  });

  it("matches an early compaction terminal to its start event before the empty RPC response", async () => {
    const { turn } = await startTurn("codex-live");
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    await turn;
    sent.length = 0;
    let settled = false;
    const compact = compactCodexContext({ sessionId: "codex-live", cwd: "/repo",
      model: "codex:gpt-5.4", runtimeMode: "supervised", onEvent: () => {} });
    void compact.then(() => { settled = true; });
    await waitFor(() => parse().some((message) => message.method === "thread/compact/start"), "early compaction");
    notify("turn/started", { turn: { id: "turn_1", status: "inProgress" } });
    notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    notify("turn/completed", { turn: { id: "old_unseen", status: "completed" } });
    notify("turn/started", { turn: { id: "compact_early", status: "inProgress" } });
    notify("turn/completed", { turn: { id: "compact_early", status: "completed" } });
    expect(settled).toBe(false);
    const request = parse().find((message) => message.method === "thread/compact/start")!;
    reply(request.id as number, {});
    await compact;
    expect(settled).toBe(true);
  });
});
