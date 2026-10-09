import type { OrchestrationRun } from "./orchestration";
import { summarizeOrchestration } from "./orchestrationSummary";
import { fuzzyMatch } from "./fuzzy";
import { projectName } from "./paths";
import { sameProjectPath } from "./recents";
import {
  sessionDisplayTitle,
  sessionNeedsInput,
  type Session,
} from "./session";
import { shouldPersistSession, type SessionSummary } from "./sessionStore";

export type SessionGitHint = {
  repo?: string;
  branch?: string;
};

export function compareSessionSummaries(
  a: SessionSummary,
  b: SessionSummary,
): number {
  const pin = Number(!!b.pinned) - Number(!!a.pinned);
  if (pin !== 0) return pin;
  return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
}

export function mergeHistorySummary(
  current: SessionSummary[],
  summary: SessionSummary,
): SessionSummary[] {
  const previous = current.find((entry) => entry.id === summary.id);
  const next = {
    ...summary,
    archived: summary.archived ?? previous?.archived,
    pinned: summary.pinned ?? previous?.pinned,
    orchestration: summary.orchestration ?? previous?.orchestration,
    orchestrationLeadId:
      summary.orchestrationLeadId ?? previous?.orchestrationLeadId,
  };
  return [next, ...current.filter((entry) => entry.id !== summary.id)].sort(
    compareSessionSummaries,
  );
}

/**
 * Swap in one project's freshly fetched rows while leaving every other
 * project's cached rows alone. `history` is keyed only by the `cwd` on each
 * row, so holding several projects at once costs nothing and lets a revisit
 * paint from cache instead of from an empty list.
 */
export function replaceProjectHistory(
  current: SessionSummary[],
  cwd: string,
  rows: SessionSummary[],
): SessionSummary[] {
  const others = current.filter((entry) => !sameProjectPath(entry.cwd, cwd));
  return [...others, ...rows];
}

/**
 * `mergeHistorySummary`, but scoped so persisting a session cannot drop the
 * other projects the cache is holding. A session that changed project is
 * removed from its old one so the id cannot appear twice.
 */
export function mergeProjectHistorySummary(
  current: SessionSummary[],
  summary: SessionSummary,
): SessionSummary[] {
  const mine: SessionSummary[] = [];
  const others: SessionSummary[] = [];
  for (const entry of current) {
    if (sameProjectPath(entry.cwd, summary.cwd)) mine.push(entry);
    else if (entry.id !== summary.id) others.push(entry);
  }
  return [...others, ...mergeHistorySummary(mine, summary)];
}

export function filterSessionsByArchive(
  rows: SessionSummary[],
  showArchived: boolean,
): SessionSummary[] {
  return rows.filter((row) => !!row.archived === showArchived);
}

export function filterSessionsByQuery(
  rows: SessionSummary[],
  query: string,
): SessionSummary[] {
  const needle = query.trim();
  if (!needle) return rows;
  return rows.filter((row) => sessionSearchHit(row, needle));
}

function sessionSearchHit(row: SessionSummary, query: string): boolean {
  const title = sessionDisplayTitle(row.title, row.harness);
  const git = [row.repo, row.branch].filter(Boolean).join("/");
  const fields = [title, row.title, row.model, row.harness, git];
  return fields.some((field) => field && fuzzyMatch(query, field) != null);
}

type LiveActivity = {
  stamp: readonly (string | number | undefined)[];
  updatedAt: number;
};

// Unsaved rows have no durable updatedAt yet. Remember only their compact
// activity stamp so rendering (including token deltas) cannot change recency.
// Bound this cache because a window may open many different sessions over time.
const liveActivity = new Map<string, LiveActivity>();
const MAX_LIVE_ACTIVITY = 2048;

function liveUpdatedAt(session: Session): number {
  let turnIndex = session.blocks.length - 1;
  while (turnIndex >= 0 && session.blocks[turnIndex].role !== "user")
    turnIndex--;
  const turn = session.blocks[turnIndex];
  const stamp = [
    session.cwd,
    session.harness,
    session.model,
    session.runtimeMode,
    session.title,
    session.providerSessionId,
    session.orchestrationLeadId,
    turn?.id,
    turn?.startedAt,
    turn?.durationMs,
  ];
  const previous = liveActivity.get(session.id);
  const unchanged = previous?.stamp.every((value, i) => value === stamp[i]);
  const startedAt = turn?.startedAt;
  const durationMs = turn?.durationMs;
  const turnAt =
    startedAt != null && Number.isFinite(startedAt) && startedAt > 0
      ? startedAt +
        (durationMs != null && Number.isFinite(durationMs)
          ? Math.max(0, durationMs)
          : 0)
      : undefined;
  const updatedAt =
    previous && unchanged
      ? previous.updatedAt
      : previous
        ? Math.max(previous.updatedAt + 1, turnAt ?? 0, Date.now())
        : (turnAt ?? Date.now());
  // Refresh insertion order on access, retaining recent rows without retaining
  // any Session, Block, or transcript text references.
  liveActivity.delete(session.id);
  liveActivity.set(session.id, { stamp, updatedAt });
  if (liveActivity.size > MAX_LIVE_ACTIVITY) {
    liveActivity.delete(liveActivity.keys().next().value!);
  }
  return updatedAt;
}

export function summaryFromSession(
  session: Session,
  git?: SessionGitHint,
): SessionSummary {
  return {
    id: session.id,
    orchestrationLeadId: session.orchestrationLeadId,
    cwd: session.cwd,
    harness: session.harness,
    model: session.model,
    runtimeMode: session.runtimeMode,
    title: session.title,
    providerSessionId: session.providerSessionId,
    ...(git?.branch ? { branch: git.branch } : {}),
    ...(git?.repo ? { repo: git.repo } : {}),
    createdAt: 0,
    updatedAt: liveUpdatedAt(session),
  };
}

/** Prefer the project's persisted origin name, then the overlay / folder name. */
export function projectGitHint(
  rows: SessionSummary[],
  overlay?: SessionGitHint,
): SessionGitHint {
  const repo = rows.find((row) => row.repo)?.repo ?? overlay?.repo;
  const branch = overlay?.branch ?? rows.find((row) => row.branch)?.branch;
  return {
    ...(repo ? { repo } : {}),
    ...(branch ? { branch } : {}),
  };
}

function gitOverlayForCwd(cwd: string, git?: SessionGitHint): SessionGitHint {
  if (git?.repo) return git;
  if (!cwd || cwd === "~") return git ?? {};
  const name = projectName(cwd);
  if (!name || name === "~") return git ?? {};
  return { ...git, repo: name };
}

export function historyWithLiveSessions(
  history: SessionSummary[],
  sessions: Session[],
  cwd: string,
  git?: SessionGitHint,
  runs: readonly OrchestrationRun[] = [],
): SessionSummary[] {
  const workerIds = new Set([
    ...sessions
      .filter((session) => session.orchestrationLeadId)
      .map((session) => session.id),
    ...history.flatMap(
      (row) => row.orchestration?.tasks.map((task) => task.sessionId) ?? [],
    ),
    ...runs.flatMap((run) => run.tasks.map((task) => task.sessionId)),
  ]);
  const inboxIds = new Set(
    sessions.filter((session) => session.inboxAsk).map((session) => session.id),
  );
  let rows = history.filter(
    (entry) =>
      !inboxIds.has(entry.id) &&
      !entry.orchestrationLeadId &&
      !workerIds.has(entry.id) &&
      sameProjectPath(entry.cwd, cwd),
  );
  const hint = projectGitHint(rows, gitOverlayForCwd(cwd, git));
  for (const session of sessions) {
    if (session.inboxAsk || workerIds.has(session.id)) continue;
    if (!sameProjectPath(session.cwd, cwd)) continue;
    const live = session.busy || sessionNeedsInput(session);
    if (!shouldPersistSession(session) && !live) continue;
    if (rows.some((row) => row.id === session.id)) continue;
    const sessionHint: SessionGitHint = {
      ...hint,
      ...(session.branch ? { branch: session.branch } : {}),
    };
    rows = mergeHistorySummary(rows, summaryFromSession(session, sessionHint));
  }
  const byLead = new Map(runs.map((run) => [run.leadId, run]));
  return rows
    .map((row) => {
      const run = byLead.get(row.id);
      return run
        ? { ...row, orchestration: summarizeOrchestration(run, sessions) }
        : row;
    })
    .sort(compareSessionSummaries);
}
