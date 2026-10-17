import type { ActivityEntry } from "./activity";
import type { RunOutcome } from "./orchestration";
import type { SessionActivityEvent } from "./notifications";

/**
 * The one Activity entry (and banner, when you are away) for a run that
 * finished or paused. Worker turns and the lead's hidden turns post nothing
 * of their own, so a run reads as one event rather than one per turn.
 * The entry belongs to the lead's chat, which is where you act on it.
 */
export function runOutcomeActivity(
  { kind, run }: RunOutcome,
  at = Date.now(),
): SessionActivityEvent {
  const count = run.tasks.length;
  const agents = `${count} ${count === 1 ? "agent" : "agents"}`;
  const id = `${run.leadId}:run:${run.proposalId ?? "run"}:${kind}:${at}`;
  return kind === "finished"
    ? { id, outcome: "completed", summary: `Run finished · ${agents}` }
    : {
        id,
        // A paused run needs you, as a failure does: it waits for Resume.
        outcome: "failed",
        summary: run.error ? `Run paused · ${run.error}` : "Run paused",
      };
}

/** A paused run's entry, which Activity labels "Paused" rather than "Failed". */
export function isRunPausedActivity(entry: Pick<ActivityEntry, "id">): boolean {
  return /:run:[^:]*:paused:\d+$/.test(entry.id);
}
