import { useSyncExternalStore } from "react";
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
