import type { ActivityEntry } from "./activity";
import {
  isAgentTool,
  isEditTool,
  isExecuteTool,
  isReadTool,
  isSearchTool,
} from "./harness/preview";
import { hasPendingApproval, type Block, type Session } from "./session";

export type SessionRunStatus = {
  kind:
    | "working"
    | "waiting"
    | "finished"
    | "failed"
    | "stopped"
    | "queued"
    | "idle";
  label: string;
  detail: string;
  startedAt?: number;
  durationMs?: number;
  canStop: boolean;
  recovery?: "claude-login";
};

function validTime(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

/** Steering messages have no clock of their own and belong to the active turn. */
function currentTurn(
  blocks: Block[],
): { block: Block; index: number } | undefined {
  let latest: { block: Block; index: number } | undefined;
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role !== "user") continue;
    latest ??= { block, index };
    if (validTime(block.startedAt) || block.turnModel) {
      // An untimed new message must not reuse a finished historical turn.
      return latest.block !== block && validTime(block.durationMs)
        ? latest
        : { block, index };
    }
  }
  return latest;
}

function pendingTool(block: Block): boolean {
  if (block.role !== "tool" && block.role !== "approval") return false;
  if (block.approval?.decided === "deny") return false;
  const status = block.tool?.status?.toLowerCase();
  if (
    status &&
    [
      "completed",
      "success",
      "failed",
      "error",
      "cancelled",
      "canceled",
      "declined",
    ].includes(status)
  )
    return false;
  return (
    !!block.streaming ||
    status === "in_progress" ||
    status === "pending" ||
    status === "running"
  );
}

function workingDetail(blocks: Block[]): string {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role === "handoff" && block.handoff?.status === "preparing")
      return "Preparing handoff";
    if (block.role === "assistant" && block.streaming)
      return "Writing response";
    if (block.role === "reasoning" && block.streaming) return "Thinking";
    if (block.role === "plan" && block.streaming) return "Planning";
    if (!pendingTool(block)) continue;
    const { kind, title, preview } = block.tool ?? {};
    const name = title || block.text;
    if (isAgentTool(kind, name)) return "Subagents are working";
    if (isEditTool(kind, name, preview)) return "Editing file";
    if (isReadTool(kind, name, preview)) return "Reading file";
    if (isSearchTool(kind, name, preview)) return "Searching";
    if (isExecuteTool(kind, name) || preview?.kind === "shell")
      return "Running command";
    return "Using a tool";
  }
  return "Agent is working";
}

function latestOutcome(
  session: Session,
  turn: Block | undefined,
  entries: readonly ActivityEntry[],
): ActivityEntry | undefined {
  if (!turn) return undefined;
  const prefix = `${session.id}:turn:`;
  const oldUserIds = new Set(
    session.blocks
      .filter((block) => block.role === "user" && block.id !== turn.id)
      .map((block) => block.id),
  );
  let latest: ActivityEntry | undefined;
  for (const entry of entries) {
    if (
      entry.sessionId !== session.id ||
      !["completed", "failed", "stopped"].includes(entry.outcome) ||
      !validTime(entry.createdAt) ||
      !entry.id.startsWith(prefix) ||
      !entry.id.endsWith(`:${entry.outcome}`)
    )
      continue;
    const turnId = entry.id.slice(prefix.length, -entry.outcome.length - 1);
    if (!turnId || oldUserIds.has(turnId)) continue;
    // Normal turns use a runtime UUID, while compatibility callers use the
    // user block ID. Without a start time only the exact identity is reliable.
    if (validTime(turn.startedAt)) {
      if (entry.createdAt < turn.startedAt) continue;
    } else if (turnId !== turn.id) continue;
    if (!latest || entry.createdAt > latest.createdAt) latest = entry;
  }
  return latest;
}

/** Runtime state wins over transcript appearance and historical notifications. */
export function sessionRunStatus(
  session: Session,
  entries: readonly ActivityEntry[],
): SessionRunStatus | null {
  const turn = currentTurn(session.blocks);
  const startedAt = validTime(turn?.block.startedAt)
    ? turn.block.startedAt
    : undefined;
  const canStop = !!session.busy;
  if (session.pendingQuestion || hasPendingApproval(session.blocks)) {
    return {
      kind: "waiting",
      label: "Waiting for you",
      detail: session.pendingQuestion
        ? "Answer the question below"
        : "Approval needed",
      ...(startedAt !== undefined ? { startedAt } : {}),
      canStop,
    };
  }
  if (session.busy) {
    return {
      kind: "working",
      label: "Working",
      detail: workingDetail(session.blocks.slice(turn?.index ?? 0)),
      ...(startedAt !== undefined && !validTime(turn?.block.durationMs)
        ? { startedAt }
        : {}),
      canStop: true,
    };
  }
  const queued = session.queuedMessages?.length ?? 0;
  if (queued > 0) {
    const count = `${queued} ${queued === 1 ? "message" : "messages"}`;
    const editingHead =
      session.editingQueuedMessageId === session.queuedMessages?.[0].id;
    return {
      kind: "queued",
      label: session.queueStatus === "paused" ? "Queue paused" : "Queued",
      detail:
        session.queueStatus === "paused"
          ? `${count} waiting`
          : session.queueStatus === "resuming"
            ? "Waiting for the continued turn"
            : editingHead
              ? "Finish editing the queued message"
              : `${count} ready to send`,
      canStop: false,
    };
  }
  const outcome = latestOutcome(session, turn?.block, entries);
  if (outcome) {
    // Offer provider recovery only after an explicit failed runtime outcome.
    // Assistant prose and errors from older turns are not authentication state.
    const needsClaudeLogin =
      outcome.outcome === "failed" &&
      (turn?.block.turnModel?.harness ?? session.harness) === "claude" &&
      session.blocks.slice((turn?.index ?? -1) + 1).some((block) =>
        block.role === "system" &&
        /^(?:Failed to authenticate\b|Claude Code authentication failed\b|OAuth session expired\b|Not logged in\b.*\/login)/i.test(block.text.trim()),
      );
    const terminal = {
      completed: {
        kind: "finished",
        label: "Finished",
        detail: "Ready for your next message",
      },
      failed: {
        kind: "failed",
        label: "Failed",
        detail: "Check the error in the conversation",
      },
      stopped: {
        kind: "stopped",
        label: "Stopped",
        detail: "Ready for your next message",
      },
    } as const;
    const state = terminal[outcome.outcome as keyof typeof terminal];
    return {
      ...state,
      ...(needsClaudeLogin ? {
        label: "Sign in required",
        detail: "Reconnect Claude Code, then retry your message",
        recovery: "claude-login" as const,
      } : {}),
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(validTime(turn?.block.durationMs)
        ? { durationMs: turn.block.durationMs }
        : {}),
      canStop: false,
    };
  }
  return session.blocks.length
    ? {
        kind: "idle",
        label: "Not running",
        detail: "Ready for your next message",
        canStop: false,
      }
    : null;
}
