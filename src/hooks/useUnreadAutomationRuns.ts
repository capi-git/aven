import { useEffect, useState } from "react";
import { isInboxEntryUnread, subscribeInboxSeen } from "../lib/inboxSeen";
import {
  listScheduledRuns,
  scheduledRunSeenEntry,
  subscribeScheduledRuns,
  type ScheduledRun,
} from "../lib/scheduledAgents";

/**
 * Failed runs nobody has opened yet: the runs that need you. A run that just
 * finished stays quiet; its automation's dot shows how it went, and a run
 * with something to review leaves its card in the Inbox instead.
 */
export function unreadAutomationRuns(runs: readonly ScheduledRun[]): number {
  return runs.filter(
    (run) =>
      run.status === "failed" && isInboxEntryUnread(scheduledRunSeenEntry(run)),
  ).length;
}

/** The sidebar's Automations count: kept current as runs fail or are read. */
export function useUnreadAutomationRuns(): number {
  const [count, setCount] = useState(() =>
    unreadAutomationRuns(listScheduledRuns()),
  );
  useEffect(() => {
    const update = () => setCount(unreadAutomationRuns(listScheduledRuns()));
    update();
    const offRuns = subscribeScheduledRuns(update);
    const offSeen = subscribeInboxSeen(update);
    return () => {
      offRuns();
      offSeen();
    };
  }, []);
  return count;
}
