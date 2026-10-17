/**
 * One read-only view of the three kinds of team run: a discussion between
 * two chats, a race between agents in separate copies, and an orchestration
 * of a lead and its workers. Each feature's own store stays the source of
 * truth; these adapters only describe a run the same way, so one bar, one
 * card and one "Needs you" rule can serve all three.
 *
 * Everything here is plain data built from the stores and the members'
 * sessions. A watcher renders a `TeamRun`, never a transcript.
 */
import type { ActivityEntry } from "./activity";
import {
  completedRounds,
  discussionRound,
  speakingSide,
  type Discussion,
  type DiscussionSide,
} from "./discussions";
import { voiceName } from "./discussionVoices";
import type { OrchestrationRun, OrchestrationTask } from "./orchestration";
import type { RaceRecord } from "./race";
import { raceLaneState, raceProgress, type RaceLaneKind } from "./raceLanes";
import {
  HARNESS_TITLE,
  hasPendingApproval,
  sessionDisplayTitle,
  type HarnessId,
  type Session,
} from "./session";
import { teamAttention } from "./teamAttention";
import { currentActivity } from "./workspaceHome";

export type TeamKind = "discuss" | "race" | "orchestrate";

export type TeamMemberState =
  | "queued"
  | "working"
  /** An orchestration worker's request, which its lead answers. */
  | "lead-deciding"
  | "needs-you"
  | "done"
  | "failed"
  | "stopped"
  | "interrupted";

export type TeamMemberRole =
  "opener" | "responder" | "lane" | "lead" | "worker";

export type TeamMember = {
  sessionId: string;
  harness: HarnessId;
  /** The model's name as the store keeps it. */
  model: string;
  /** "Claude · Sonnet 5", a race lane's label, or a worker's task title. */
  label: string;
  role: TeamMemberRole;
  /** A discussion chat's own title, to name it. */
  title?: string;
  state: TeamMemberState;
  /** The state in words: "Working", "Lead deciding", "Accepted"… */
  stateLabel: string;
  /** While working: what it is doing now ("Edit App.tsx"). */
  doing?: string;
  /** What it asks you, while its state is needs-you. */
  asking?: { kind: "approval" | "question"; text: string };
  /** When its latest turn started, and how long it took once it ended. */
  startedAt?: number;
  durationMs?: number;
  /** Files it changed, with lines added and removed when known. */
  changes?: { files: number; additions?: number; deletions?: number };
  /** An orchestration worker's one-line summary, once written. */
  summary?: string;
};

export type TeamStatus =
  | "running"
  | "needs-you"
  /** A race whose lanes are all done: calm, waiting to be compared. */
  | "ready"
  | "finished"
  | "stopped";

/** Why a team waits on you, and the chat to open about it. */
export type TeamNeed = {
  sessionId: string;
  kind: "approval" | "question" | "error" | "paused";
  /** A plain sentence. */
  text: string;
  /** When it started waiting, as far as the store knows. */
  since: number;
  /**
   * `sessionId` is the chat the team waits on (its request, or the chat a
   * discussion paused for), not only where to act: other chats offer a way
   * there instead of Resume.
   */
  blocking?: true;
};

/** How a team ended, for its result card and its one Activity entry. */
export type TeamResult = {
  /** "Kept Codex · GPT-5 (7 files)", "Discussed for 4 rounds". */
  headline: string;
  /** One line on why: the suggested winner's reason, the lead's verdict. */
  why?: string;
};

export type TeamRun = {
  /** `<kind>:<store id>`, unique across the three stores. */
  id: string;
  kind: TeamKind;
  /** The store's own id: the discussion's, the race's or the lead's. */
  key: string;
  /** The chat the team started from: where its card and your message live. */
  origin: { sessionId: string; blockId?: string };
  project: string;
  title: string;
  status: TeamStatus;
  /** Where it stands, in words: "Round 2 of 4", "1 of 3 done". */
  progress: string;
  need?: TeamNeed;
  members: TeamMember[];
  result?: TeamResult;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  /** A development preview: shown only, never announced or counted. */
  preview?: true;
};

/** What the adapters read besides the stores. */
export type TeamLookup = {
  /** A member's loaded session, if it is loaded. */
  session(id: string): Session | undefined;
  /** The activity ledger: a race lane's last outcome is recorded there. */
  activity: readonly ActivityEntry[];
  /**
   * Fill in each working member's `doing` line. Off for watchers that never
   * show it (a bar, a sidebar row), so a new tool call does not change them.
   */
  detail?: boolean;
};

export const TEAM_KIND_LABEL: Record<TeamKind, string> = {
  discuss: "Discussing",
  race: "Racing",
  orchestrate: "Orchestrating",
};

const TITLE_CHARS = 120;

function firstLine(text: string, max = TITLE_CHARS): string {
  const line =
    text
      .split(/\r?\n/)
      .map((part) => part.trim())
      .find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What a loaded member asks you, if anything. */
function ownRequest(
  session: Session | undefined,
): TeamMember["asking"] | undefined {
  if (!session) return undefined;
  if (session.pendingQuestion)
    return {
      kind: "question",
      text: firstLine(
        session.pendingQuestion.title ||
          session.pendingQuestion.questions[0]?.prompt ||
          `${HARNESS_TITLE[session.harness]} has a question for you`,
      ),
    };
  if (!hasPendingApproval(session.blocks)) return undefined;
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const block = session.blocks[index];
    if (block.approval && !block.approval.decided)
      return {
        kind: "approval",
        text: firstLine(
          `Approve: ${block.tool?.title || block.text || HARNESS_TITLE[session.harness]}`,
        ),
      };
  }
  return undefined;
}

function doingOf(session: Session | undefined, look: TeamLookup) {
  return look.detail && session?.busy
    ? { doing: currentActivity(session) }
    : {};
}

// --- Discussions ---------------------------------------------------------------

/** A discussion between two chats as a team: the chat that started it leads. */
export function discussionTeam(
  discussion: Discussion,
  look: TeamLookup,
): TeamRun {
  const speaking = speakingSide(discussion);
  const ended = discussion.status === "ended";
  const completed = ended && discussion.ended?.kind === "completed";
  const member = (side: DiscussionSide): TeamMember => {
    const party = side === "a" ? discussion.a : discussion.b;
    const session = look.session(party.sessionId);
    const asking = ended ? undefined : ownRequest(session);
    const base = {
      sessionId: party.sessionId,
      harness: party.harness,
      model: party.model,
      label: voiceName(party),
      role: side === "a" ? ("opener" as const) : ("responder" as const),
      title: party.title,
    };
    if (ended)
      return completed
        ? { ...base, state: "done", stateLabel: "Done" }
        : { ...base, state: "stopped", stateLabel: "Stopped" };
    if (asking)
      return { ...base, state: "needs-you", stateLabel: "Needs you", asking };
    if (discussion.status === "paused")
      return { ...base, state: "queued", stateLabel: "Paused" };
    if (side === speaking)
      return {
        ...base,
        state: "working",
        stateLabel: "Replying",
        ...doingOf(session, look),
      };
    return { ...base, state: "queued", stateLabel: "Waiting its turn" };
  };
  const members = [member("a"), member("b")];
  const done = completedRounds(discussion);
  const progress = !ended
    ? `Round ${discussionRound(discussion)} of ${discussion.rounds}`
    : completed
      ? plural(discussion.rounds, "round")
      : done
        ? `Stopped after ${plural(done, "round")} of ${discussion.rounds}`
        : "Stopped";
  const { status, need } = teamAttention({
    kind: "discuss",
    phase: ended
      ? completed
        ? "finished"
        : "stopped"
      : discussion.status === "paused"
        ? "paused"
        : "running",
    members,
    origin: discussion.a.sessionId,
    since: discussion.updatedAt,
    pause: { reason: discussion.reason, sessionId: discussion.blockedBy },
  });
  return {
    id: `discuss:${discussion.id}`,
    kind: "discuss",
    key: discussion.id,
    origin: { sessionId: discussion.a.sessionId },
    project: discussion.a.cwd,
    title: firstLine(discussion.topic) || "Discussion",
    status,
    progress,
    ...(need ? { need } : {}),
    members,
    ...(completed
      ? {
          result: {
            headline: `Discussed for ${plural(discussion.rounds, "round")}`,
          },
        }
      : {}),
    startedAt: discussion.startedAt,
    updatedAt: discussion.updatedAt,
    ...(ended ? { endedAt: discussion.updatedAt } : {}),
    ...(discussion.preview ? { preview: true as const } : {}),
  };
}

// --- Races ---------------------------------------------------------------------

const LANE_STATE: Record<RaceLaneKind, TeamMemberState> = {
  working: "working",
  waiting: "needs-you",
  done: "done",
  failed: "failed",
  stopped: "stopped",
  interrupted: "interrupted",
  unstarted: "queued",
  closed: "stopped",
};

/** "Kept Codex · GPT-5 (7 files)" or "Kept 3 files from 2 agents". */
export function raceHeadline(race: RaceRecord): string | undefined {
  const outcome = race.outcome;
  if (race.state === "discarded") return "Race discarded";
  if (race.state !== "kept" || !outcome) return undefined;
  if (outcome.kind === "lane") {
    const lane = race.lanes[outcome.lane];
    return `Kept ${lane?.label ?? "one agent's version"} (${plural(outcome.files, "file")})`;
  }
  const from = new Set(Object.values(race.picks ?? {})).size;
  return from > 1
    ? `Kept ${plural(outcome.files, "file")} from ${from} agents`
    : `Kept ${plural(outcome.files, "file")}`;
}

/** A race as a team: one member per lane, started from its origin chat. */
export function raceTeam(race: RaceRecord, look: TeamLookup): TeamRun {
  const running = race.state === "running";
  const laneStates = race.lanes.map((lane) =>
    raceLaneState(lane.sessionId, look.session(lane.sessionId), look.activity),
  );
  const members = race.lanes.map((lane, index): TeamMember => {
    const session = look.session(lane.sessionId);
    const lanes = laneStates[index];
    const state = LANE_STATE[lanes.kind];
    const asking = state === "needs-you" ? ownRequest(session) : undefined;
    const stats = race.stats?.[index];
    return {
      sessionId: lane.sessionId,
      harness: lane.harness,
      model: lane.model,
      label: lane.label,
      role: "lane",
      state,
      stateLabel: lanes.label,
      ...(state === "working" ? doingOf(session, look) : {}),
      ...(asking ? { asking } : {}),
      ...(lanes.startedAt != null ? { startedAt: lanes.startedAt } : {}),
      ...(lanes.durationMs != null ? { durationMs: lanes.durationMs } : {}),
      ...(stats
        ? {
            changes: {
              files: stats.files,
              additions: stats.additions,
              deletions: stats.deletions,
            },
          }
        : {}),
    };
  });
  const origin = race.origin ?? { sessionId: race.lanes[0]?.sessionId ?? "" };
  const { status, need } = teamAttention({
    kind: "race",
    phase: running ? "running" : race.state === "kept" ? "finished" : "stopped",
    members,
    origin: origin.sessionId,
    since: race.createdAt,
  });
  const headline = raceHeadline(race);
  const why =
    race.outcome?.kind === "lane" && race.outcome.why
      ? race.outcome.why
      : undefined;
  const progress = running
    ? status === "ready"
      ? `Ready to compare · ${raceProgress(laneStates)}`
      : raceProgress(laneStates)
    : (headline ?? "Finished");
  return {
    id: `race:${race.id}`,
    kind: "race",
    key: race.id,
    origin,
    project: race.project,
    title: firstLine(race.prompt) || "Race",
    status,
    progress,
    ...(need ? { need } : {}),
    members,
    ...(headline ? { result: { headline, ...(why ? { why } : {}) } } : {}),
    startedAt: race.createdAt,
    updatedAt: race.finishedAt ?? race.createdAt,
    ...(race.finishedAt != null ? { endedAt: race.finishedAt } : {}),
  };
}

// --- Orchestrations --------------------------------------------------------------

function workerState(
  run: OrchestrationRun,
  task: OrchestrationTask,
  session: Session | undefined,
): { state: TeamMemberState; stateLabel: string } {
  switch (task.status) {
    case "queued":
      return {
        state: "queued",
        stateLabel:
          run.status === "paused"
            ? "Paused"
            : run.status === "active"
              ? "Queued"
              : "Not started",
      };
    case "running":
    case "cancelling":
      // A worker's approval or question is its lead's to decide, not yours.
      if (session && ownRequest(session))
        return { state: "lead-deciding", stateLabel: "Lead deciding" };
      return task.status === "cancelling"
        ? { state: "working", stateLabel: "Stopping" }
        : { state: "working", stateLabel: "Working" };
    case "completed":
      return {
        state: "done",
        stateLabel: task.accepted ? "Accepted" : "Done",
      };
    case "failed":
      return { state: "failed", stateLabel: "Failed" };
    case "cancelled":
      return { state: "stopped", stateLabel: "Cancelled" };
  }
}

/** "2 working · 1 waiting", or the lead's part when no agent is busy. */
export function orchestrationProgressText(
  run: OrchestrationRun,
  leadBusy: boolean,
): string {
  if (run.status === "paused") return "Paused";
  if (run.status === "finished" || run.status === "stopped") {
    const count = (status: OrchestrationTask["status"]) =>
      run.tasks.filter((task) => task.status === status).length;
    const word = run.status === "finished" ? "Finished" : "Stopped";
    return [
      word,
      plural(run.tasks.length, "agent"),
      count("failed") ? `${count("failed")} failed` : "",
      count("cancelled") ? `${count("cancelled")} cancelled` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const working = run.tasks.filter(
    (task) => task.status === "running" || task.status === "cancelling",
  ).length;
  const waiting = run.tasks.filter((task) => task.status === "queued").length;
  const parts = [
    working ? `${working} working` : "",
    waiting ? `${waiting} waiting` : "",
  ].filter(Boolean);
  if (!parts.length) parts.push(leadBusy ? "the lead is reviewing" : "idle");
  return parts.join(" · ");
}

/** An orchestration as a team: the lead, then one member per worker. */
export function orchestrationTeam(
  run: OrchestrationRun,
  look: TeamLookup,
): TeamRun {
  const leadSession = look.session(run.leadId);
  const over = run.status === "finished" || run.status === "stopped";
  const leadAsking =
    run.status === "active" ? ownRequest(leadSession) : undefined;
  const leadHarness = run.lead?.harness ?? leadSession?.harness ?? "claude";
  const leadModel = run.lead?.model ?? leadSession?.model ?? "";
  const lead: TeamMember = {
    sessionId: run.leadId,
    harness: leadHarness,
    model: leadModel,
    label: voiceName({ harness: leadHarness, model: leadModel }),
    role: "lead",
    ...(over
      ? run.status === "finished"
        ? { state: "done" as const, stateLabel: "Finished" }
        : { state: "stopped" as const, stateLabel: "Stopped" }
      : leadAsking
        ? {
            state: "needs-you" as const,
            stateLabel: "Needs you",
            asking: leadAsking,
          }
        : run.status === "paused"
          ? { state: "queued" as const, stateLabel: "Paused" }
          : leadSession?.busy
            ? {
                state: "working" as const,
                stateLabel: "Reviewing",
                ...doingOf(leadSession, look),
              }
            : { state: "queued" as const, stateLabel: "Waiting" }),
  };
  const workers = run.tasks.map((task): TeamMember => {
    const session = look.session(task.sessionId);
    const { state, stateLabel } = workerState(run, task, session);
    return {
      sessionId: task.sessionId,
      harness: task.harness,
      model: task.model,
      label: task.title,
      role: "worker",
      state,
      stateLabel,
      ...(state === "working" ? doingOf(session, look) : {}),
      ...(task.touched ? { changes: { files: task.touched.length } } : {}),
      ...(task.summary ? { summary: task.summary } : {}),
    };
  });
  const { status, need } = teamAttention({
    kind: "orchestrate",
    phase:
      run.status === "active"
        ? "running"
        : run.status === "paused"
          ? "paused"
          : run.status,
    members: [lead, ...workers],
    origin: run.leadId,
    since: run.startedAt ?? 0,
    pause: { reason: run.error, sessionId: run.leadId },
  });
  const title =
    run.title ||
    (leadSession
      ? sessionDisplayTitle(leadSession.title, leadSession.harness)
      : "") ||
    "Orchestration";
  return {
    id: `orchestrate:${run.leadId}`,
    kind: "orchestrate",
    key: run.leadId,
    origin: {
      sessionId: run.leadId,
      ...(run.proposalId ? { blockId: run.proposalId } : {}),
    },
    project: run.cwd,
    title,
    status,
    progress: orchestrationProgressText(run, !!leadSession?.busy),
    ...(need ? { need } : {}),
    members: [lead, ...workers],
    ...(over
      ? {
          result: {
            headline: `Run ${run.status === "finished" ? "finished" : "stopped"} · ${plural(run.tasks.length, "agent")}`,
            ...(run.verdict ? { why: run.verdict } : {}),
          },
        }
      : {}),
    startedAt: run.startedAt ?? 0,
    updatedAt: run.endedAt ?? run.startedAt ?? 0,
    ...(run.endedAt != null ? { endedAt: run.endedAt } : {}),
  };
}

// --- All teams -------------------------------------------------------------------

export type TeamStores = {
  discussions: readonly Discussion[];
  races: readonly RaceRecord[];
  runs: readonly OrchestrationRun[];
};

/**
 * Every team the three stores know, discussions first, then races, then
 * runs. Development previews are left out unless asked for: they are shown,
 * never announced or counted.
 */
export function teamRunsFrom(
  stores: TeamStores,
  look: TeamLookup,
  { previews = false }: { previews?: boolean } = {},
): TeamRun[] {
  return [
    ...stores.discussions
      .filter((discussion) => previews || !discussion.preview)
      .map((discussion) => discussionTeam(discussion, look)),
    ...stores.races.map((race) => raceTeam(race, look)),
    ...stores.runs.map((run) => orchestrationTeam(run, look)),
  ];
}

/** The chats a store record involves, without reading any session. */
export function teamSessionIds(stores: TeamStores): string[] {
  const ids = new Set<string>();
  for (const discussion of stores.discussions) {
    ids.add(discussion.a.sessionId);
    ids.add(discussion.b.sessionId);
  }
  for (const race of stores.races) {
    if (race.origin) ids.add(race.origin.sessionId);
    for (const lane of race.lanes) ids.add(lane.sessionId);
  }
  for (const run of stores.runs) {
    ids.add(run.leadId);
    for (const task of run.tasks) ids.add(task.sessionId);
  }
  return [...ids];
}

/** Running or waiting on you: not finished, stopped or merely ready. */
export function teamIsLive(team: Pick<TeamRun, "status">): boolean {
  return team.status === "running" || team.status === "needs-you";
}

/** Not yet over: running, waiting on you, or a race ready to compare. */
export function teamIsOpen(team: Pick<TeamRun, "status">): boolean {
  return team.status !== "finished" && team.status !== "stopped";
}

/** Whether this chat started the team, or is one of its members. */
export function teamRole(
  team: TeamRun,
  sessionId: string,
): "origin" | "member" | null {
  if (team.origin.sessionId === sessionId) return "origin";
  return team.members.some((entry) => entry.sessionId === sessionId)
    ? "member"
    : null;
}

/**
 * The team a chat started or belongs to: one that is still open first,
 * then the most recent. A chat can be in several finished ones.
 */
export function teamOf(
  sessionId: string,
  teams: readonly TeamRun[],
): TeamRun | undefined {
  let best: TeamRun | undefined;
  for (const team of teams) {
    if (!teamRole(team, sessionId)) continue;
    if (
      !best ||
      (teamIsOpen(team) && !teamIsOpen(best)) ||
      (teamIsOpen(team) === teamIsOpen(best) && team.startedAt > best.startedAt)
    )
      best = team;
  }
  return best;
}

/**
 * Each team's chat that started it, and its members: that chat on screen
 * shows the team (its card and bar), so its members' replies count as seen
 * there. A lead shows its workers, a race's chat its lanes, a discussion's
 * opening chat its partner.
 */
export function teamCompanions(
  teams: readonly TeamRun[],
): Map<string, string[]> {
  const companions = new Map<string, string[]>();
  for (const team of teams) {
    const origin = team.origin.sessionId;
    const list = companions.get(origin) ?? [];
    for (const member of team.members)
      if (member.sessionId !== origin && !list.includes(member.sessionId))
        list.push(member.sessionId);
    if (list.length) companions.set(origin, list);
  }
  return companions;
}
