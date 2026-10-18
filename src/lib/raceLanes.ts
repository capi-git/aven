import { isTurnActivity, type ActivityEntry } from "./activity";
import { appName } from "./agentNames";
import { wasTurnInterrupted } from "./inFlight";
import type { RaceLaneEnd, RaceRecord } from "./race";
import { raceAgentNames } from "./raceNames";
import { sessionIsWaitingForInput, type Session } from "./session";
import { sessionRunStatus } from "./sessionRunStatus";
import { listText, plural, possessive } from "./words";

/**
 * Where one race lane's agent is, read from its chat's own last outcome
 * rather than from whether it happens to be busy.
 */
export type RaceLaneKind =
  | "working"
  | "waiting"
  | "done"
  | "failed"
  | "stopped"
  | "interrupted"
  | "unstarted"
  | "closed";

export type RaceLaneState = {
  kind: RaceLaneKind;
  label: string;
  /** When the lane's latest turn started, for a running clock. */
  startedAt?: number;
  /** How long its latest turn took, once it ended: the clock stops there. */
  durationMs?: number;
};

const LABEL: Record<RaceLaneKind, string> = {
  working: "Working",
  waiting: "Needs you",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
  interrupted: "Interrupted",
  unstarted: "Not started",
  closed: "Closed",
};

function state(
  kind: RaceLaneKind,
  timing: { startedAt?: number; durationMs?: number } = {},
): RaceLaneState {
  return { kind, label: LABEL[kind], ...timing };
}

function latestTurn(session: Session) {
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const block = session.blocks[index];
    if (block.role === "user" && !block.internal) return { block, index };
  }
  return undefined;
}

/**
 * A chat that is not loaded: only its recorded outcomes are known, from the
 * ledger or, newer or when the ledger was cleared, from the race itself.
 */
function fromRecord(
  sessionId: string,
  entries: readonly ActivityEntry[],
  end: RaceLaneEnd | null | undefined,
): RaceLaneState {
  let latest: ActivityEntry | undefined;
  // Only the chat's own turns: a team's notice on it is not how it ended.
  for (const entry of entries)
    if (
      entry.sessionId === sessionId &&
      isTurnActivity(sessionId, entry.id) &&
      (!latest || entry.createdAt > latest.createdAt)
    )
      latest = entry;
  if (end && (!latest || end.at >= latest.createdAt)) return state(end.kind);
  // The race saw this lane's turn start and no ending yet: it is working
  // in whichever window holds it, not closed because it isn't loaded here.
  if (end === null) return state("working");
  if (!latest) return state("closed");
  if (latest.outcome === "completed") return state("done");
  if (latest.outcome === "failed") return state("failed");
  if (latest.outcome === "stopped") return state("stopped");
  return latest.resolvedAt == null ? state("waiting") : state("closed");
}

export function raceLaneState(
  sessionId: string,
  session: Session | undefined,
  entries: readonly ActivityEntry[],
  /** How the race recorded the lane's latest turn ending. */
  end?: RaceLaneEnd | null,
): RaceLaneState {
  if (!session) return fromRecord(sessionId, entries, end);
  const turn = latestTurn(session);
  const startedAt = turn?.block.startedAt;
  const timing = {
    ...(startedAt != null ? { startedAt } : {}),
    ...(turn?.block.durationMs != null
      ? { durationMs: turn.block.durationMs }
      : {}),
  };
  if (sessionIsWaitingForInput(session)) return state("waiting", timing);
  if (session.busy) return state("working", { startedAt });
  if (!turn) return state("unstarted");
  if (wasTurnInterrupted(session)) return state("interrupted", timing);
  const status = sessionRunStatus(session, entries);
  switch (status?.kind) {
    case "working":
    case "queued":
      return state("working", { startedAt });
    case "waiting":
      return state("waiting", timing);
    case "finished":
      return state("done", timing);
    case "failed":
      return state("failed", timing);
    case "stopped":
      return state("stopped", timing);
    default: {
      // The outcome fell out of the activity ledger: judge by the transcript.
      const replied = session.blocks
        .slice(turn.index + 1)
        .some((block) => block.role === "assistant" && block.text.trim());
      return state(replied ? "done" : "stopped", timing);
    }
  }
}

/** Working, or paused mid-turn on a question: either way not finished. */
export function raceLaneActive(lane: RaceLaneState): boolean {
  return lane.kind === "working" || lane.kind === "waiting";
}

/**
 * Any lane that is not working and did not finish can be sent its task
 * again: one that failed, was cut short, was stopped, or whose chat is
 * closed with no outcome known.
 */
export function raceLaneCanRetry(lane: RaceLaneState): boolean {
  return (
    lane.kind === "failed" ||
    lane.kind === "interrupted" ||
    lane.kind === "stopped" ||
    lane.kind === "closed"
  );
}

/** Seconds on the lane's clock, or null when it has none to show. */
export function raceLaneSeconds(
  lane: RaceLaneState,
  now: number,
): number | null {
  if (lane.durationMs != null && !raceLaneActive(lane))
    return Math.round(lane.durationMs / 1000);
  if (lane.startedAt != null)
    return Math.max(0, Math.round((now - lane.startedAt) / 1000));
  return null;
}

/** "2 of 3 done", with anything else that stopped or needs the user. */
export function raceProgress(lanes: readonly RaceLaneState[]): string {
  const count = (kind: RaceLaneKind) =>
    lanes.filter((lane) => lane.kind === kind).length;
  const parts = [`${count("done")} of ${lanes.length} done`];
  const waiting = count("waiting");
  if (waiting) parts.push(`${waiting} ${waiting === 1 ? "needs" : "need"} you`);
  for (const kind of ["failed", "interrupted", "stopped"] as const)
    if (count(kind)) parts.push(`${count(kind)} ${LABEL[kind].toLowerCase()}`);
  return parts.join(" · ");
}

/**
 * "Claude", or "Claude Opus 4.6" when another agent races a second model of
 * the same app.
 */
export function raceLaneName(race: RaceRecord, lane: number): string {
  return race.lanes[lane] ? raceAgentNames(race.lanes)[lane] : "this agent";
}

/** The chat asked to review a race, by its app: "Claude". */
export function raceReviewerName(race: Pick<RaceRecord, "review">): string {
  return race.review ? appName(race.review.harness) : "The reviewer";
}

/**
 * "Aven suggests Codex: <why>", or "Claude (Reviewer) suggests Codex:
 * <why>" when a chat asked as a Reviewer picked it.
 */
export function raceSuggestionText(race: RaceRecord): string | undefined {
  const suggestion = race.suggestion;
  if (suggestion?.status !== "done" || !race.lanes[suggestion.lane])
    return undefined;
  const by =
    suggestion.by === "reviewer"
      ? `${raceReviewerName(race)} (Reviewer)`
      : "Aven";
  return `${by} suggests ${raceLaneName(race, suggestion.lane)}: ${suggestion.why}`;
}

export type RaceQuestion = { title: string; body: string; confirm: string };

function stopsAgents(working: number): string {
  return working
    ? `This stops ${plural(working, "agent")} still working and `
    : "This ";
}

type AgentWork = { name: string; files: number };

/** The agents whose changes are deleted, other than `kept`, by name. */
function changedWork(
  race: RaceRecord,
  changedFiles: ReadonlyArray<number | undefined>,
  kept?: number,
): AgentWork[] {
  return race.lanes.flatMap((_, index) => {
    const files = index === kept ? 0 : (changedFiles[index] ?? 0);
    return files ? [{ name: raceLaneName(race, index), files }] : [];
  });
}

/** "Claude's work (2 files) and Codex's (1 file)". */
function workText(work: readonly AgentWork[]): string {
  return listText(
    work.map(
      ({ name, files }, index) =>
        `${possessive(name)}${index ? "" : " work"} (${plural(files, "file")})`,
    ),
  );
}

/**
 * Whether keeping one agent's version asks first: an agent is still
 * working, or another agent's changes, finished or not, would be deleted.
 */
export function raceKeepAsks(
  race: RaceRecord,
  lane: number,
  lanes: readonly RaceLaneState[],
  changedFiles: ReadonlyArray<number | undefined> = [],
): boolean {
  return (
    lanes.some(raceLaneActive) ||
    changedWork(race, changedFiles, lane).length > 0
  );
}

/**
 * Asked before keeping one agent's version (see `raceKeepAsks`): what
 * stops, and whose work is deleted. `changedFiles` holds each agent's
 * number of changed files, where known.
 */
export function raceKeepQuestion(
  race: RaceRecord,
  lane: number,
  lanes: readonly RaceLaneState[],
  changedFiles: ReadonlyArray<number | undefined> = [],
): RaceQuestion {
  const name = raceLaneName(race, lane);
  const working = lanes.filter(raceLaneActive).length;
  const own = lanes[lane] && raceLaneActive(lanes[lane]);
  const lost = changedWork(race, changedFiles, lane);
  return {
    title: `Keep ${possessive(name)} version?`,
    body: [
      own
        ? `${name} is still working; you get what it has written so far.`
        : "",
      `${stopsAgents(working)}deletes ${
        lost.length ? workText(lost) : "the other agents' work"
      }.`,
    ]
      .filter(Boolean)
      .join(" "),
    confirm: `Keep ${possessive(name)} version`,
  };
}

/** Asked before keeping a per-file mix while any agent is still working. */
export function raceCombineQuestion(
  _race: RaceRecord,
  files: number,
  lanes: readonly RaceLaneState[],
): RaceQuestion {
  const working = lanes.filter(raceLaneActive).length;
  return {
    title: `Keep ${plural(files, "selected file")}?`,
    body: `${stopsAgents(working)}deletes any changes you didn't pick.`,
    confirm: `Keep ${plural(files, "file")}`,
  };
}

/**
 * Asked before discarding: what stops and what is deleted. `changedFiles`
 * holds each lane's number of changed files, where known.
 */
export function raceDiscardQuestion(
  race: RaceRecord,
  lanes: readonly RaceLaneState[],
  changedFiles: ReadonlyArray<number | undefined> = [],
): RaceQuestion {
  const working = lanes.filter(raceLaneActive).length;
  const changed = changedWork(race, changedFiles);
  return {
    title: "Discard this race?",
    body: `${stopsAgents(working)}deletes ${
      changed.length ? workText(changed) : "the agents' work"
    }. Your project doesn't change.`,
    confirm: "Discard race",
  };
}

/** "Kept Claude's version · 4 files" or "Kept 3 files from 2 agents". */
export function raceOutcomeText(race: RaceRecord): string | null {
  const outcome = race.outcome;
  if (race.state !== "kept" || !outcome) return null;
  if (outcome.kind === "lane")
    return `Kept ${possessive(raceLaneName(race, outcome.lane))} version · ${plural(outcome.files, "file")}`;
  const from = new Set(Object.values(race.picks ?? {})).size;
  return from > 1
    ? `Kept ${plural(outcome.files, "file")} from ${from} agents`
    : `Kept ${plural(outcome.files, "file")}`;
}
