import { useMemo, useSyncExternalStore } from "react";
import { inboxProjectsForRail } from "../lib/githubTasks";
import {
  inboxFiltersSnapshot,
  inboxFiltersFrom,
  inboxReviewRuns,
  subscribeInboxFilters,
} from "../lib/inboxFilters";
import type { RecentProject } from "../lib/recents";
import {
  automationChatIds,
  listScheduledRuns,
  openReviewRuns,
  subscribeScheduledRuns,
  type ScheduledRun,
} from "../lib/scheduledAgents";

/**
 * Chats that belong to automation runs. They stay in Automations, so chat
 * lists leave them out; the set follows the runs in every window.
 */
export function useAutomationChatIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeScheduledRuns, automationChatIds);
}

let reviewCache: { source: ScheduledRun[]; runs: ScheduledRun[] } | null = null;
function reviewSnapshot(): ScheduledRun[] {
  const source = listScheduledRuns();
  if (reviewCache?.source !== source)
    reviewCache = { source, runs: openReviewRuns(source) };
  return reviewCache.runs;
}

/** Runs whose card waits in the Inbox, newest first. */
export function useOpenReviewRuns(): ScheduledRun[] {
  return useSyncExternalStore(subscribeScheduledRuns, reviewSnapshot);
}

/**
 * How many cards the Inbox lists for these projects, with its saved filters:
 * the Inbox tile's count, so it never counts a card the Inbox hides.
 */
export function useInboxReviewCount(
  recents: RecentProject[],
  cwd: string,
): number {
  const runs = useOpenReviewRuns();
  const saved = useSyncExternalStore(
    subscribeInboxFilters,
    inboxFiltersSnapshot,
  );
  return useMemo(
    () =>
      inboxReviewRuns(
        runs,
        inboxFiltersFrom(saved),
        inboxProjectsForRail(recents, cwd).map((project) => project.path),
      ).length,
    [runs, saved, recents, cwd],
  );
}
