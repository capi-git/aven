/**
 * A team's own Activity entries. While a team runs, its members' turns post
 * nothing of their own (they are recorded quietly for their chats' status);
 * the team posts one entry for each new need and one at its end:
 *
 * - "Discussion finished · 4 rounds" once a discussion uses up its rounds,
 *   worded as its card words it.
 * - "Race ready to compare · 3 of 3 done" once every lane of a race has
 *   stopped, worded as its bar and pill word it.
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
import { raceKeptWhy } from "./raceLanes";
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

/**
 * Where a team is, for its notices' ids: the store's mark, the same in
 * every window (a race's newest lane ending, so a second "ready" after a
 * retry is a new one; a discussion's settled turns, so each ending is its
 * own). A race saved before it recorded endings falls back to its loaded
 * lanes' clocks.
 */
function markOf(team: TeamRun): number {
  if (team.mark) return team.mark;
  let at = 0;
  for (const member of team.members)
    if (member.startedAt != null && member.durationMs != null)
      at = Math.max(at, member.startedAt + member.durationMs);
  return at || (team.endedAt ?? team.updatedAt);
}

/**
 * How a ready race's agents ended, as its bar and pill say it (see
 * `raceProgress`): "3 of 3 done", "2 of 3 done · 1 failed".
 */
function readyProgress(members: TeamRun["members"]): string {
  const count = (state: TeamRun["members"][number]["state"]) =>
    members.filter((member) => member.state === state).length;
  return [
    `${count("done")} of ${members.length} done`,
    ...(["failed", "interrupted", "stopped"] as const)
      .filter((state) => count(state))
      .map((state) => `${count(state)} ${state}`),
  ].join(" · ");
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
      // Each ending is its own: a discussion continued and finished again
      // is announced again.
      if (before.status !== "finished")
        events.push({
          sessionId: origin,
          event: {
            id: `${origin}:team:${team.key}:ended:${markOf(team)}`,
            outcome: "completed",
            summary:
              team.result?.headline ?? `Discussion finished · ${team.progress}`,
            team: marker,
          },
        });
      continue;
    }
    if (team.kind === "race" && team.status === "ready") {
      // Agents you stopped yourself, with none finished, are not news.
      const finished = team.members.filter((member) => member.state === "done");
      const done = finished.length;
      if (before.status !== "ready" && done)
        events.push({
          // A race with no chat of its own posts on an agent that finished.
          sessionId: origin || finished[0].sessionId,
          event: {
            id: `${origin || finished[0].sessionId}:team:${team.key}:ready:${markOf(team)}`,
            outcome: "completed",
            summary: `Race ready to compare · ${readyProgress(team.members)}`,
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
          id: `${need.sessionId}:team:${team.key}:${need.kind}:${team.kind === "race" ? markOf(team) : need.since}`,
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
 * The teams whose notices this window posts, so two windows never post one
 * twice or post what only one of them can see. Each team has one window
 * that drives it: a discussion's owner; the window that started a race (or,
 * for a race saved before races kept that, any window holding one of its
 * chats); and for a run, the window whose orchestrator holds it, which is
 * the only kind of run a window's teams include.
 */
export function teamsPostedHere(
  teams: readonly TeamRun[],
  stores: Pick<TeamStores, "discussions" | "races">,
  here: { window: string; loaded: ReadonlySet<string> },
): TeamRun[] {
  const owners = new Map(
    stores.discussions.map((discussion) => [discussion.id, discussion.owner]),
  );
  const races = new Map(stores.races.map((race) => [race.id, race]));
  return teams.filter((team) => {
    if (team.kind === "discuss") return owners.get(team.key) === here.window;
    if (team.kind === "orchestrate") return true;
    const race = races.get(team.key);
    if (race?.window) return race.window === here.window;
    return [
      team.origin.sessionId,
      ...team.members.map((member) => member.sessionId),
    ].some((id) => id && here.loaded.has(id));
  });
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
 * What each finished team did, for its end entry's detail (see
 * `amendTeamEnd`): a run's verdict and a line per agent, what a race kept
 * and why, where a discussion landed. Teams whose outcome is not known yet
 * are left out.
 */
export function teamEndSummaries(
  stores: TeamStores,
): { teamId: string; detail: string }[] {
  const out: { teamId: string; detail: string }[] = [];
  for (const run of stores.runs) {
    if (run.status !== "finished" || run.verdict === undefined) continue;
    const agents = run.tasks
      .filter((task) => task.summary)
      .map((task) => `${task.title}: ${task.summary}`);
    const detail = [run.verdict, ...agents].filter(Boolean).join(" · ");
    if (detail)
      out.push({ teamId: teamIdOf("orchestrate", run.leadId), detail });
  }
  for (const race of stores.races) {
    const headline = race.state === "kept" ? raceHeadline(race) : undefined;
    if (!headline) continue;
    const why = raceKeptWhy(race);
    out.push({
      teamId: teamIdOf("race", race.id),
      detail: why ? `${headline} · ${why}` : headline,
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
    const detail = [
      summary.agreed.length ? `Agreed: ${summary.agreed.join("; ")}` : "",
      summary.open.length ? `Still open: ${summary.open.join("; ")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (detail)
      out.push({ teamId: teamIdOf("discuss", discussion.id), detail });
  }
  return out;
}
