import { isInFlightSession } from "./inFlight";
import type { OrchestrationRun } from "./orchestration";
import type { Session } from "./session";
import { uncertainSessionAgents } from "./sessionAgents";

const open = (run: OrchestrationRun) =>
  run.status === "active" || run.status === "paused";

/**
 * Chats that stay loaded although no tab shows them. Tabs are views: an idle
 * chat without one is parked. Some must not be:
 *
 * - Inbox chats, which the Inbox panel owns.
 * - A discussion's chats, until it is finished, so its relays reach them
 *   (`discussionChats`, from the discussion store).
 * - The lead of a run that is running or paused. Results are delivered only
 *   to a loaded lead, and the dispatcher stops a run whose lead is missing,
 *   so closing the lead's tab would strand the results or end the run.
 * - The lead of a worker that is still working, its navigation target.
 * - The workers of a loaded lead, or of a run that is still open.
 * - A project bot's chat while Aven works for it (syncing its copy, its
 *   wake-up on the way, reading its fix), or before its first message, when
 *   there is nothing saved to load it again from (`botChats`). Idle, it is
 *   parked like any chat and loaded again on its next wake-up.
 */
export function retainedSessionIds(
  sessions: readonly Session[],
  openIds: ReadonlySet<string>,
  runs: readonly OrchestrationRun[],
  discussionChats: Iterable<string> = [],
  botChats: Iterable<string> = [],
): Set<string> {
  const ids = new Set(openIds);
  for (const id of discussionChats) if (id) ids.add(id);
  for (const id of botChats) if (id) ids.add(id);
  for (const run of runs) if (open(run)) ids.add(run.leadId);
  for (const session of sessions) {
    if (session.inboxAsk) ids.add(session.id);
    // A managed assignment may be finished while its native children keep
    // working. Its lead remains the navigation target for those workers.
    if (
      session.orchestrationLeadId &&
      (isInFlightSession(session) || uncertainSessionAgents(session).length)
    )
      ids.add(session.orchestrationLeadId);
  }
  // Internal workers stay attached to the lead, even while idle between
  // turns. They must not be discarded merely because they have no tab.
  for (const session of sessions) {
    const lead = session.orchestrationLeadId;
    if (
      lead &&
      (ids.has(lead) || runs.some((run) => run.leadId === lead && open(run)))
    )
      ids.add(session.id);
  }
  return ids;
}
