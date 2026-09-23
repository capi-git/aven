import { composeToolTitle } from "./harness/preview";
import { isInFlightSession } from "./inFlight";
import { displayPath } from "./paths";
import { activeSessionAgents, uncertainSessionAgents } from "./sessionAgents";
import {
  sessionDisplayTitle,
  type Block,
  type HarnessId,
  type Session,
  type SessionAgent,
} from "./session";

export type LiveAgent = {
  id: string;
  cwd: string;
  title: string;
  harness: HarnessId;
  activity: string;
  startedAt?: number;
  durationMs?: number;
  needsApproval: boolean;
  done: boolean;
  statusUnknown?: boolean;
};

/** Managed turns can finish before their provider-native children do. */
export function backgroundWorkerIdsForStop(
  sessions: readonly Session[],
  leadId: string,
  handledWorkerIds: ReadonlySet<string> = new Set(),
): string[] {
  return sessions
    .filter(
      (session) =>
        session.orchestrationLeadId === leadId &&
        !handledWorkerIds.has(session.id) &&
        (activeSessionAgents(session).length > 0 ||
          uncertainSessionAgents(session).length > 0),
    )
    .map((session) => session.id);
}

/** Keep the context stable while worker transcripts stream unrelated deltas. */
export function workerAgentsByLead(
  sessions: readonly Session[],
  previous: ReadonlyMap<string, readonly SessionAgent[]> = new Map(),
): ReadonlyMap<string, readonly SessionAgent[]> {
  const next = new Map<string, SessionAgent[]>();
  for (const session of sessions) {
    if (!session.orchestrationLeadId || !session.liveAgents?.length) continue;
    const rows = next.get(session.orchestrationLeadId) ?? [];
    rows.push(
      ...session.liveAgents.map((agent) => ({
        ...agent,
        id: `${session.id}:${agent.id}`,
        title: `${sessionDisplayTitle(session.title, session.harness)} · ${agent.title}`,
      })),
    );
    next.set(session.orchestrationLeadId, rows);
  }
  if (
    next.size === previous.size &&
    [...next].every(([leadId, agents]) => {
      const old = previous.get(leadId);
      return (
        old?.length === agents.length &&
        agents.every((agent, index) => {
          const prior = old[index];
          return (
            prior.id === agent.id &&
            prior.title === agent.title &&
            prior.status === agent.status &&
            prior.callId === agent.callId &&
            prior.detail === agent.detail
          );
        })
      );
    })
  )
    return previous;
  return next;
}

export function liveAgentsFromSessions(
  sessions: Session[],
  unseenFinishedIds: ReadonlySet<string> = new Set(),
): LiveAgent[] {
  const workers = new Map<string, Session[]>();
  for (const session of sessions) {
    if (!session.orchestrationLeadId) continue;
    const rows = workers.get(session.orchestrationLeadId) ?? [];
    rows.push(session);
    workers.set(session.orchestrationLeadId, rows);
  }
  return sessions
    .filter(
      (session) =>
        !session.inboxAsk &&
        !session.orchestrationLeadId &&
        (hasLiveWork(session, workers.get(session.id)) ||
          unseenFinishedIds.has(session.id)),
    )
    .map((session) =>
      toLiveAgent(
        session,
        unseenFinishedIds.has(session.id),
        workers.get(session.id),
      ),
    )
    .sort(compareLiveAgents);
}

export function formatLiveElapsed(startedAt: number, now: number): string {
  const seconds = Math.max(1, Math.round((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const minRest = minutes % 60;
  return minRest ? `${hours}h ${minRest}m` : `${hours}h`;
}

/** Lifecycle callbacks outlive lead turns, but never a stopped/replaced runtime. */
export function isCurrentSessionAgentSource(
  session: Session | undefined,
  harness: HarnessId,
  callbackEpoch: number,
  currentEpoch: number,
): boolean {
  return Boolean(
    session &&
    callbackEpoch === currentEpoch &&
    (session.harness === harness || session.pendingSwitch?.from === harness),
  );
}

function hasLiveWork(session: Session, workers: Session[] = []): boolean {
  return (
    isInFlightSession(session) ||
    uncertainSessionAgents(session).length > 0 ||
    workers.some(
      (worker) =>
        isInFlightSession(worker) ||
        uncertainSessionAgents(worker).length > 0,
    )
  );
}

function toLiveAgent(
  session: Session,
  unseenFinished: boolean,
  workers: Session[] = [],
): LiveAgent {
  const pending = session.blocks.find(
    (block) => block.approval && !block.approval.decided,
  );
  const pendingQuestion = session.pendingQuestion;
  const done = unseenFinished && !hasLiveWork(session, workers);
  const agents = activeSessionAgents(session);
  const activeWorkers = workers.filter(isInFlightSession);
  const backgroundCount = agents.length + activeWorkers.length;
  const uncertainCount =
    uncertainSessionAgents(session).length +
    workers.filter((worker) => uncertainSessionAgents(worker).length > 0)
      .length;
  const waitingCount = agents.filter(
    (agent) => agent.status === "waiting",
  ).length;
  const backgroundActivity = backgroundCount
    ? `${backgroundCount} background agent${backgroundCount === 1 ? "" : "s"} ${waitingCount === backgroundCount ? "waiting" : "working"}`
    : uncertainCount
      ? `Agent status unavailable`
      : undefined;
  const activityBlock = pending ?? lastActivityBlock(session.blocks);
  return {
    id: session.id,
    cwd: session.cwd,
    title: sessionDisplayTitle(session.title, session.harness),
    harness: session.harness,
    activity: done
      ? "Done"
      : pendingQuestion
        ? pendingQuestion.title ||
          pendingQuestion.questions[0]?.prompt ||
          "Question"
        : (backgroundActivity ?? activityLabel(activityBlock, session.cwd)),
    startedAt: turnStartedAt(session.blocks),
    durationMs: done ? turnDurationMs(session.blocks) : undefined,
    needsApproval:
      Boolean(pending) ||
      Boolean(pendingQuestion) ||
      activeWorkers.some(
        (worker) =>
          Boolean(worker.pendingQuestion) ||
          worker.blocks.some(
            (block) => block.approval && !block.approval.decided,
          ),
      ),
    done,
    ...(uncertainCount && !backgroundCount && !session.busy
      ? { statusUnknown: true }
      : {}),
  };
}

function compareLiveAgents(a: LiveAgent, b: LiveAgent): number {
  if (a.needsApproval !== b.needsApproval) return a.needsApproval ? -1 : 1;
  if (a.done !== b.done) return a.done ? 1 : -1;
  return (
    (a.startedAt ?? Number.MAX_SAFE_INTEGER) -
    (b.startedAt ?? Number.MAX_SAFE_INTEGER)
  );
}

function lastActivityBlock(blocks: Block[]): Block | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role === "tool" || block.role === "approval") return block;
    if (block.role === "handoff" && block.handoff?.status === "preparing") {
      return block;
    }
  }
  return undefined;
}

function turnStartedAt(blocks: Block[]): number | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].role === "user") return blocks[i].startedAt;
  }
  return undefined;
}

function turnDurationMs(blocks: Block[]): number | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].role === "user") return blocks[i].durationMs;
  }
  return undefined;
}

function activityLabel(block: Block | undefined, cwd: string): string {
  if (!block) return "Working";
  if (block.role === "handoff" && block.handoff?.status === "preparing") {
    return "Preparing a handoff";
  }
  const preview = block.tool?.preview;
  const path = preview?.path
    ? displayPath(preview.path, cwd)
    : preview?.fileName;
  return (
    composeToolTitle({
      kind: block.tool?.kind,
      title: block.text || block.tool?.title,
      path,
      query: preview?.query,
      previewKind: preview?.kind,
      cwd,
    }) || "Working"
  );
}
