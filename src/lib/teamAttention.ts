/**
 * One rule for when a team run needs you, shared by every place that tells
 * you so: notifications, Activity, Home's "Needs you" and "Running now", the
 * sidebar's amber rows, the bar, the card and the Dock badge.
 *
 * - A member's approval or question is yours to answer, except an
 *   orchestration worker's while its run is open: its lead decides those
 *   ("Lead deciding"), and only the lead asking in its own chat counts as
 *   needing you. Once the run finishes or stops, a worker is an ordinary
 *   chat again. A request the lead left unanswered is handed to you.
 * - A paused team needs you, with its plain reason and the chat to open, as
 *   does a run whose lead stopped without finishing.
 * - A race with no agent working is ready to compare: calm, not amber.
 *   One where an agent failed and none finished needs you.
 */
import type { OrchestrationRun } from "./orchestration";
import { hasPendingApproval, type Session } from "./session";
import type { TeamMember, TeamNeed, TeamRun, TeamStatus } from "./teamRuns";

type Asker = Pick<Session, "id" | "blocks" | "pendingQuestion">;

/**
 * The orchestration workers whose approvals and questions their lead
 * decides right now (see `leadDecidedIds`). Everything else's are yours.
 */
export type LeadDecided = ReadonlySet<string>;

export const NO_LEAD_DECIDED: LeadDecided = new Set();

/**
 * A run whose workers' requests are its lead's: one that is running or
 * paused, or that still has an agent working. A finished or stopped run's
 * workers are ordinary chats again.
 */
export function runManagesWorkers(
  run: Pick<OrchestrationRun, "status" | "tasks">,
): boolean {
  return (
    run.status === "active" ||
    run.status === "paused" ||
    run.tasks.some(
      (task) => task.status === "running" || task.status === "cancelling",
    )
  );
}

/**
 * Which request a chat is waiting on, as one key ("approval:7",
 * "question:3"), so a request handed to you is told apart from the next.
 */
export function pendingRequestKey(
  session: Pick<Session, "blocks" | "pendingQuestion">,
): string | undefined {
  if (session.pendingQuestion)
    return `question:${session.pendingQuestion.requestId}`;
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const approval = session.blocks[index].approval;
    if (approval && !approval.decided) return `approval:${approval.requestId}`;
  }
  return undefined;
}

/**
 * The workers whose current request is their lead's to decide: every
 * worker of a run that manages them, except one whose request Aven handed
 * to you because the lead left it unanswered (`escalated`).
 */
export function leadDecidedIds(
  runs: readonly Pick<OrchestrationRun, "status" | "tasks">[],
  session: (
    id: string,
  ) => Pick<Session, "blocks" | "pendingQuestion"> | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const run of runs) {
    if (!runManagesWorkers(run)) continue;
    for (const task of run.tasks) {
      const worker = task.escalated ? session(task.sessionId) : undefined;
      if (worker && pendingRequestKey(worker) === task.escalated) continue;
      ids.add(task.sessionId);
    }
  }
  return ids;
}

/** Whether this chat's own requests are yours to answer. */
export function requestsAreUsers(
  session: Pick<Session, "id">,
  leadDecided: LeadDecided,
): boolean {
  return !leadDecided.has(session.id);
}

/** Input that is the user's to give: an approval or question of theirs. */
export function sessionNeedsUser(
  session: Asker,
  leadDecided: LeadDecided,
): boolean {
  return (
    requestsAreUsers(session, leadDecided) &&
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
  pause?: { reason?: string; sessionId?: string; quiet?: true };
  /**
   * When a running orchestration's lead stopped without finishing, with
   * nothing else left to move the run on.
   */
  stalledSince?: number;
}): { status: TeamStatus; need?: TeamNeed } {
  const { kind, phase, members, origin, since } = input;
  if (phase === "finished") return { status: "finished" };
  if (phase === "stopped") return { status: "stopped" };
  // A worker is only ever needs-you once its lead left the request to you;
  // until then it is "lead-deciding".
  const asking = members.find((member) => member.state === "needs-you");
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
        ...(input.pause?.quiet ? { quiet: true as const } : {}),
      },
    };
  if (phase === "running" && input.stalledSince !== undefined)
    return {
      status: "needs-you",
      need: {
        sessionId: origin,
        kind: "error",
        text: "The lead stopped without finishing.",
        since: input.stalledSince,
      },
    };
  if (kind === "race") {
    const active = members.some(
      (member) => member.state === "working" || member.state === "queued",
    );
    // An agent that failed, with none finished, needs you. Agents you
    // stopped, or whose chats closed with no outcome known, are yours to
    // compare, retry or discard, calmly.
    const failed = members.some(
      (member) => member.state === "failed" || member.state === "interrupted",
    );
    if (!active)
      return members.some((member) => member.state === "done") || !failed
        ? { status: "ready" }
        : {
            status: "needs-you",
            need: {
              sessionId: origin,
              kind: "error",
              text: "No agent finished. Open Compare to retry one or discard the race.",
              since,
            },
          };
  }
  return { status: "running" };
}

/**
 * Teams waiting on you, newest need first. A ready race is not one, nor a
 * run paused long ago (see `quietPause`).
 */
export function teamsNeedingYou(teams: readonly TeamRun[]): TeamRun[] {
  return teams
    .filter(
      (team) => team.status === "needs-you" && team.need && !team.need.quiet,
    )
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
 * Every chat waiting on you: its own approval or question (never that of an
 * orchestration worker its lead decides for), or a team that needs you
 * there. A worker shows in the sidebar under its lead, so a worker asking
 * you marks its lead too (`withLeads`); the Dock counts each request once.
 */
export function attentionSessionIds(
  sessions: readonly (Asker & Partial<Pick<Session, "orchestrationLeadId">>)[],
  teams: readonly TeamRun[],
  leadDecided: LeadDecided,
  { withLeads = true }: { withLeads?: boolean } = {},
): Set<string> {
  const ids = teamNeedSessionIds(teams);
  for (const session of sessions)
    if (sessionNeedsUser(session, leadDecided)) {
      ids.add(session.id);
      if (withLeads && session.orchestrationLeadId)
        ids.add(session.orchestrationLeadId);
    }
  return ids;
}
