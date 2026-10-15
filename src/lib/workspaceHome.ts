import type { ActivityEntry } from "./activity";
import { basename } from "./fs";
import { projectKey } from "./paths";
import {
  HARNESS_TITLE,
  sessionDisplayTitle,
  type Block,
  type HarnessId,
  type Session,
} from "./session";
import { isActiveSessionAgent } from "./sessionAgents";
import { summaryFromSession } from "./sessionHistory";
import type { SessionSummary } from "./sessionStore";
import { isBlockingQuestion } from "./userQuestion";

/**
 * A loaded session reduced to what the workspace home shows. Small and
 * data-only, so a streaming flush that changes nothing here compares equal.
 */
export type HomeLiveSession = {
  id: string;
  cwd: string;
  title: string;
  harness: HarnessId;
  updatedAt: number;
  /** No message sent yet; the home leaves these out of Recent. */
  empty?: true;
  /** An agent is working: a turn or background agents, not paused on the user. */
  running?: true;
  /** When the current turn started, for elapsed time. */
  startedAt?: number;
  /** Paused on an approval or a question, with what it asks. */
  waiting?: { kind: "approval" | "question"; detail: string };
};

/** A row in Recent sessions, from saved history and loaded sessions. */
export type HomeSession = {
  id: string;
  title: string;
  cwd: string;
  harness: HarnessId;
  updatedAt: number;
  branch?: string;
  running?: true;
};

/** Something waiting on the user: an approval, a question or an unread reply. */
export type HomeAttention = {
  /** Session id. */
  id: string;
  kind: "approval" | "question" | "completed" | "failed" | "stopped";
  title: string;
  cwd: string;
  /** What it asks, or the first line of the reply. */
  detail: string;
  at: number;
};

export type HomeRunning = {
  id: string;
  title: string;
  cwd: string;
  startedAt?: number;
};

export type HomeProject = {
  path: string;
  /** Folder name; the saved label is resolved where it is shown. */
  name: string;
  branch?: string;
  lastActivity?: number;
  /** The project's most recent session, which Resume opens. */
  resumeId?: string;
  resumeTitle?: string;
};

/** Which folders belong to the workspace: its projects and its no-project folders. */
export type HomeScope = {
  projects: ReadonlySet<string>;
  standalone: ReadonlySet<string>;
};

const DETAIL_MAX = 160;

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > DETAIL_MAX
    ? `${line.slice(0, DETAIL_MAX - 1).trimEnd()}…`
    : line;
}

type TurnFacts = { startedAt?: number; hasUser: boolean };
// Block arrays are replaced, never mutated, so a session that is not streaming
// reuses its answer instead of scanning its transcript on every flush.
const turnFacts = new WeakMap<readonly Block[], TurnFacts>();

function turnOf(blocks: readonly Block[]): TurnFacts {
  let facts = turnFacts.get(blocks);
  if (facts) return facts;
  facts = { hasUser: false };
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].role !== "user") continue;
    facts = { hasUser: true, startedAt: blocks[i].startedAt };
    break;
  }
  turnFacts.set(blocks, facts);
  return facts;
}

function pendingApproval(blocks: readonly Block[]): Block | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.approval && !block.approval.decided) return block;
  }
  return undefined;
}

/**
 * Running and waiting, as the sidebar's project status defines them
 * (`sessionProjectCounts`): waiting on any approval or question; running while
 * busy or with background agents, unless an approval or blocking question
 * pauses it.
 */
function applyActivity(row: HomeLiveSession, session: Session) {
  const approval = pendingApproval(session.blocks);
  const question = session.pendingQuestion;
  if ((approval || question) && !row.waiting) {
    row.waiting = approval
      ? {
          kind: "approval",
          detail: clip(
            approval.tool?.title ||
              approval.text ||
              HARNESS_TITLE[session.harness],
          ),
        }
      : {
          kind: "question",
          detail: clip(
            question?.title ||
              question?.questions[0]?.prompt ||
              `${HARNESS_TITLE[session.harness]} has a question for you`,
          ),
        };
  }
  const working =
    !!session.busy || (session.liveAgents?.some(isActiveSessionAgent) ?? false);
  if (working && !approval && !isBlockingQuestion(question)) {
    row.running = true;
    if (row.startedAt === undefined) {
      const startedAt = turnOf(session.blocks).startedAt;
      if (startedAt !== undefined) row.startedAt = startedAt;
    }
  }
}

/**
 * One pass over the loaded sessions. Only sessions in `inFlight` (the app's
 * busy set, which already includes leads of busy workers) are inspected for
 * approvals and questions. Inbox discussions are left out; orchestration
 * workers count toward their lead.
 */
export function homeLiveSessions(
  sessions: readonly Session[],
  inFlight: ReadonlySet<string>,
): HomeLiveSession[] {
  const rows: HomeLiveSession[] = [];
  const byId = new Map<string, HomeLiveSession>();
  const workers: Session[] = [];
  for (const session of sessions) {
    if (session.inboxAsk) continue;
    if (session.orchestrationLeadId) {
      if (inFlight.has(session.id)) workers.push(session);
      continue;
    }
    const row: HomeLiveSession = {
      id: session.id,
      cwd: session.cwd,
      title: sessionDisplayTitle(session.title, session.harness),
      harness: session.harness,
      updatedAt: summaryFromSession(session).updatedAt,
    };
    if (!turnOf(session.blocks).hasUser) row.empty = true;
    if (inFlight.has(session.id)) applyActivity(row, session);
    rows.push(row);
    byId.set(session.id, row);
  }
  for (const worker of workers) {
    const lead = byId.get(worker.orchestrationLeadId!);
    if (lead) applyActivity(lead, worker);
  }
  return rows;
}

export function homeScope(
  projects: readonly { path: string }[],
  standaloneCwds: readonly string[],
): HomeScope {
  return {
    projects: new Set(projects.map((project) => projectKey(project.path))),
    standalone: new Set(standaloneCwds.map((cwd) => projectKey(cwd))),
  };
}

export function inHomeScope(scope: HomeScope, cwd: string): boolean {
  if (!cwd || cwd === "~") return false;
  const key = projectKey(cwd);
  return scope.projects.has(key) || scope.standalone.has(key);
}

function newestFirst(a: { at: number; id: string }, b: typeof a): number {
  return b.at - a.at || a.id.localeCompare(b.id);
}

/**
 * The workspace's sessions, most recent first: saved history merged with
 * loaded sessions (a loaded session's title and time win). Archived rows,
 * orchestration workers and unsent new sessions are left out.
 */
export function homeRecentSessions(
  history: readonly SessionSummary[],
  live: readonly HomeLiveSession[],
  scope: HomeScope,
): HomeSession[] {
  const rows = new Map<string, HomeSession>();
  for (const entry of history) {
    if (entry.archived || entry.orchestrationLeadId) continue;
    if (!inHomeScope(scope, entry.cwd)) continue;
    rows.set(entry.id, {
      id: entry.id,
      title: sessionDisplayTitle(entry.title, entry.harness),
      cwd: entry.cwd,
      harness: entry.harness,
      updatedAt: entry.updatedAt,
      ...(entry.branch ? { branch: entry.branch } : {}),
    });
  }
  for (const session of live) {
    if (!inHomeScope(scope, session.cwd)) continue;
    const saved = rows.get(session.id);
    if (session.empty && !session.running && !saved) continue;
    rows.set(session.id, {
      id: session.id,
      title: session.title,
      cwd: session.cwd,
      harness: session.harness,
      updatedAt: session.updatedAt,
      ...(saved?.branch ? { branch: saved.branch } : {}),
      ...(session.running ? { running: true as const } : {}),
    });
  }
  return [...rows.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
  );
}

const FINISHED = new Set(["completed", "failed", "stopped"]);

/**
 * What needs the user, per session: approvals and questions first, then
 * unread finished replies, each newest first. Waiting comes from the loaded
 * sessions, as the sidebar's status does; the time is when the request was
 * recorded. Unread replies come from the activity ledger, the same rule as the
 * sidebar's unread count, so they include sessions that are not loaded.
 */
export function homeNeedsYou(
  live: readonly HomeLiveSession[],
  activity: readonly ActivityEntry[],
  scope: HomeScope,
): HomeAttention[] {
  const requested = new Map<string, number>();
  const replies = new Map<string, ActivityEntry>();
  for (const entry of activity) {
    if (
      (entry.outcome === "approval" || entry.outcome === "question") &&
      entry.resolvedAt === null
    ) {
      const at = requested.get(entry.sessionId);
      if (at === undefined || entry.createdAt > at)
        requested.set(entry.sessionId, entry.createdAt);
    } else if (entry.readAt === null && FINISHED.has(entry.outcome)) {
      const newest = replies.get(entry.sessionId);
      if (!newest || entry.createdAt > newest.createdAt)
        replies.set(entry.sessionId, entry);
    }
  }
  const waiting: HomeAttention[] = [];
  for (const session of live) {
    if (!session.waiting || !inHomeScope(scope, session.cwd)) continue;
    waiting.push({
      id: session.id,
      kind: session.waiting.kind,
      title: session.title,
      cwd: session.cwd,
      detail: session.waiting.detail,
      at: requested.get(session.id) ?? session.updatedAt,
    });
  }
  const listed = new Set(waiting.map((item) => item.id));
  const unread: HomeAttention[] = [];
  for (const entry of replies.values()) {
    if (listed.has(entry.sessionId) || !inHomeScope(scope, entry.cwd)) continue;
    unread.push({
      id: entry.sessionId,
      kind: entry.outcome as HomeAttention["kind"],
      title: entry.title,
      cwd: entry.cwd,
      detail: clip(entry.summary),
      at: entry.createdAt,
    });
  }
  return [...waiting.sort(newestFirst), ...unread.sort(newestFirst)];
}

export function isWaitingAttention(item: HomeAttention): boolean {
  return item.kind === "approval" || item.kind === "question";
}

/** Sessions with an agent at work, longest-running first, like the sidebar. */
export function homeRunning(
  live: readonly HomeLiveSession[],
  scope: HomeScope,
): HomeRunning[] {
  return live
    .filter((session) => session.running && inHomeScope(scope, session.cwd))
    .map((session) => ({
      id: session.id,
      title: session.title,
      cwd: session.cwd,
      ...(session.startedAt !== undefined
        ? { startedAt: session.startedAt }
        : {}),
    }))
    .sort(
      (a, b) =>
        (a.startedAt ?? Number.MAX_SAFE_INTEGER) -
          (b.startedAt ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
    );
}

/**
 * One card per project, in the order given (the sidebar's): its latest
 * session to resume, the branch that session last saw, and when anything last
 * happened there, including activity from sessions not loaded.
 */
export function homeProjects(
  projects: readonly { path: string }[],
  recent: readonly HomeSession[],
  activity: readonly ActivityEntry[],
): HomeProject[] {
  const latest = new Map<string, HomeSession>();
  const branches = new Map<string, string>();
  for (const session of recent) {
    const key = projectKey(session.cwd);
    if (!latest.has(key)) latest.set(key, session);
    if (session.branch && !branches.has(key)) branches.set(key, session.branch);
  }
  const lastEvent = new Map<string, number>();
  for (const entry of activity) {
    if (!entry.cwd) continue;
    const key = projectKey(entry.cwd);
    if (entry.createdAt > (lastEvent.get(key) ?? 0))
      lastEvent.set(key, entry.createdAt);
  }
  return projects.map((project) => {
    const key = projectKey(project.path);
    const session = latest.get(key);
    const branch = branches.get(key);
    const lastActivity = Math.max(
      session?.updatedAt ?? 0,
      lastEvent.get(key) ?? 0,
    );
    return {
      path: project.path,
      name: basename(project.path),
      ...(branch ? { branch } : {}),
      ...(lastActivity > 0 ? { lastActivity } : {}),
      ...(session ? { resumeId: session.id, resumeTitle: session.title } : {}),
    };
  });
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "2 agents running · 1 needs you · 3 unread", or "" when nothing is. */
export function homeSummary({
  running,
  waiting,
  unread,
}: {
  running: number;
  waiting: number;
  unread: number;
}): string {
  const parts: string[] = [];
  if (running) parts.push(`${plural(running, "agent", "agents")} running`);
  if (waiting) parts.push(`${waiting} ${waiting === 1 ? "needs" : "need"} you`);
  if (unread) parts.push(`${unread} unread`);
  return parts.join(" · ");
}

/** "just now", "5m ago", "3h ago", "2d ago", then the date. */
export function homeTimeAgo(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return "";
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(at));
  } catch {
    return "";
  }
}

/** Elapsed time at minute resolution: "<1m", "12m", "1h 5m". */
export function homeElapsed(startedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - startedAt) / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
