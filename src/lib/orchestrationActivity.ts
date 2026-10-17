import type { ActivityEntry, ActivityTeam } from "./activity";
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
  const team = {
    id: `orchestrate:${run.leadId}`,
    kind: "orchestrate" as const,
  };
  return kind === "finished"
    ? { id, outcome: "completed", summary: `Run finished · ${agents}`, team }
    : {
        id,
        // A paused run needs you, as a failure does: it waits for Resume.
        outcome: "failed",
        summary: run.error ? `Run paused · ${run.error}` : "Run paused",
        team: { ...team, need: true },
      };
}

/**
 * A team's need (a paused run or discussion, a race no agent finished),
 * which Activity labels "Paused" rather than "Failed".
 */
export function isRunPausedActivity(
  entry: Pick<ActivityEntry, "id"> & Partial<Pick<ActivityEntry, "team">>,
): boolean {
  return entry.team?.need === true || /:run:[^:]*:paused:\d+$/.test(entry.id);
}

/**
 * The turns the orchestrator sent: each worker's, and the lead's hidden
 * continuations. Their outcomes ("<turn>:completed", "<turn>:failed",
 * "<turn>:stopped") post nothing; the run posts its own entry. Every such
 * turn is remembered, not only a chat's latest: the lead's next hidden turn
 * often starts before the previous one has been announced.
 */
export function quietTurns(limit = 200) {
  const ids = new Set<string>();
  return {
    add(turnId: string) {
      ids.add(turnId);
      for (const oldest of ids) {
        if (ids.size <= limit) break;
        ids.delete(oldest);
      }
    },
    silences(eventId: string): boolean {
      return ids.has(eventId.slice(0, eventId.lastIndexOf(":")));
    },
  };
}

/**
 * The turns a team sends its members: a discussion's relays and a race's
 * lanes. Their outcomes are recorded quietly, already read, with the team
 * they belong to; the team posts its own entries. Like `quietTurns`, every
 * such turn is remembered, up to `limit`.
 */
export function memberTurns(limit = 200) {
  const teams = new Map<string, ActivityTeam>();
  return {
    add(turnId: string, team: ActivityTeam) {
      teams.set(turnId, { id: team.id, kind: team.kind, member: true });
      for (const oldest of teams.keys()) {
        if (teams.size <= limit) break;
        teams.delete(oldest);
      }
    },
    teamOf(eventId: string): ActivityTeam | undefined {
      return teams.get(eventId.slice(0, eventId.lastIndexOf(":")));
    },
  };
}
