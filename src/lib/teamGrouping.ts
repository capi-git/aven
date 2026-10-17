/**
 * A team as one row where chats are listed: Home's "Running now",
 * Activity's "Running" and the sidebar. Its members fold into one row for
 * the chat it started from, with their mascots, the team's status and how
 * many agents it has; opening the row opens that chat.
 */
import type { HarnessId } from "./session";
import {
  TEAM_KIND_LABEL,
  teamAnchor,
  teamIsLive,
  teamIsOpen,
  type TeamKind,
  type TeamRun,
} from "./teamRuns";
import type { HomeRunning } from "./workspaceHome";

/** What a grouped row shows of its team: plain data, safe to compare. */
export type TeamRowInfo = {
  id: string;
  kind: TeamKind;
  /** "Racing · 1 of 2 done". */
  status: string;
  /** Its members, for their mascots. */
  members: { sessionId: string; harness: HarnessId }[];
  /**
   * Agents in it, as its card counts them: a run's workers, not its lead,
   * so "2 agents" everywhere.
   */
  count: number;
  /** Agents at work now. */
  working: number;
  needsYou: boolean;
};

/** "1 agent", "3 agents". */
export function teamAgentsText(info: Pick<TeamRowInfo, "count">): string {
  return `${info.count} ${info.count === 1 ? "agent" : "agents"}`;
}

export function teamRowInfo(team: TeamRun): TeamRowInfo {
  return {
    id: team.id,
    kind: team.kind,
    status: `${TEAM_KIND_LABEL[team.kind]} · ${
      team.status === "needs-you" && team.need && !team.need.quiet
        ? "Needs you"
        : team.progress
    }`,
    members: team.members.map((member) => ({
      sessionId: member.sessionId,
      harness: member.harness,
    })),
    count: team.members.filter((member) => member.role !== "lead").length,
    working: team.members.filter(
      (member) =>
        member.state === "working" || member.state === "lead-deciding",
    ).length,
    // A run paused long ago waits quietly, as everywhere else.
    needsYou: team.status === "needs-you" && !team.need?.quiet,
  };
}

/** Every chat of a team: the one it started from and its members. */
function chatsOf(team: TeamRun): Set<string> {
  return new Set([
    team.origin.sessionId,
    ...team.members.map((member) => member.sessionId),
  ]);
}

/**
 * Home's Running now with each running team as one row, in the place of
 * its first running chat: the chat it started from, titled by the team.
 */
export function groupHomeRunning(
  rows: readonly HomeRunning[],
  teams: readonly TeamRun[],
): HomeRunning[] {
  const live = teams.filter(teamIsLive);
  if (!live.length) return [...rows];
  const owner = new Map<string, TeamRun>();
  for (const team of live)
    for (const id of chatsOf(team)) if (!owner.has(id)) owner.set(id, team);
  const out: HomeRunning[] = [];
  const placed = new Set<string>();
  for (const row of rows) {
    const team = owner.get(row.id);
    if (!team) {
      out.push(row);
      continue;
    }
    if (placed.has(team.id)) continue;
    placed.add(team.id);
    const members = rows.filter((entry) => owner.get(entry.id) === team);
    const starts = members
      .map((entry) => entry.startedAt)
      .filter((at): at is number => at !== undefined);
    out.push({
      id: teamAnchor(team),
      title: team.title,
      cwd: team.project,
      ...(starts.length ? { startedAt: Math.min(...starts) } : {}),
      doing: teamRowInfo(team).status,
      team: teamRowInfo(team),
    });
  }
  return out;
}

export type RunningGroup<T> =
  { kind: "chat"; item: T } | { kind: "team"; team: TeamRun; items: T[] };

/**
 * A list of running chats with each live team's chats folded into one
 * group, where its first chat was. Chats outside a team stay as they are.
 */
export function groupRunningChats<T extends { id: string }>(
  items: readonly T[],
  teams: readonly TeamRun[],
): RunningGroup<T>[] {
  const live = teams.filter(teamIsLive);
  const owner = new Map<string, TeamRun>();
  for (const team of live)
    for (const id of chatsOf(team)) if (!owner.has(id)) owner.set(id, team);
  const groups: RunningGroup<T>[] = [];
  const byTeam = new Map<string, { kind: "team"; team: TeamRun; items: T[] }>();
  for (const item of items) {
    const team = owner.get(item.id);
    if (!team) {
      groups.push({ kind: "chat", item });
      continue;
    }
    const group = byTeam.get(team.id);
    if (group) {
      group.items.push(item);
      continue;
    }
    const created = { kind: "team" as const, team, items: [item] };
    byTeam.set(team.id, created);
    groups.push(created);
  }
  return groups;
}

/** The sidebar's view of a team: the row that stands for it, and the rest. */
export type SidebarTeam = TeamRowInfo & {
  /** The row that shows the team. */
  originId: string;
  /** Rows folded into it, left out of the list while the team is open. */
  memberIds: string[];
};

/**
 * Open races as sidebar rows: the chat a race was sent from (or its first
 * lane, for a race from the palette) shows it, and its lanes fold in until
 * it is kept or discarded. A discussion's two chats stay as your own rows,
 * linked by their connector, and an orchestration's agents already fold
 * into their lead's card.
 */
/**
 * `rows` with each open race's lanes folded into the row it started from,
 * but only where that row is itself in `rows`: when it is filtered out,
 * archived or gone, the lanes stay rows of their own rather than vanish.
 */
export function foldTeamRows<Row extends { id: string }>(
  rows: readonly Row[],
  teams: readonly Pick<SidebarTeam, "originId" | "memberIds">[],
): Row[] {
  const listed = new Set(rows.map((row) => row.id));
  const folded = new Set(
    teams
      .filter((team) => listed.has(team.originId))
      .flatMap((team) => team.memberIds),
  );
  return folded.size ? rows.filter((row) => !folded.has(row.id)) : [...rows];
}

/** Each row's open races, by the row they started from. */
export function teamsByOrigin<Team extends Pick<SidebarTeam, "originId">>(
  teams: readonly Team[],
): Map<string, Team[]> {
  const byOrigin = new Map<string, Team[]>();
  for (const team of teams)
    byOrigin.set(team.originId, [...(byOrigin.get(team.originId) ?? []), team]);
  return byOrigin;
}

export function sidebarTeams(teams: readonly TeamRun[]): SidebarTeam[] {
  return teams
    .filter((team) => team.kind === "race" && teamIsOpen(team))
    .map((team) => ({
      ...teamRowInfo(team),
      // A race with no chat of its own folds into its first agent's row.
      originId: teamAnchor(team),
      memberIds: team.members
        .map((member) => member.sessionId)
        .filter((id) => id !== teamAnchor(team)),
    }));
}
