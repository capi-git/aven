import type { ActivityEntry } from "./activity";
import { projectKey } from "./paths";
import { hasPendingApproval, type Session } from "./session";
import { isActiveSessionAgent } from "./sessionAgents";
import {
  requestsAreUsers,
  teamsNeedingYou,
  type LeadDecided,
} from "./teamAttention";
import type { TeamRun } from "./teamRuns";
import { isBlockingQuestion } from "./userQuestion";

/** What is happening in one project, at a glance. Zero counts mean nothing. */
export type ProjectStatus = {
  /** Sessions with a turn or background agents in flight, not paused on the user. */
  running: number;
  /** Sessions waiting on an approval or a question. */
  waiting: number;
  /** Sessions whose finished reply has not been seen. */
  unread: number;
  /** Changed files in the working tree; absent until known and when clean. */
  files?: number;
};

/** Per-project status keyed by `projectKey(path)`; serializable for the overlay. */
export type ProjectStatusMap = Readonly<Record<string, ProjectStatus>>;

type SessionCounts = Record<string, { running: number; waiting: number }>;

const EMPTY: ProjectStatusMap = Object.freeze({});

function keyFor(cwd: string | undefined): string | null {
  if (!cwd || cwd === "~") return null;
  return projectKey(cwd);
}

/**
 * Running and waiting sessions per project, as `sessionNeedsInput` and
 * `sessionIsWaitingForInput` define them. One pass over each transcript's
 * blocks, since this runs on every streaming flush; no I/O.
 */
export function sessionProjectCounts(
  sessions: readonly Pick<
    Session,
    "id" | "cwd" | "busy" | "blocks" | "pendingQuestion" | "liveAgents"
  >[],
  leadDecided: LeadDecided,
  /**
   * Teams waiting on you themselves (paused, stalled, a race no agent
   * finished): each one's chat counts as waiting in its project, as its
   * sidebar row and the Dock count it.
   */
  teamNeeds: readonly { sessionId: string; project: string }[] = [],
): SessionCounts {
  const counts: SessionCounts = {};
  const waitingIds = new Set<string>();
  for (const session of sessions) {
    const key = keyFor(session.cwd);
    if (!key) continue;
    // A request an orchestration worker's lead decides for it: the worker
    // still counts as working, never as waiting for you.
    const managed = !requestsAreUsers(session, leadDecided);
    const approval = !managed && hasPendingApproval(session.blocks);
    const question = managed ? undefined : session.pendingQuestion;
    const waiting = approval || question != null;
    const running =
      (!!session.busy ||
        (session.liveAgents?.some(isActiveSessionAgent) ?? false)) &&
      !approval &&
      !isBlockingQuestion(question);
    if (!waiting && !running) continue;
    const entry = (counts[key] ??= { running: 0, waiting: 0 });
    if (running) entry.running += 1;
    if (waiting) {
      entry.waiting += 1;
      waitingIds.add(session.id);
    }
  }
  for (const need of teamNeeds) {
    const key = keyFor(need.project);
    if (!key || waitingIds.has(need.sessionId)) continue;
    waitingIds.add(need.sessionId);
    (counts[key] ??= { running: 0, waiting: 0 }).waiting += 1;
  }
  return counts;
}

/** The teams waiting on you themselves, by the chat and project they wait in. */
export function teamNeedPlaces(
  teams: readonly TeamRun[],
): { sessionId: string; project: string }[] {
  return teamsNeedingYou(teams).flatMap((team) =>
    team.need && team.need.kind !== "approval" && team.need.kind !== "question"
      ? [{ sessionId: team.need.sessionId, project: team.project }]
      : [],
  );
}

const FINISHED = new Set(["completed", "failed", "stopped"]);

/** Sessions with an unseen finished reply, per project. */
export function unreadProjectCounts(
  activity: readonly ActivityEntry[],
): Record<string, number> {
  const sessions: Record<string, Set<string>> = {};
  for (const entry of activity) {
    if (entry.readAt !== null || !FINISHED.has(entry.outcome)) continue;
    const key = keyFor(entry.cwd);
    if (!key) continue;
    (sessions[key] ??= new Set()).add(entry.sessionId);
  }
  return Object.fromEntries(
    Object.entries(sessions).map(([key, ids]) => [key, ids.size]),
  );
}

/** Combine the parts; projects with nothing to show are left out. */
export function mergeProjectStatus(
  sessions: SessionCounts,
  unread: Readonly<Record<string, number>>,
  files: Readonly<Record<string, number>>,
): ProjectStatusMap {
  const keys = new Set([
    ...Object.keys(sessions),
    ...Object.keys(unread),
    ...Object.keys(files),
  ]);
  if (keys.size === 0) return EMPTY;
  const merged: Record<string, ProjectStatus> = {};
  for (const key of keys) {
    const counts = sessions[key];
    const status: ProjectStatus = {
      running: counts?.running ?? 0,
      waiting: counts?.waiting ?? 0,
      unread: unread[key] ?? 0,
    };
    const changed = files[key];
    if (changed && changed > 0) status.files = changed;
    if (
      status.running ||
      status.waiting ||
      status.unread ||
      status.files !== undefined
    )
      merged[key] = status;
  }
  return Object.keys(merged).length ? merged : EMPTY;
}

export function sameProjectStatus(
  a: ProjectStatusMap,
  b: ProjectStatusMap,
): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const left = a[key];
    const right = b[key];
    return (
      !!right &&
      left.running === right.running &&
      left.waiting === right.waiting &&
      left.unread === right.unread &&
      left.files === right.files
    );
  });
}

export function projectStatusFor(
  map: ProjectStatusMap | undefined,
  path: string,
): ProjectStatus | undefined {
  return map?.[projectKey(path)];
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "2 agents running · 1 waiting for you · 3 unread · 12 files changed". */
export function describeProjectStatus(
  status: ProjectStatus | undefined,
): string {
  if (!status) return "";
  const parts: string[] = [];
  if (status.running)
    parts.push(`${plural(status.running, "agent", "agents")} running`);
  if (status.waiting) parts.push(`${status.waiting} waiting for you`);
  if (status.unread) parts.push(`${status.unread} unread`);
  if (status.files)
    parts.push(`${plural(status.files, "file", "files")} changed`);
  return parts.join(" · ");
}
