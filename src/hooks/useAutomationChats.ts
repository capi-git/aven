import { useMemo, useSyncExternalStore } from "react";
import { inboxProjectsForRail } from "../lib/githubTasks";
import {
  inboxCrewItems,
  inboxFiltersSnapshot,
  inboxFiltersFrom,
  inboxReviewRuns,
  subscribeInboxFilters,
} from "../lib/inboxFilters";
import { openCrewInboxItems, type CrewInboxItem } from "../lib/crewInbox";
import { useCrewsStore } from "../lib/crews";
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

/** Crew cards waiting in the Inbox (Ready and Stuck), newest first. */
export function useOpenCrewInboxItems(): CrewInboxItem[] {
  const crews = useCrewsStore();
  return useMemo(() => openCrewInboxItems(crews), [crews]);
}

/**
 * How many cards the Inbox lists for these projects, with its saved filters:
 * the Inbox tile's count, so it never counts a card the Inbox hides. Crew
 * cards count with the automations'.
 */
export function useInboxReviewCount(
  recents: RecentProject[],
  cwd: string,
): number {
  const runs = useOpenReviewRuns();
  const crewItems = useOpenCrewInboxItems();
  const saved = useSyncExternalStore(
    subscribeInboxFilters,
    inboxFiltersSnapshot,
  );
  return useMemo(() => {
    const filters = inboxFiltersFrom(saved);
    const paths = inboxProjectsForRail(recents, cwd).map(
      (project) => project.path,
    );
    return (
      inboxReviewRuns(runs, filters, paths).length +
      inboxCrewItems(crewItems, filters, paths).length
    );
  }, [runs, crewItems, saved, recents, cwd]);
}
