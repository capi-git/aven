import type { ActivityEntry } from "./activity";
import {
  isAgentTool,
  isEditTool,
  isExecuteTool,
  isReadTool,
  isSearchTool,
} from "./harness/preview";
import { sessionIsWaitingForInput, type Block, type Session } from "./session";
import { sessionDoing } from "./sessionDoing";
import { holdUpAt, sessionHoldUps, type SessionHoldUp } from "./sessionHoldUp";
import { isBlockingQuestion } from "./userQuestion";
import {
  activeSessionAgents,
  uncertainSessionAgents,
  sessionAgentSummary,
} from "./sessionAgents";

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
  /** While working: what the turn does now, without the agent count. */
  doing?: string;
  /** While working: what holds it up instead (see `sessionHoldUps`). */
  holdUp?: SessionHoldUp["kind"];
  /** When these words next change on their own (a countdown, a threshold). */
  wakeAt?: number;
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

/** A pending tool with no name of its own, by what kind of tool it is. */
function toolPhase(block: Block): string {
  const { kind, title, preview } = block.tool ?? {};
  const name = title || block.text;
  if (isEditTool(kind, name, preview)) return "Editing file";
  if (isReadTool(kind, name, preview)) return "Reading file";
  if (isSearchTool(kind, name, preview)) return "Searching";
  if (isExecuteTool(kind, name) || preview?.kind === "shell")
    return "Running command";
  return "Using a tool";
}

/**
 * What the current turn (`blocks`, from its first message) is doing, in the
 * words Home and the team panel use (`sessionDoing`): "Edit app.js", "npm
 * test", "Writing a reply". Subagents and a plan being written say so; a
 * tool with no name says what kind it is; nothing yet says nothing.
 */
function workingDetail(session: Session, blocks: Block[]): string | undefined {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role === "plan" && block.streaming) return "Planning";
    if (block.role === "user") continue;
    if (
      pendingTool(block) &&
      isAgentTool(block.tool?.kind, block.tool?.title || block.text)
    )
      return "Subagents are working";
    break;
  }
  // Steering messages belong to the turn; what it does continues past them.
  const doing = sessionDoing({
    ...session,
    blocks: blocks.filter((block) => block.role !== "user"),
  });
  if (doing) return doing;
  const latest = blocks.findLast((block) => block.role !== "user");
  return latest && pendingTool(latest) ? toolPhase(latest) : undefined;
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

/**
 * Runtime state wins over transcript appearance and historical notifications.
 * While working, a hold-up (a retry, the usage limit, a slow start, a long
 * command, helper agents) names itself at `now` in place of the work.
 */
export function sessionRunStatus(
  session: Session,
  entries: readonly ActivityEntry[],
  now = Date.now(),
): SessionRunStatus | null {
  const turn = currentTurn(session.blocks);
  const startedAt = validTime(turn?.block.startedAt)
    ? turn.block.startedAt
    : undefined;
  const agents = activeSessionAgents(session);
  const unknownAgents = uncertainSessionAgents(session);
  const canStop =
    !!session.busy || agents.length > 0 || unknownAgents.length > 0;
  if (sessionIsWaitingForInput(session)) {
    return {
      kind: "waiting",
      label: "Needs you",
      detail: isBlockingQuestion(session.pendingQuestion)
        ? "Answer the question below"
        : "Approval needed",
      ...(startedAt !== undefined ? { startedAt } : {}),
      canStop,
    };
  }
  const { words: holdUp, wakeAt } = holdUpAt(sessionHoldUps(session), now);
  if (session.busy) {
    const doing = workingDetail(
      session,
      session.blocks.slice(turn?.index ?? 0),
    );
    const active = agents.length
      ? `${agents.length} ${agents.length === 1 ? "agent" : "agents"} active`
      : "";
    return {
      kind: "working",
      ...(holdUp
        ? {
            label: holdUp.label,
            detail: holdUp.detail,
            doing: holdUp.kind === "command" && doing ? doing : holdUp.label,
            holdUp: holdUp.kind,
          }
        : {
            // Plain "Working…" until the turn does something it can name.
            label: doing || active ? "Working" : "Working…",
            detail: [active, doing].filter(Boolean).join(" · "),
            ...(doing ? { doing } : {}),
          }),
      ...(wakeAt !== undefined ? { wakeAt } : {}),
      ...(startedAt !== undefined && !validTime(turn?.block.durationMs)
        ? { startedAt }
        : {}),
      canStop: true,
    };
  }
  if (agents.length) {
    return {
      kind: holdUp ? "working" : "waiting",
      label: holdUp?.label ?? "Agents waiting",
      detail: sessionAgentSummary(session.liveAgents ?? []),
      ...(holdUp ? { holdUp: holdUp.kind } : {}),
      canStop: true,
    };
  }
  if (unknownAgents.length) {
    return {
      kind: "waiting",
      label: "Agent status unavailable",
      detail: "Open agent details for the last reported state",
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
      session.blocks
        .slice((turn?.index ?? -1) + 1)
        .some(
          (block) =>
            block.role === "system" &&
            /^(?:Failed to authenticate\b|Claude Code authentication failed\b|OAuth session expired\b|Not logged in\b.*\/login)/i.test(
              block.text.trim(),
            ),
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
        detail: "Check the error in the chat",
      },
      stopped: {
        kind: "stopped",
        label: "Stopped",
        detail: "Ready for your next message",
      },
    } as const;
    const state = terminal[outcome.outcome as keyof typeof terminal];
    const failedAgents =
      session.liveAgents?.filter((agent) => agent.status === "failed").length ??
      0;
    const stoppedAgents =
      session.liveAgents?.filter((agent) => agent.status === "stopped")
        .length ?? 0;
    return {
      ...state,
      ...(outcome.outcome === "completed" && failedAgents
        ? {
            kind: "failed" as const,
            label: "Agent failed",
            detail: `${failedAgents} ${failedAgents === 1 ? "agent" : "agents"} failed · Open agent details`,
          }
        : outcome.outcome === "completed" && stoppedAgents
          ? {
              kind: "stopped" as const,
              label: "Agents stopped",
              detail: `${stoppedAgents} ${stoppedAgents === 1 ? "agent" : "agents"} stopped · Open agent details`,
            }
          : {}),
      ...(needsClaudeLogin
        ? {
            label: "Sign in required",
            detail: "Reconnect Claude Code, then retry your message",
            recovery: "claude-login" as const,
          }
        : {}),
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

/**
 * Whether the status needs a row of its own even where the chat's team bar
 * shows its work: a failure, signing in again, or messages waiting to send.
 */
export function runStatusNeedsOwnRow(status: SessionRunStatus): boolean {
  return (
    status.kind === "failed" || status.kind === "queued" || !!status.recovery
  );
}
