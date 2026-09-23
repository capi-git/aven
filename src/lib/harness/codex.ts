import { nativeModelId } from "../models";
import type { RuntimeMode } from "../session";
import {
  killChild,
  resolveCodexBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "./child";
import {
  asRecord,
  buildThreadStartParams,
  buildTurnStartParams,
  buildTurnSteerParams,
  codexAttachmentInputs,
  codexBrowserHostInstructionsFromConfig,
  isRecoverableThreadResumeError,
  isThreadWriterConflict,
  mapApprovalRequest,
  mapCodexNotification,
  toCodexApprovalDecision,
  type CodexApprovalKind,
} from "./codexProtocol";
import { JsonRpcClient, type JsonRpcId } from "./jsonRpc";
import { joinStreamText, snapshotRemainder } from "./streamText";
import type {
  ApprovalDecision,
  CompactContextInput,
  HarnessEvent,
  HarnessSessionInput,
  SendTurnInput,
  SteerTurnInput,
} from "./types";

type PendingApproval = {
  rpcId: JsonRpcId;
  kind: CodexApprovalKind;
  resolve: (decision: ApprovalDecision) => void;
};

/** Terminal notifications report their error before rejecting the active turn. */
class CodexTerminalError extends Error {}

type AgentUpdate = Extract<HarnessEvent, { type: "agent.updated" }>;

type Live = {
  rpc: JsonRpcClient;
  threadId: string;
  cwd: string;
  runtimeMode: RuntimeMode;
  planning: boolean;
  onEvent: (event: HarnessEvent) => void;
  approvals: Map<number, PendingApproval>;
  nextApprovalUiId: number;
  cancelled: boolean;
  muteUpdates: boolean;
  activeTurnId: string | null;
  turns: Promise<void>;
  /** Resolves when the current turn completes (or is cancelled). */
  turnDone: (() => void) | null;
  turnFailed: ((error: Error) => void) | null;
  /** A terminal notification arrived before runTurn registered its callbacks. */
  turnEndPending: { error?: Error } | null;
  emittedAssistant: string;
  assistantItems: Map<string, string>;
  /** Stable before the asynchronous turn/start response or notification arrives. */
  assistantTurnKey: string;
  emittedReasoning: string;
  agents: Map<string, AgentUpdate>;
  retired: boolean;
};

type Resume = {
  threadId: string;
  cwd: string;
};

const liveByThread = new Map<string, Live>();
const stoppingByThread = new Map<string, Promise<void>>();
const resumeByThread = new Map<string, Resume>();
const cancelledThreads = new Set<string>();

let resolveCodexBinaryImpl: () => Promise<{ path: string }> =
  resolveCodexBinary;

/** Test seam. */
export function setCodexBinaryResolver(
  fn: () => Promise<{ path: string }>,
): void {
  resolveCodexBinaryImpl = fn;
}

export async function sendCodexTurn(input: SendTurnInput): Promise<void> {
  let live: Live;
  try {
    live = await ensureLive(input);
  } catch (error) {
    cancelledThreads.delete(input.sessionId);
    throw error;
  }
  if (cancelledThreads.delete(input.sessionId)) return;

  live.onEvent = input.onEvent;
  live.runtimeMode = input.runtimeMode;
  live.planning = input.intent === "plan";
  live.turns = live.turns
    .catch(() => undefined)
    .then(async () => {
      live.cancelled = false;
      live.muteUpdates = false;
      try {
        await runTurn(live, input);
      } catch (error) {
        if (live.cancelled) return;
        throw error;
      }
    });
  await live.turns;
}

export async function compactCodexContext(
  input: CompactContextInput,
): Promise<void> {
  let live: Live;
  try {
    live = await ensureLive(input);
  } catch (error) {
    cancelledThreads.delete(input.sessionId);
    throw error;
  }
  if (cancelledThreads.delete(input.sessionId)) return;

  live.onEvent = input.onEvent;
  live.turns = live.turns
    .catch(() => undefined)
    .then(async () => {
      live.cancelled = false;
      live.muteUpdates = false;
      try {
        await runCompaction(live);
      } catch (error) {
        if (live.cancelled) return;
        throw error;
      }
    });
  await live.turns;
}

export async function steerCodexTurn(input: SteerTurnInput): Promise<void> {
  const live = liveByThread.get(input.sessionId);
  if (!live) throw new Error("No active Codex session");
  const turnId = live.activeTurnId;
  if (!turnId) throw new Error("No active turn to steer");

  const attachments = codexAttachmentInputs(input.attachments ?? []);
  const params = buildTurnSteerParams({
    threadId: live.threadId,
    expectedTurnId: turnId,
    prompt: input.text.trim() || undefined,
    attachments,
  });
  if (
    !params.input ||
    (Array.isArray(params.input) && params.input.length === 0)
  ) {
    return;
  }

  await live.rpc.request("turn/steer", params);
}

export function respondCodexApproval(
  sessionId: string,
  requestId: number,
  decision: ApprovalDecision,
): void {
  const live = liveByThread.get(sessionId);
  const pending = live?.approvals.get(requestId);
  if (!pending) return;
  pending.resolve(decision);
}

export async function cancelCodexTurn(sessionId: string): Promise<void> {
  const live = liveByThread.get(sessionId);
  if (!live) {
    cancelledThreads.add(sessionId);
    return;
  }
  live.cancelled = true;
  live.muteUpdates = true;
  for (const [, pending] of live.approvals) {
    pending.resolve("deny");
  }
  live.approvals.clear();
  const turnId = live.activeTurnId;
  if (turnId) {
    await live.rpc
      .request("turn/interrupt", {
        threadId: live.threadId,
        turnId,
      })
      .catch(() => undefined);
  }
  finishActiveTurn(live, [
    { type: "message.completed" },
    { type: "reasoning.completed" },
  ]);
}

export async function stopCodexSession(sessionId: string): Promise<void> {
  const pendingStop = stoppingByThread.get(sessionId);
  if (pendingStop) return pendingStop;
  cancelledThreads.delete(sessionId);
  const live = liveByThread.get(sessionId);
  liveByThread.delete(sessionId);
  if (live) {
    live.retired = true;
    live.muteUpdates = true;
    live.turnDone?.();
    live.turnDone = null;
    live.turnFailed = null;
    live.rpc.close();
  }
  unwatchChild(sessionId);
  const stopping = killChild(sessionId).then(
    () => {
      live?.agents.clear();
      live?.onEvent({ type: "agents.cleared" });
    },
    (error: unknown) => {
      if (live) {
        markAgentStatusesUnknown(live);
        // Preserve a non-reusable record so another send retries shutdown
        // instead of spawning over a process that may still be running.
        liveByThread.set(sessionId, live);
      }
      throw error;
    },
  );
  stoppingByThread.set(sessionId, stopping);
  try {
    await stopping;
  } finally {
    if (stoppingByThread.get(sessionId) === stopping) stoppingByThread.delete(sessionId);
  }
}

export async function forgetCodexSession(sessionId: string): Promise<void> {
  resumeByThread.delete(sessionId);
  await stopCodexSession(sessionId);
}

export function bindCodexSession(
  threadId: string,
  providerSessionId: string,
  cwd: string,
): void {
  const providerThreadId = providerSessionId.trim();
  if (!threadId || !providerThreadId || !cwd.trim()) return;
  resumeByThread.set(threadId, { threadId: providerThreadId, cwd });
}

async function ensureLive(input: HarnessSessionInput): Promise<Live> {
  // Native stop addresses the session ID. Never let it race a replacement
  // process spawned under the same ID.
  await stoppingByThread.get(input.sessionId);
  const existing = liveByThread.get(input.sessionId);
  if (existing && !existing.retired && existing.cwd === input.cwd) {
    existing.onEvent = input.onEvent;
    existing.runtimeMode = input.runtimeMode;
    return existing;
  }
  if (existing) {
    if (existing.cwd !== input.cwd) resumeByThread.delete(input.sessionId);
    await stopCodexSession(input.sessionId);
  }

  const resume = resumeByThread.get(input.sessionId);
  const canResume = resume != null && resume.cwd === input.cwd;
  if (resume && resume.cwd !== input.cwd) {
    resumeByThread.delete(input.sessionId);
  }

  const { path } = await resolveCodexBinaryImpl();
  const liveRef: { current: Live | null } = { current: null };

  const rpc = new JsonRpcClient(
    input.sessionId,
    {
      onNotification: (method, params) => {
        const live = liveRef.current;
        if (!live || liveByThread.get(input.sessionId) !== live ||
          (live.muteUpdates && !live.cancelled)) return;
        handleNotification(live, method, params);
      },
      onRequest: (id, method, params) => {
        const live = liveRef.current;
        if (!live || liveByThread.get(input.sessionId) !== live) return;
        void handleServerRequest(live, id, method, params);
      },
    },
    { includeJsonrpc: false, label: "codex" },
  );

  watchChild(
    input.sessionId,
    (line) => rpc.pushLine(line),
    (code) => {
      rpc.close(new Error("Codex app-server exited"));
      const live = liveRef.current;
      if (live && liveByThread.get(input.sessionId) !== live) return;
      liveByThread.delete(input.sessionId);
      if (live) markAgentStatusesUnknown(live);
      (live?.onEvent ?? input.onEvent)({ type: "session.ended", code });
      live?.turnFailed?.(new Error("Codex app-server exited"));
      if (live) {
        live.turnDone = null;
        live.turnFailed = null;
      }
    },
  );

  await spawnChild(input.sessionId, path, ["app-server"], input.cwd);

  try {
    await rpc.request("initialize", {
      clientInfo: {
        name: "monocode",
        title: "Aven",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    await rpc.notify("initialized", undefined);

    let browserHostInstructions: string | undefined;
    try {
      // Only read effective configuration. Never replace unknown user developer
      // instructions, persist changes, or log potentially sensitive config.
      browserHostInstructions = codexBrowserHostInstructionsFromConfig(
        await rpc.request(
          "config/read",
          { cwd: input.cwd, includeLayers: false },
          3000,
        ),
      );
    } catch {
      // Older providers can lack this API. Per-turn browser guidance remains,
      // while leaving developerInstructions unset preserves provider config.
    }

    const model = nativeModelId(input.model);
    const serviceTier = input.modelSettings?.serviceTier;
    const effort = input.modelSettings?.reasoningEffort;

    let threadId: string | undefined;
    let didResume = false;
    let didFork = false;

    if (canResume && resume) {
      try {
        const opened = await rpc.request<{ thread?: { id?: string } }>(
          "thread/resume",
          {
            threadId: resume.threadId,
            ...buildThreadStartParams({
              cwd: input.cwd,
              browserHostInstructions,
              runtimeMode: input.runtimeMode,
              controlsAgents: input.controlsAgents,
              model,
              serviceTier,
            }),
          },
        );
        threadId = opened.thread?.id ?? resume.threadId;
        didResume = true;
      } catch (error) {
        if (isThreadWriterConflict(error)) {
          // Imported conversations may still be loaded by another Codex app.
          // Preserve its writer and history; continue on our own provider thread.
          const forked = await rpc.request<{ thread?: { id?: string } }>(
            "thread/fork",
            {
              threadId: resume.threadId,
              ...buildThreadStartParams({
                cwd: input.cwd,
                browserHostInstructions,
                runtimeMode: input.runtimeMode,
                controlsAgents: input.controlsAgents,
                model,
                serviceTier,
              }),
              // Omit history only from the response, never from the new thread.
              excludeTurns: true,
              deferGoalContinuation: true,
            },
          );
          threadId = forked.thread?.id?.trim();
          if (!threadId || threadId === resume.threadId) {
            throw new Error(
              "Codex could not create a separate conversation. Your existing history is unchanged; please retry.",
            );
          }
          didResume = true;
          didFork = true;
        } else {
          if (!isRecoverableThreadResumeError(error)) throw error;
          threadId = undefined;
        }
      }
    }

    if (!threadId) {
      const opened = await rpc.request<{ thread?: { id?: string } }>(
        "thread/start",
        buildThreadStartParams({
          cwd: input.cwd,
          browserHostInstructions,
          runtimeMode: input.runtimeMode,
          controlsAgents: input.controlsAgents,
          model,
          serviceTier,
        }),
      );
      threadId = opened.thread?.id?.trim();
    }

    if (!threadId) throw new Error("Codex did not return a thread id");

    // Suppress unused warning for effort until first turn applies it.
    void effort;

    const live: Live = {
      rpc,
      threadId,
      cwd: input.cwd,
      runtimeMode: input.runtimeMode,
      planning: input.intent === "plan",
      onEvent: input.onEvent,
      approvals: new Map(),
      nextApprovalUiId: 1,
      cancelled: false,
      muteUpdates: didResume,
      activeTurnId: null,
      turns: Promise.resolve(),
      turnDone: null,
      turnFailed: null,
      turnEndPending: null,
      emittedAssistant: "",
      assistantItems: new Map(),
      assistantTurnKey: crypto.randomUUID(),
      emittedReasoning: "",
      agents: new Map(),
      retired: false,
    };
    liveRef.current = live;
    liveByThread.set(input.sessionId, live);
    resumeByThread.set(input.sessionId, {
      threadId,
      cwd: input.cwd,
    });
    live.onEvent({
      type: "session.providerBound",
      providerSessionId: threadId,
    });
    live.onEvent({ type: "agents.cleared" });
    live.onEvent({ type: "session.started" });
    if (didFork) {
      live.onEvent({
        type: "status",
        text: "Continued from a copy of the conversation because it is open in another Codex connection. Its saved history is included; the original stays unchanged.",
      });
    }
    return live;
  } catch (error) {
    rpc.close(error instanceof Error ? error : new Error(String(error)));
    await stopCodexSession(input.sessionId);
    throw error;
  }
}

async function runTurn(live: Live, input: SendTurnInput): Promise<void> {
  const model = nativeModelId(input.model);
  const effort = input.modelSettings?.reasoningEffort;
  const serviceTier = input.modelSettings?.serviceTier;
  const attachments = codexAttachmentInputs(input.attachments ?? []);

  const params = buildTurnStartParams({
    threadId: live.threadId,
    runtimeMode: input.runtimeMode,
    controlsAgents: input.controlsAgents,
    prompt: input.text.trim() || undefined,
    attachments,
    model,
    effort,
    serviceTier,
    intent: input.intent,
  });

  if (
    (!params.input ||
      (Array.isArray(params.input) && params.input.length === 0)) &&
    !input.text.trim() &&
    attachments.length === 0
  ) {
    return;
  }

  live.emittedAssistant = "";
  live.assistantItems.clear();
  live.assistantTurnKey = crypto.randomUUID();
  live.emittedReasoning = "";

  const turnPromise = new Promise<void>((resolve, reject) => {
    live.turnDone = resolve;
    live.turnFailed = reject;
  });
  // A terminal notification can reject before the turn/start RPC replies.
  // Keep that rejection observed until the request has finished below.
  void turnPromise.catch(() => undefined);
  settlePendingTurn(live);

  try {
    const response = await live.rpc.request<{ turn?: { id?: string } }>(
      "turn/start",
      params,
    );
    const turnId = response.turn?.id;
    if (turnId && live.turnDone) {
      live.activeTurnId = live.activeTurnId ?? turnId;
    }
    settlePendingTurn(live);
    await turnPromise;
  } catch (error) {
    if (live.cancelled) return;
    if (!(error instanceof CodexTerminalError)) {
      live.onEvent({
        type: "session.error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  } finally {
    live.turnDone = null;
    live.turnFailed = null;
  }
}

async function runCompaction(live: Live): Promise<void> {
  live.emittedAssistant = "";
  live.assistantItems.clear();
  live.assistantTurnKey = crypto.randomUUID();
  live.emittedReasoning = "";
  const turnPromise = new Promise<void>((resolve, reject) => {
    live.turnDone = resolve;
    live.turnFailed = reject;
  });
  void turnPromise.catch(() => undefined);
  settlePendingTurn(live);

  try {
    await live.rpc.request("thread/compact/start", {
      threadId: live.threadId,
    });
    settlePendingTurn(live);
    await turnPromise;
  } finally {
    live.turnDone = null;
    live.turnFailed = null;
  }
}

function handleNotification(live: Live, method: string, params: unknown): void {
  // A Codex turn is a sequence of items. Completing an agentMessage does not
  // mean the turn is over — more tools and messages can still arrive. Only
  // turn/completed (and turn/aborted) settle sendCodexTurn, which is what the
  // UI uses for busy / stop / "Working for".
  const record = asRecord(params);
  const threadId = typeof record?.threadId === "string" ? record.threadId : undefined;
  if (threadId && threadId !== live.threadId) {
    // Child notifications must never settle the lead's turn or append the
    // child's transcript to the lead. Only known child lifecycle is relevant.
    const child = live.agents.get(threadId);
    if (child) {
      const status = childThreadStatus(method, record, child.status);
      if (status) publishAgentUpdate(live, { ...child, status });
    }
    return;
  }
  const mapped = mapCodexNotification(method, params);
  const snapshot = method === "item/completed";
  const item = asRecord(record?.item);
  const itemId =
    typeof record?.itemId === "string"
      ? record.itemId
      : item?.type === "agentMessage" && typeof item.id === "string"
        ? item.id
        : undefined;
  const itemKey = itemId ? `${live.assistantTurnKey}:${itemId}` : undefined;
  for (const event of mapped.events) {
    if (event.type === "agent.updated") {
      publishAgentUpdate(live, event);
      continue;
    }
    if (live.muteUpdates) continue;
    if (event.type === "message.delta") {
      publishCodexText(live, "assistant", event.text, snapshot, itemKey);
      continue;
    }
    if (event.type === "reasoning.delta") {
      publishCodexText(live, "reasoning", event.text, snapshot);
      continue;
    }
    live.onEvent(
      event.type === "message.completed" && itemKey
        ? { ...event, key: itemKey }
        : event,
    );
  }
  if (live.muteUpdates) return;
  if (mapped.activeTurnId !== undefined) {
    live.activeTurnId = mapped.activeTurnId;
  }
  if (mapped.turnCompleted) {
    const { status, error } = mapped.turnCompleted;
    const terminalError =
      status === "completed"
        ? undefined
        : new CodexTerminalError(
            error?.trim() ||
              (status === "failed"
                ? "Codex turn failed"
                : `Codex turn was ${status}`),
          );
    if (
      terminalError &&
      !mapped.events.some((event) => event.type === "session.error")
    ) {
      live.onEvent({ type: "session.error", message: terminalError.message });
    }
    finishActiveTurn(live, [], terminalError);
  }
}

function publishAgentUpdate(live: Live, event: AgentUpdate): void {
  const previous = live.agents.get(event.agentId);
  const next = event.title === "Subagent" && previous
    ? { ...event, title: previous.title } : event;
  live.agents.set(event.agentId, next);
  live.onEvent(next);
}

function markAgentStatusesUnknown(live: Live): void {
  for (const agent of live.agents.values()) {
    if (agent.status !== "running" && agent.status !== "waiting") continue;
    publishAgentUpdate(live, {
      ...agent,
      status: "unknown",
      detail: "The provider disconnected before confirming the agent finished.",
    });
  }
}

function childThreadStatus(
  method: string,
  record: Record<string, unknown> | null,
  previous: AgentUpdate["status"],
): AgentUpdate["status"] | undefined {
  if (method === "turn/started") return "running";
  const terminal = previous === "completed" || previous === "failed" || previous === "stopped";
  if (method === "thread/closed" || method === "thread/deleted") return terminal ? undefined : "stopped";
  if (method === "turn/completed" || method === "turn/aborted") {
    const status = asRecord(record?.turn)?.status;
    if (status === "failed") return "failed";
    if (status === "interrupted" || status === "cancelled" || method === "turn/aborted") return "stopped";
    if (status === "completed") return "completed";
  }
  if (method === "thread/status/changed") {
    const status = asRecord(record?.status);
    if (status?.type === "active") {
      const flags = Array.isArray(status.activeFlags) ? status.activeFlags : [];
      return flags.includes("waitingOnApproval") || flags.includes("waitingOnUserInput")
        ? "waiting" : "running";
    }
    if (status?.type === "idle") return terminal ? undefined : "completed";
    if (status?.type === "systemError") return "failed";
    if (status?.type === "notLoaded") return terminal ? undefined : "unknown";
  }
  return undefined;
}

function publishCodexText(
  live: Live,
  role: "assistant" | "reasoning",
  text: string,
  snapshot: boolean,
  itemKey?: string,
): void {
  if (role === "assistant" && itemKey) {
    const already = live.assistantItems.get(itemKey) ?? "";
    const emit = snapshot ? snapshotRemainder(already, text) : text;
    if (!emit) return;
    live.assistantItems.set(itemKey, already + emit);
    live.onEvent({ type: "message.delta", text: emit, key: itemKey });
    return;
  }
  const already =
    role === "assistant" ? live.emittedAssistant : live.emittedReasoning;
  const emit = snapshot ? snapshotRemainder(already, text) : text;
  if (!emit) return;
  if (role === "assistant") {
    live.emittedAssistant = joinStreamText(already, emit);
    live.onEvent({ type: "message.delta", text: emit });
    return;
  }
  live.emittedReasoning = joinStreamText(already, emit);
  live.onEvent({ type: "reasoning.delta", text: emit });
}

function finishActiveTurn(
  live: Live,
  extraEvents: HarnessEvent[] = [],
  error?: Error,
): void {
  live.turnEndPending = null;
  live.activeTurnId = null;
  live.emittedAssistant = "";
  live.assistantItems.clear();
  live.emittedReasoning = "";
  for (const event of extraEvents) {
    live.onEvent(event);
  }
  const done = live.turnDone;
  const failed = live.turnFailed;
  live.turnDone = null;
  live.turnFailed = null;
  if (error && failed) {
    failed(error);
    return;
  }
  if (!error && done) {
    done();
    return;
  }
  if (!done && !failed) {
    live.turnEndPending = { error };
  }
}

function settlePendingTurn(live: Live): void {
  if (!live.turnEndPending || !live.turnDone) return;
  finishActiveTurn(live, [], live.turnEndPending.error);
}

async function handleServerRequest(
  live: Live,
  id: JsonRpcId,
  method: string,
  params: unknown,
): Promise<void> {
  if (method === "item/tool/requestUserInput") {
    await live.rpc.respond(id, { answers: {} }).catch(() => undefined);
    return;
  }

  const uiId = live.nextApprovalUiId++;
  const mapped = mapApprovalRequest(method, params, uiId);
  if (!mapped) {
    // Unknown server request — decline/cancel safely when possible.
    if (method.includes("requestApproval") || method.includes("Approval")) {
      await live.rpc
        .respond(id, { decision: "decline" })
        .catch(() => undefined);
      return;
    }
    if (method === "item/permissions/requestApproval") {
      await live.rpc.respond(id, { permissions: {} }).catch(() => undefined);
      return;
    }
    await live.rpc.respond(id, {}).catch(() => undefined);
    return;
  }

  if (live.planning) {
    // Plan turns run in a non-escalating read-only sandbox. If an older
    // app-server still asks for broader access, deny it silently instead of
    // leaking a Supervised approval prompt into the user's selected mode.
    if (method === "item/permissions/requestApproval") {
      await live.rpc.respond(id, { permissions: {} }).catch(() => undefined);
    } else {
      await live.rpc
        .respond(id, {
          decision: toCodexApprovalDecision("deny", mapped.kind),
        })
        .catch(() => undefined);
    }
    return;
  }

  if (method === "item/permissions/requestApproval") {
    // Auto-deny extra permission grants in supervised; allow in full-access.
    if (live.runtimeMode === "full-access") {
      const rec = asRecord(params);
      const permissions = rec?.permissions ?? {};
      await live.rpc.respond(id, {
        scope: "session",
        permissions,
      });
      return;
    }
    if (live.runtimeMode === "supervised") {
      live.onEvent(mapped.event);
      const decision = await waitApproval(live, uiId, id, mapped.kind);
      live.onEvent({
        type: "approval.resolved",
        requestId: uiId,
        decision,
      });
      if (decision === "allow") {
        const rec = asRecord(params);
        await live.rpc.respond(id, {
          scope: "turn",
          permissions: rec?.permissions ?? {},
        });
      } else {
        await live.rpc.respond(id, { permissions: {} });
      }
      return;
    }
    // auto / auto-accept: grant requested permissions for the turn.
    const rec = asRecord(params);
    await live.rpc.respond(id, {
      scope: "turn",
      permissions: rec?.permissions ?? {},
    });
    return;
  }

  const auto = autoApproval(live.runtimeMode, mapped.kind);
  if (auto) {
    await live.rpc.respond(id, {
      decision: toCodexApprovalDecision(auto, mapped.kind),
    });
    return;
  }

  live.onEvent(mapped.event);
  const decision = await waitApproval(live, uiId, id, mapped.kind);
  live.onEvent({
    type: "approval.resolved",
    requestId: uiId,
    decision,
  });
  await live.rpc.respond(id, {
    decision: toCodexApprovalDecision(decision, mapped.kind),
  });
}

function waitApproval(
  live: Live,
  uiId: number,
  rpcId: JsonRpcId,
  kind: CodexApprovalKind,
): Promise<ApprovalDecision> {
  return new Promise<ApprovalDecision>((resolve) => {
    live.approvals.set(uiId, { rpcId, kind, resolve });
  }).finally(() => {
    live.approvals.delete(uiId);
  });
}

function autoApproval(
  runtimeMode: RuntimeMode,
  kind: CodexApprovalKind,
): ApprovalDecision | null {
  if (runtimeMode === "supervised") return null;
  if (runtimeMode === "full-access") return "allow";
  if (runtimeMode === "auto") {
    // auto_review is set on the server; still prompt if Codex asks.
    return null;
  }
  // auto-accept-edits: auto file changes, ask for commands.
  if (kind === "file-change") return "allow";
  return null;
}

/** Exported for tests. */
export function __codexTestReset(): void {
  liveByThread.clear();
  stoppingByThread.clear();
  resumeByThread.clear();
  cancelledThreads.clear();
}

export function __codexTestResumeMap(): Map<string, Resume> {
  return resumeByThread;
}
