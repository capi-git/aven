/**
 * A team's own Activity entries. While a team runs, its members' turns post
 * nothing of their own (they are recorded quietly for their chats' status);
 * the team posts one entry for each new need and one at its end:
 *
 * - "Discussion ended · 4 rounds" once a discussion uses up its rounds.
 * - "Race ready to compare · 3 agents" once every lane of a race is done.
 * - "Discussion paused · <reason>" or "Race needs you · <reason>" when a
 *   team stops for you (a member's own approval or question is already
 *   posted by that chat).
 *
 * An orchestration posts "Run finished" and "Run paused" itself, from the
 * orchestrator (see `orchestrationActivity`); the team posts only "Run needs
 * you · The lead stopped without finishing". Stopping or discarding is the
 * user's own action, so it posts nothing.
 */
import type { SessionActivityEvent } from "./notifications";
import {
  raceHeadline,
  teamIdOf,
  type TeamRun,
  type TeamStatus,
  type TeamStores,
} from "./teamRuns";

/** What was last seen of a team, to tell a change from a repeat. */
export type TeamSeen = { status: TeamStatus; need?: string };

export type TeamActivityEvent = {
  /** The chat the entry belongs to: where you act on it. */
  sessionId: string;
  event: SessionActivityEvent;
};

const NEED_LABEL: Record<TeamRun["kind"], string> = {
  discuss: "Discussion paused",
  race: "Race needs you",
  orchestrate: "Run needs you",
};

function plural(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? "" : "s"}`;
}

/** When the race's latest lane turn ended, so a second "ready" is a new one. */
function lastEnd(team: TeamRun): number {
  let at = 0;
  for (const member of team.members)
    if (member.startedAt != null && member.durationMs != null)
      at = Math.max(at, member.startedAt + member.durationMs);
  return at;
}

function needKey(team: TeamRun): string | undefined {
  if (team.status !== "needs-you" || !team.need) return undefined;
  return team.need.kind;
}

/**
 * The entries teams post as they change since `previous` (the last call's
 * `seen`). A team seen for the first time posts nothing: it is where things
 * stood when this window started watching.
 */
export function teamActivityEvents(
  previous: ReadonlyMap<string, TeamSeen> | null,
  teams: readonly TeamRun[],
): { events: TeamActivityEvent[]; seen: Map<string, TeamSeen> } {
  const seen = new Map<string, TeamSeen>();
  const events: TeamActivityEvent[] = [];
  for (const team of teams) {
    const now: TeamSeen = { status: team.status, need: needKey(team) };
    seen.set(team.id, now);
    const before = previous?.get(team.id);
    if (!before) continue;
    // A run's pauses are the orchestrator's to announce; only a lead that
    // stopped without finishing is the team's.
    if (team.kind === "orchestrate" && team.need?.kind !== "error") continue;
    const marker = { id: team.id, kind: team.kind };
    const origin = team.origin.sessionId;
    if (team.kind === "discuss" && team.status === "finished") {
      if (before.status !== "finished")
        events.push({
          sessionId: origin,
          event: {
            id: `${origin}:team:${team.key}:ended`,
            outcome: "completed",
            summary: `Discussion ended · ${team.progress}`,
            team: marker,
          },
        });
      continue;
    }
    if (team.kind === "race" && team.status === "ready") {
      // Agents you stopped yourself, with none finished, are not news.
      const done = team.members.filter(
        (member) => member.state === "done",
      ).length;
      if (before.status !== "ready" && done)
        events.push({
          sessionId: origin,
          event: {
            id: `${origin}:team:${team.key}:ready:${lastEnd(team)}`,
            outcome: "completed",
            summary: `Race ready to compare · ${
              done === team.members.length
                ? plural(done, "agent")
                : `${done} of ${team.members.length} done`
            }`,
            team: marker,
          },
        });
      continue;
    }
    const need = team.need;
    if (
      need &&
      now.need &&
      now.need !== before.need &&
      (need.kind === "paused" || need.kind === "error")
    )
      events.push({
        sessionId: need.sessionId,
        event: {
          // A race's need dates from its latest lane's end, so a Retry that
          // fails again is a new one.
          id: `${need.sessionId}:team:${team.key}:${need.kind}:${team.kind === "race" ? lastEnd(team) : need.since}`,
          // A team that stopped for you needs you, as a failure does.
          outcome: "failed",
          summary: `${NEED_LABEL[team.kind]} · ${need.text}`,
          team: { ...marker, need: true },
        },
      });
  }
  return { events, seen };
}

/**
 * The teams that no longer need you themselves: not waiting on you, or
 * waiting only on a member's own request (which that chat announces). Their
 * earlier "needs you" entries are settled (see `resolveTeamNeedActivity`).
 */
export function teamsNoLongerNeedingYou(
  teams: readonly TeamRun[],
): Set<string> {
  const ids = new Set<string>();
  for (const team of teams)
    if (
      team.status !== "needs-you" ||
      !team.need ||
      team.need.kind === "approval" ||
      team.need.kind === "question"
    )
      ids.add(team.id);
  return ids;
}

/**
 * What each finished team did, for its end entry (see `amendTeamEnd`): a
 * run's verdict and a line per agent, what a race kept and why, where a
 * discussion landed. Teams whose outcome is not known yet are left out.
 */
export function teamEndSummaries(
  stores: TeamStores,
): { teamId: string; summary: string }[] {
  const out: { teamId: string; summary: string }[] = [];
  for (const run of stores.runs) {
    if (run.status !== "finished" || run.verdict === undefined) continue;
    const agents = run.tasks
      .filter((task) => task.summary)
      .map((task) => `${task.title}: ${task.summary}`);
    out.push({
      teamId: teamIdOf("orchestrate", run.leadId),
      summary: [
        `Run finished · ${plural(run.tasks.length, "agent")}`,
        run.verdict,
        ...agents,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  for (const race of stores.races) {
    const headline = race.state === "kept" ? raceHeadline(race) : undefined;
    if (!headline) continue;
    const why = race.outcome?.kind === "lane" ? race.outcome.why : undefined;
    out.push({
      teamId: teamIdOf("race", race.id),
      summary: why ? `${headline} — ${why}` : headline,
    });
  }
  for (const discussion of stores.discussions) {
    const summary = discussion.summary;
    if (
      discussion.preview ||
      discussion.ended?.kind !== "completed" ||
      summary?.status !== "done"
    )
      continue;
    out.push({
      teamId: teamIdOf("discuss", discussion.id),
      summary: [
        `Discussion ended · ${plural(discussion.rounds, "round")}`,
        summary.agreed.length ? `Agreed: ${summary.agreed.join("; ")}` : "",
        summary.open.length ? `Still open: ${summary.open.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  return out;
}
