import { useEffect, useState } from "react";
import { isInboxEntryUnread, subscribeInboxSeen } from "../lib/inboxSeen";
import {
  listScheduledRuns,
  scheduledRunSeenEntry,
  subscribeScheduledRuns,
  type ScheduledRun,
} from "../lib/scheduledAgents";

/** Finished runs nobody has opened yet, as the Automations list marks new. */
export function unreadAutomationRuns(runs: readonly ScheduledRun[]): number {
  return runs.filter(
    (run) =>
      run.status !== "running" &&
      isInboxEntryUnread(scheduledRunSeenEntry(run)),
  ).length;
}

/** The sidebar's Automations count: kept current as runs finish or are read. */
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
