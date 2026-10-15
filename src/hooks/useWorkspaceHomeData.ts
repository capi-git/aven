import { useEffect, useMemo, useRef } from "react";
import type { ActivityEntry } from "../lib/activity";
import {
  completedDays,
  loadStreakDays,
  mergeDays,
  noteActiveDays,
} from "../lib/activityStreak";
import { projectRailItems, type RecentProject } from "../lib/recents";
import type { Session } from "../lib/session";
import type { SessionSummary } from "../lib/sessionStore";
import {
  homeFinished,
  homeLiveSessions,
  homeNeedsYou,
  homeProjects,
  homeRecentSessions,
  homeRunning,
  homeScope,
  type HomeAttention,
  type HomeFinished,
  type HomeLiveSession,
  type HomeProject,
  type HomeRunning,
  type HomeSession,
} from "../lib/workspaceHome";
import { equalChromeData } from "./useChromeProps";

export type WorkspaceHomeData = {
  needsYou: readonly HomeAttention[];
  running: readonly HomeRunning[];
  projects: readonly HomeProject[];
  recent: readonly HomeSession[];
  /** Finished turns, newest first, for Activity and Today. */
  finished: readonly HomeFinished[];
  /** Days with a completed task in any workspace, oldest first, for the streak. */
  activeDays: readonly string[];
};

const RECENT_ROWS = 24;
const EMPTY_LIVE: readonly HomeLiveSession[] = Object.freeze([]);
const EMPTY: WorkspaceHomeData = Object.freeze({
  needsYou: Object.freeze([]),
  running: Object.freeze([]),
  projects: Object.freeze([]),
  recent: Object.freeze([]),
  finished: Object.freeze([]),
  activeDays: Object.freeze([]),
});

/**
 * What the workspace home shows, built from state the app already holds.
 * Loaded sessions change on every streaming flush; they are first reduced to
 * small rows that keep their identity until something the home shows
 * changes, so the lists below (and the home itself) skip those flushes.
 * Does nothing while the home is not on screen.
 */
export function useWorkspaceHomeData({
  enabled,
  sessions,
  inFlightIds,
  history,
  activity,
  projects,
  standaloneCwds,
}: {
  enabled: boolean;
  sessions: readonly Session[];
  /** Sessions with work in flight, as the app's busy set (stable identity). */
  inFlightIds: ReadonlySet<string>;
  history: readonly SessionSummary[];
  activity: readonly ActivityEntry[];
  /** The workspace's projects. */
  projects: readonly RecentProject[];
  /** The workspace's folders for tasks without a project. */
  standaloneCwds: readonly string[];
}): WorkspaceHomeData {
  const next = useMemo(
    () => (enabled ? homeLiveSessions(sessions, inFlightIds) : EMPTY_LIVE),
    [enabled, sessions, inFlightIds],
  );
  const stable = useRef(next);
  if (stable.current !== next && !equalChromeData(stable.current, next))
    stable.current = next;
  const live = stable.current;

  // The sidebar's order: pinned first, then the saved order.
  const ordered = useMemo(
    () => (enabled ? projectRailItems([...projects], "~") : []),
    [enabled, projects],
  );
  const scope = useMemo(
    () => homeScope(projects, standaloneCwds),
    [projects, standaloneCwds],
  );
  const recent = useMemo(
    () => (enabled ? homeRecentSessions(history, live, scope) : EMPTY.recent),
    [enabled, history, live, scope],
  );
  const needsYou = useMemo(
    () => (enabled ? homeNeedsYou(live, activity, scope) : EMPTY.needsYou),
    [enabled, live, activity, scope],
  );
  const running = useMemo(
    () => (enabled ? homeRunning(live, scope) : EMPTY.running),
    [enabled, live, scope],
  );
  const cards = useMemo(
    () =>
      enabled ? homeProjects(ordered, recent, activity, live) : EMPTY.projects,
    [enabled, ordered, recent, activity, live],
  );
  const finished = useMemo(
    () => (enabled ? homeFinished(activity, scope) : EMPTY.finished),
    [enabled, activity, scope],
  );
  // Recent shows a few rows after leaving out those listed above it.
  const recentRows = useMemo(() => recent.slice(0, RECENT_ROWS), [recent]);
  // The ledger keeps only its newest entries; days it shows are remembered
  // so the streak outlives them. The ledger changes at turn ends, not flushes.
  const ledgerDays = useMemo(
    () => (enabled ? completedDays(activity) : EMPTY.activeDays),
    [enabled, activity],
  );
  const days = useMemo(
    () =>
      enabled ? mergeDays(loadStreakDays(), ledgerDays) : EMPTY.activeDays,
    [enabled, ledgerDays],
  );
  const stableDays = useRef(days);
  if (!equalChromeData(stableDays.current, days)) stableDays.current = days;
  const activeDays = stableDays.current;
  useEffect(() => {
    if (enabled && ledgerDays.length) noteActiveDays(ledgerDays);
  }, [enabled, ledgerDays]);
  return useMemo(
    () =>
      enabled
        ? {
            needsYou,
            running,
            projects: cards,
            recent: recentRows,
            finished,
            activeDays,
          }
        : EMPTY,
    [enabled, needsYou, running, cards, recentRows, finished, activeDays],
  );
}
