import type { ActivityEntry } from "./activity";
import { basename } from "./fs";
import { composeToolTitle, isWeakToolTitle } from "./harness/preview";
import { displayPath, projectKey } from "./paths";
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
  /**
   * The live estimate of its last change, which the sidebar shows for a
   * session that has no saved row yet. It also moves on a rename or a model
   * switch, so a saved session's time comes from its saved row instead.
   */
  updatedAt: number;
  /**
   * When its transcript last moved, from its turns alone: the latest turn's
   * end, or its start while it runs. Never a guess, and never moved by a
   * rename.
   */
  activeAt?: number;
  /** No message sent yet; the home leaves these out of Recent. */
  empty?: true;
  /** An agent is working: a turn or background agents, not paused on the user. */
  running?: true;
  /** When the current turn started, for elapsed time. */
  startedAt?: number;
  /** While running: what the agent is doing now, e.g. "Edit App.tsx". */
  doing?: string;
  /** Paused on an approval or a question, with what it asks. */
  waiting?: { kind: "approval" | "question"; detail: string };
};

/** A row in Recent sessions, from saved history and loaded sessions. */
export type HomeSession = {
  id: string;
  title: string;
  cwd: string;
  harness: HarnessId;
  /** When it last did anything; see `homeSessionIndex`. */
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
  /** When the session last did anything; see `homeSessionIndex`. */
  at: number;
};

export type HomeRunning = {
  id: string;
  title: string;
  cwd: string;
  startedAt?: number;
  doing?: string;
};

export type HomeProject = {
  path: string;
  /** Folder name; the saved label is resolved where it is shown. */
  name: string;
  branch?: string;
  lastActivity?: number;
  /**
   * The session the project opens to: one waiting on the user, else one at
   * work, else the most recent.
   */
  resumeId?: string;
  resumeTitle?: string;
  /** What its newest running agent is doing now. */
  doing?: string;
  /** What a session in it is waiting on the user for. */
  asking?: string;
};

/** A finished turn from the activity ledger. */
export type HomeFinished = {
  /** Activity entry id. */
  id: string;
  sessionId: string;
  kind: "completed" | "failed" | "stopped";
  title: string;
  cwd: string;
  /** First line of the reply. */
  detail: string;
  at: number;
  unread: boolean;
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

type TurnFacts = {
  /** When the newest user turn started, if it says. */
  startedAt?: number;
  hasUser: boolean;
  /** The newest timed turn's end, or its start while it has no duration. */
  activeAt?: number;
};
// Block arrays are replaced, never mutated, so a session that is not streaming
// reuses its answer instead of scanning its transcript on every flush.
const turnFacts = new WeakMap<readonly Block[], TurnFacts>();

function validTime(value: number | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function turnOf(blocks: readonly Block[]): TurnFacts {
  const cached = turnFacts.get(blocks);
  if (cached) return cached;
  const facts: TurnFacts = { hasUser: false };
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role !== "user") continue;
    if (!facts.hasUser) {
      facts.hasUser = true;
      if (block.startedAt !== undefined) facts.startedAt = block.startedAt;
    }
    // A message sent while the agent works carries no time of its own; the
    // turn it joined does.
    if (!validTime(block.startedAt)) continue;
    const duration = block.durationMs;
    facts.activeAt =
      block.startedAt +
      (duration != null && Number.isFinite(duration)
        ? Math.max(0, duration)
        : 0);
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
 * What a working session is doing now, from its current turn only: the
 * latest tool call (worded as the live agents list words it), a reply being
 * written, or thinking. A turn's earlier tools never stand in for it.
 */
export function currentActivity(session: Session): string {
  const blocks = session.blocks;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role === "user") break;
    if (block.role === "reasoning") return "Thinking";
    if (block.role === "assistant") return "Writing a reply";
    if (block.role === "handoff" && block.handoff?.status === "preparing")
      return "Preparing a handoff";
    if (block.role !== "tool") continue;
    const preview = block.tool?.preview;
    const path = preview?.path
      ? displayPath(preview.path, session.cwd)
      : preview?.fileName;
    const label = composeToolTitle({
      kind: block.tool?.kind,
      title: block.text || block.tool?.title,
      path,
      query: preview?.query,
      previewKind: preview?.kind,
      cwd: session.cwd,
    });
    // A bare verb ("Edit") gains the file it acts on; a bubble is narrow, so
    // the file name rather than its path.
    if (label && path && isWeakToolTitle(label))
      return clip(`${label} ${basename(path)}`);
    return clip(label || "Working");
  }
  if (!session.busy && session.liveAgents?.some(isActiveSessionAgent))
    return "Background agents working";
  return "Thinking";
}

/**
 * Running and waiting, as the sidebar's project status defines them
 * (`sessionProjectCounts`): waiting on any approval or question; running while
 * busy or with background agents, unless an approval or blocking question
 * pauses it.
 */
function applyActivity(row: HomeLiveSession, session: Session) {
  // A worker's approval or question is its lead's to decide, not yours: the
  // lead's row keeps working ("Lead deciding") instead of asking for you.
  const managed = !!session.orchestrationLeadId;
  const approval = managed ? undefined : pendingApproval(session.blocks);
  const question = managed ? undefined : session.pendingQuestion;
  const deciding =
    managed && (!!pendingApproval(session.blocks) || !!session.pendingQuestion);
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
    if (row.doing === undefined)
      row.doing = deciding ? "Lead deciding" : currentActivity(session);
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
    const turn = turnOf(session.blocks);
    if (turn.activeAt !== undefined) row.activeAt = turn.activeAt;
    if (!turn.hasUser) row.empty = true;
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
 * Each session's current title and last activity, so every part of Home names
 * and dates a session the same way, and as the sidebar does.
 */
export type HomeSessionIndex = {
  /**
   * When each session last did anything: the newest of the time the sidebar
   * shows (its saved row's, or the live estimate for a session not saved
   * yet), its newest activity-ledger entry, and its loaded transcript's
   * latest turn.
   */
  at: ReadonlyMap<string, number>;
  /** Its current title: the loaded session's, else its saved row's. */
  title: ReadonlyMap<string, string>;
};

export function homeSessionIndex(
  history: readonly SessionSummary[],
  live: readonly HomeLiveSession[],
  activity: readonly ActivityEntry[],
): HomeSessionIndex {
  const at = new Map<string, number>();
  const title = new Map<string, string>();
  const later = (id: string, time: number | undefined) => {
    if (time === undefined || !Number.isFinite(time) || time <= 0) return;
    if (time > (at.get(id) ?? 0)) at.set(id, time);
  };
  for (const entry of history) {
    later(entry.id, entry.updatedAt);
    title.set(entry.id, sessionDisplayTitle(entry.title, entry.harness));
  }
  for (const session of live) {
    // A saved row's time is the sidebar's; the live estimate stands in only
    // until there is one, as it does in the sidebar.
    if (!title.has(session.id)) later(session.id, session.updatedAt);
    later(session.id, session.activeAt);
    title.set(session.id, session.title);
  }
  for (const entry of activity) later(entry.sessionId, entry.createdAt);
  return { at, title };
}

const NO_INDEX: HomeSessionIndex = { at: new Map(), title: new Map() };

/**
 * The workspace's sessions, most recent first: saved history merged with
 * loaded sessions (a loaded session's title wins), each dated by its last
 * activity. Archived rows, orchestration workers and unsent new sessions are
 * left out.
 */
export function homeRecentSessions(
  history: readonly SessionSummary[],
  live: readonly HomeLiveSession[],
  scope: HomeScope,
  index: HomeSessionIndex = homeSessionIndex(history, live, []),
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
      updatedAt: index.at.get(entry.id) ?? entry.updatedAt,
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
      updatedAt: index.at.get(session.id) ?? session.updatedAt,
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
 * sessions, as the sidebar's status does. Unread replies come from the
 * activity ledger, the same rule as the sidebar's unread count, so they
 * include sessions that are not loaded. Each row carries the session's current
 * title and last activity (`index`); without them, the ledger's title and the
 * time the request or reply was recorded.
 */
export function homeNeedsYou(
  live: readonly HomeLiveSession[],
  activity: readonly ActivityEntry[],
  scope: HomeScope,
  index: HomeSessionIndex = NO_INDEX,
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
      at:
        index.at.get(session.id) ??
        requested.get(session.id) ??
        session.updatedAt,
    });
  }
  const listed = new Set(waiting.map((item) => item.id));
  const unread: HomeAttention[] = [];
  for (const entry of replies.values()) {
    if (listed.has(entry.sessionId) || !inHomeScope(scope, entry.cwd)) continue;
    unread.push({
      id: entry.sessionId,
      kind: entry.outcome as HomeAttention["kind"],
      title: index.title.get(entry.sessionId) ?? entry.title,
      cwd: entry.cwd,
      detail: clip(entry.summary),
      at: index.at.get(entry.sessionId) ?? entry.createdAt,
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
      ...(session.doing ? { doing: session.doing } : {}),
    }))
    .sort(
      (a, b) =>
        (a.startedAt ?? Number.MAX_SAFE_INTEGER) -
          (b.startedAt ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
    );
}

/**
 * One tile per project, in the order given (the sidebar's): the session it
 * opens to, what its agents are doing or asking, the branch its latest
 * session saw, and when anything last happened there: its newest session's
 * last activity (`recent` is dated that way), or, before its sessions are
 * listed, its newest activity-ledger entry.
 */
export function homeProjects(
  projects: readonly { path: string }[],
  recent: readonly HomeSession[],
  activity: readonly ActivityEntry[],
  live: readonly HomeLiveSession[] = [],
  index: HomeSessionIndex = NO_INDEX,
): HomeProject[] {
  const timeOf = (session: HomeLiveSession) =>
    index.at.get(session.id) ?? session.updatedAt;
  const latest = new Map<string, HomeSession>();
  const branches = new Map<string, string>();
  for (const session of recent) {
    const key = projectKey(session.cwd);
    if (!latest.has(key)) latest.set(key, session);
    if (session.branch && !branches.has(key)) branches.set(key, session.branch);
  }
  const working = new Map<string, HomeLiveSession>();
  const waiting = new Map<string, HomeLiveSession>();
  for (const session of live) {
    const key = projectKey(session.cwd);
    if (session.waiting) {
      const prior = waiting.get(key);
      if (!prior || timeOf(session) > timeOf(prior)) waiting.set(key, session);
    }
    if (session.running) {
      const prior = working.get(key);
      if (!prior || (session.startedAt ?? 0) > (prior.startedAt ?? 0))
        working.set(key, session);
    }
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
    const recentSession = latest.get(key);
    const asking = waiting.get(key);
    const doing = working.get(key);
    const opens = asking ?? doing ?? recentSession;
    const branch = branches.get(key);
    const lastActivity = recentSession
      ? recentSession.updatedAt
      : (lastEvent.get(key) ?? 0);
    return {
      path: project.path,
      name: basename(project.path),
      ...(branch ? { branch } : {}),
      ...(lastActivity > 0 ? { lastActivity } : {}),
      ...(opens ? { resumeId: opens.id, resumeTitle: opens.title } : {}),
      ...(doing?.doing ? { doing: doing.doing } : {}),
      ...(asking?.waiting ? { asking: asking.waiting.detail } : {}),
    };
  });
}

/**
 * Finished turns in the workspace, newest first, from the activity ledger,
 * each at the time it finished and under its session's current title.
 */
export function homeFinished(
  activity: readonly ActivityEntry[],
  scope: HomeScope,
  index: HomeSessionIndex = NO_INDEX,
): HomeFinished[] {
  const rows: HomeFinished[] = [];
  for (const entry of activity) {
    if (!FINISHED.has(entry.outcome) || !inHomeScope(scope, entry.cwd))
      continue;
    rows.push({
      id: entry.id,
      sessionId: entry.sessionId,
      kind: entry.outcome as HomeFinished["kind"],
      title: index.title.get(entry.sessionId) ?? entry.title,
      cwd: entry.cwd,
      detail: clip(entry.summary),
      at: entry.createdAt,
      unread: entry.readAt === null,
    });
  }
  return rows.sort(newestFirst);
}

/** Local midnight before `now`. */
export function startOfDay(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** Turns finished since local midnight, by outcome. */
export function homeTodayCounts(
  finished: readonly Pick<HomeFinished, "kind" | "at">[],
  now: number,
): { done: number; failed: number; stopped: number } {
  const since = startOfDay(now);
  const counts = { done: 0, failed: 0, stopped: 0 };
  for (const row of finished) {
    if (row.at < since || row.at > now + 60_000) continue;
    if (row.kind === "completed") counts.done += 1;
    else if (row.kind === "failed") counts.failed += 1;
    else counts.stopped += 1;
  }
  return counts;
}

/**
 * Today's recap: turns finished since local midnight by outcome, and how many
 * projects saw a task done.
 */
export function homeTodayRecap(
  finished: readonly Pick<HomeFinished, "kind" | "at" | "cwd">[],
  now: number,
): { done: number; failed: number; stopped: number; projects: number } {
  const counts = homeTodayCounts(finished, now);
  const since = startOfDay(now);
  const projects = new Set<string>();
  for (const row of finished)
    if (row.kind === "completed" && row.at >= since && row.at <= now + 60_000)
      projects.add(projectKey(row.cwd));
  return { ...counts, projects: projects.size };
}

/** "Good morning" and so on, by the local hour. */
export function homeGreeting(now: number): string {
  const hour = new Date(now).getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
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
