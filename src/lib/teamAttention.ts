/**
 * One rule for when a team run needs you, shared by every place that tells
 * you so: notifications, Activity, Home's "Needs you" and "Running now", the
 * sidebar's amber rows, the bar, the card and the Dock badge.
 *
 * - A member's approval or question is yours to answer, except an
 *   orchestration worker's: its lead decides those ("Lead deciding"), and
 *   only the lead asking in its own chat counts as needing you.
 * - A paused team needs you, with its plain reason and the chat to open.
 * - A race whose lanes are all done is ready to compare: calm, not amber.
 *   One where no lane finished needs you.
 */
import { hasPendingApproval, type Session } from "./session";
import type { TeamMember, TeamNeed, TeamRun, TeamStatus } from "./teamRuns";

type Asker = Pick<
  Session,
  "blocks" | "pendingQuestion" | "orchestrationLeadId"
>;

/**
 * Whether this chat's own requests are yours to answer. An orchestration
 * worker's approvals and questions go to its lead instead.
 */
export function requestsAreUsers(
  session: Pick<Session, "orchestrationLeadId">,
): boolean {
  return !session.orchestrationLeadId;
}

/** Input that is the user's to give: an approval or question of theirs. */
export function sessionNeedsUser(session: Asker): boolean {
  return (
    requestsAreUsers(session) &&
    (hasPendingApproval(session.blocks) || session.pendingQuestion != null)
  );
}

/** Where a team's store says it is, before its members are looked at. */
export type TeamPhase = "running" | "paused" | "finished" | "stopped";

/**
 * A team's status and what it needs from you, from its phase and its
 * members' states. `pause` is the store's reason and the chat it waits on.
 */
export function teamAttention(input: {
  kind: TeamRun["kind"];
  phase: TeamPhase;
  members: readonly TeamMember[];
  origin: string;
  since: number;
  pause?: { reason?: string; sessionId?: string };
}): { status: TeamStatus; need?: TeamNeed } {
  const { kind, phase, members, origin, since } = input;
  if (phase === "finished") return { status: "finished" };
  if (phase === "stopped") return { status: "stopped" };
  // Workers never reach here as needs-you: their requests are the lead's.
  const asking = members.find(
    (member) => member.state === "needs-you" && member.role !== "worker",
  );
  if (asking)
    return {
      status: "needs-you",
      need: {
        sessionId: asking.sessionId,
        kind: asking.asking?.kind ?? "approval",
        text: asking.asking?.text ?? `${asking.label} needs you`,
        since,
        blocking: true,
      },
    };
  if (phase === "paused")
    return {
      status: "needs-you",
      need: {
        sessionId: input.pause?.sessionId ?? origin,
        kind: "paused",
        text: input.pause?.reason ?? "Paused",
        since,
        ...(input.pause?.sessionId ? { blocking: true as const } : {}),
      },
    };
  if (kind === "race") {
    const active = members.some(
      (member) => member.state === "working" || member.state === "queued",
    );
    if (!active)
      return members.some((member) => member.state === "done")
        ? { status: "ready" }
        : {
            status: "needs-you",
            need: {
              sessionId: origin,
              kind: "error",
              text: "No agent finished. Retry one or discard the race.",
              since,
            },
          };
  }
  return { status: "running" };
}

/** Teams waiting on you, newest need first. A ready race is not one. */
export function teamsNeedingYou(teams: readonly TeamRun[]): TeamRun[] {
  return teams
    .filter((team) => team.status === "needs-you" && team.need)
    .sort((a, b) => (b.need?.since ?? 0) - (a.need?.since ?? 0));
}

/**
 * The chats a team needs you in, beyond their own requests: a paused team's
 * chat to open, or a race no lane finished. Members' own approvals and
 * questions already count through `sessionNeedsUser`.
 */
export function teamNeedSessionIds(teams: readonly TeamRun[]): Set<string> {
  const ids = new Set<string>();
  for (const team of teamsNeedingYou(teams))
    if (
      team.need &&
      team.need.kind !== "approval" &&
      team.need.kind !== "question"
    )
      ids.add(team.need.sessionId);
  return ids;
}

/**
 * Every chat waiting on you: its own approval or question (never an
 * orchestration worker's), or a team that needs you there.
 */
export function attentionSessionIds(
  sessions: readonly (Asker & { id: string })[],
  teams: readonly TeamRun[] = [],
): Set<string> {
  const ids = teamNeedSessionIds(teams);
  for (const session of sessions)
    if (sessionNeedsUser(session)) ids.add(session.id);
  return ids;
}
