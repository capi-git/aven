import { useMemo, useSyncExternalStore } from "react";
import { inboxProjectsForRail } from "../lib/githubTasks";
import {
  inboxCrewItems,
  inboxFiltersSnapshot,
  inboxFiltersFrom,
  inboxReviewRuns,
  subscribeInboxFilters,
} from "../lib/inboxFilters";
import { avosNeeds, avosOwnsRun, type AvosNeeds } from "../lib/avos";
import { openCrewInboxItems, type CrewInboxItem } from "../lib/crewInbox";
import { useCrewsStore, type Crew } from "../lib/crews";
import { projectKey } from "../lib/paths";
import { botsAvailable } from "../lib/projectBots";
import { normalizeProjectPath, type RecentProject } from "../lib/recents";
import {
  automationChatIds,
  listScheduledAgents,
  listScheduledRuns,
  openReviewRuns,
  subscribeScheduledAgents,
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

const NO_CREW_ITEMS: CrewInboxItem[] = [];
/** A project's crew in the store's snapshot, as `getCrew` finds it. */
const crewIn =
  (crews: Readonly<Record<string, Crew>>) =>
  (path: string): Crew | undefined =>
    crews[projectKey(normalizeProjectPath(path))];
const NO_AVOS_NEEDS: AvosNeeds[] = [];

/**
 * Runs whose card waits in the Inbox, newest first. A run of Avos's job
 * isn't one: its card lives in Avos (see `avosOwnsRun`).
 */
export function useOpenReviewRuns(): ScheduledRun[] {
  const runs = useSyncExternalStore(subscribeScheduledRuns, reviewSnapshot);
  const agents = useSyncExternalStore(
    subscribeScheduledAgents,
    listScheduledAgents,
  );
  const crews = useCrewsStore();
  return useMemo(() => {
    if (!botsAvailable() || !Object.keys(crews).length) return runs;
    const crewFor = crewIn(crews);
    const shown = runs.filter((run) => !avosOwnsRun(run, agents, crewFor));
    return shown.length === runs.length ? runs : shown;
  }, [runs, agents, crews]);
}

/**
 * Crew cards waiting in the Inbox (Ready and Stuck), newest first. Where
 * Avos runs, its cards live in Avos and the Inbox lists none.
 */
export function useOpenCrewInboxItems(): CrewInboxItem[] {
  const crews = useCrewsStore();
  return useMemo(
    () => (botsAvailable() ? NO_CREW_ITEMS : openCrewInboxItems(crews)),
    [crews],
  );
}

/**
 * What each of these projects' Avos waits on you for, for the Inbox's one
 * line that points at Avos (its items live there, not in the Inbox).
 */
export function useAvosInboxNeeds(
  paths: readonly string[],
): readonly AvosNeeds[] {
  const crews = useCrewsStore();
  const agents = useSyncExternalStore(
    subscribeScheduledAgents,
    listScheduledAgents,
  );
  const runs = useSyncExternalStore(subscribeScheduledRuns, listScheduledRuns);
  return useMemo(
    () =>
      botsAvailable()
        ? avosNeeds(paths.map(crewIn(crews)), {
            jobs: { agents, runs },
            now: Date.now(),
          })
        : NO_AVOS_NEEDS,
    [paths, crews, agents, runs],
  );
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
