import { displayAppData } from "./paths";
import {
  HARNESS_TITLE,
  sessionDisplayTitle,
  type Block,
  type HarnessId,
  type Session,
} from "./session";
import { isActiveSessionAgent } from "./sessionAgents";
import { summaryFromSession } from "./sessionHistory";
import { requestsAreUsers, type LeadDecided } from "./teamAttention";
import { isBlockingQuestion } from "./userQuestion";
import { currentActivity } from "./sessionDoing";

export { currentActivity };

/**
 * A loaded session reduced to what the workspace home shows. Small and
 * data-only, so a streaming flush that changes nothing here compares equal.
 */
export type HomeLiveSession = {
  id: string;
  cwd: string;
  title: string;
  harness: HarnessId;
  /**
   * The live estimate of its last change, which the sidebar shows for a
   * session that has no saved row yet. It also moves on a rename or a model
   * switch, so a saved session's time comes from its saved row instead.
   */
  updatedAt: number;
  /**
   * When its transcript last moved, from its turns alone: the latest turn's
   * end, or its start while it runs. Never a guess, and never moved by a
   * rename.
   */
  activeAt?: number;
  /** No message sent yet; the home leaves these out of Recent. */
  empty?: true;
  /** An agent is working: a turn or background agents, not paused on the user. */
  running?: true;
  /** When the current turn started, for elapsed time. */
  startedAt?: number;
  /** While running: what the agent is doing now, e.g. "Edit App.tsx". */
  doing?: string;
  /** Paused on an approval or a question, with what it asks. */
  waiting?: { kind: "approval" | "question"; detail: string };
  /**
   * An orchestration worker whose requests are yours (its run is over, or
   * its lead left one to you): listed while it works or asks, never in
   * Recent, which leaves workers out as saved history does.
   */
  worker?: true;
};

const DETAIL_MAX = 160;

/** One line Home shows: Aven's data folder in words, clipped to fit. */
function clip(text: string): string {
  const line = displayAppData(text).replace(/\s+/g, " ").trim();
  return line.length > DETAIL_MAX
    ? `${line.slice(0, DETAIL_MAX - 1).trimEnd()}…`
    : line;
}

type TurnFacts = {
  /** When the newest user turn started, if it says. */
  startedAt?: number;
  hasUser: boolean;
  /** The newest timed turn's end, or its start while it has no duration. */
  activeAt?: number;
};
// Block arrays are replaced, never mutated, so a session that is not streaming
// reuses its answer instead of scanning its transcript on every flush.
const turnFacts = new WeakMap<readonly Block[], TurnFacts>();

function validTime(value: number | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function turnOf(blocks: readonly Block[]): TurnFacts {
  const cached = turnFacts.get(blocks);
  if (cached) return cached;
  const facts: TurnFacts = { hasUser: false };
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role !== "user") continue;
    if (!facts.hasUser) {
      facts.hasUser = true;
      if (block.startedAt !== undefined) facts.startedAt = block.startedAt;
    }
    // A message sent while the agent works carries no time of its own; the
    // turn it joined does.
    if (!validTime(block.startedAt)) continue;
    const duration = block.durationMs;
    facts.activeAt =
      block.startedAt +
      (duration != null && Number.isFinite(duration)
        ? Math.max(0, duration)
        : 0);
    break;
  }
  turnFacts.set(blocks, facts);
  return facts;
}

function pendingApproval(blocks: readonly Block[]): Block | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.approval && !block.approval.decided) return block;
  }
  return undefined;
}

/**
 * Running and waiting, as the sidebar's project status defines them
 * (`sessionProjectCounts`): waiting on any approval or question; running while
 * busy or with background agents, unless an approval or blocking question
 * pauses it.
 */
function applyActivity(
  row: HomeLiveSession,
  session: Session,
  leadDecided: LeadDecided,
) {
  // A worker's approval or question is its lead's to decide, not yours: the
  // lead's row keeps working ("Lead deciding") instead of asking for you.
  const managed = !requestsAreUsers(session, leadDecided);
  const approval = managed ? undefined : pendingApproval(session.blocks);
  const question = managed ? undefined : session.pendingQuestion;
  const deciding =
    managed && (!!pendingApproval(session.blocks) || !!session.pendingQuestion);
  if ((approval || question) && !row.waiting) {
    row.waiting = approval
      ? {
          kind: "approval",
          detail: clip(
            approval.tool?.title ||
              approval.text ||
              HARNESS_TITLE[session.harness],
          ),
        }
      : {
          kind: "question",
          detail: clip(
            question?.title ||
              question?.questions[0]?.prompt ||
              `${HARNESS_TITLE[session.harness]} has a question for you`,
          ),
        };
  }
  const working =
    !!session.busy || (session.liveAgents?.some(isActiveSessionAgent) ?? false);
  if (working && !approval && !isBlockingQuestion(question)) {
    row.running = true;
    if (row.doing === undefined)
      row.doing = deciding ? "Lead deciding" : currentActivity(session);
    if (row.startedAt === undefined) {
      const startedAt = turnOf(session.blocks).startedAt;
      if (startedAt !== undefined) row.startedAt = startedAt;
    }
  }
}

/**
 * One pass over the loaded sessions. Only sessions in `inFlight` (the app's
 * busy set, which already includes leads of busy workers) are inspected for
 * approvals and questions. Inbox discussions are left out. An orchestration
 * worker counts toward its lead while the lead decides for it
 * (`leadDecided`); otherwise it is a chat of its own that asks you itself.
 */
export function homeLiveSessions(
  sessions: readonly Session[],
  inFlight: ReadonlySet<string>,
  leadDecided: LeadDecided,
): HomeLiveSession[] {
  const rows: HomeLiveSession[] = [];
  const byId = new Map<string, HomeLiveSession>();
  const workers: Session[] = [];
  for (const session of sessions) {
    if (session.inboxAsk) continue;
    const worker = !!session.orchestrationLeadId;
    if (worker && leadDecided.has(session.id)) {
      if (inFlight.has(session.id)) workers.push(session);
      continue;
    }
    if (worker && !inFlight.has(session.id)) continue;
    const row: HomeLiveSession = {
      id: session.id,
      cwd: session.cwd,
      title: sessionDisplayTitle(session.title, session.harness),
      harness: session.harness,
      updatedAt: summaryFromSession(session).updatedAt,
    };
    const turn = turnOf(session.blocks);
    if (turn.activeAt !== undefined) row.activeAt = turn.activeAt;
    if (!turn.hasUser) row.empty = true;
    if (worker) row.worker = true;
    if (inFlight.has(session.id)) applyActivity(row, session, leadDecided);
    rows.push(row);
    byId.set(session.id, row);
  }
  for (const worker of workers) {
    const lead = byId.get(worker.orchestrationLeadId!);
    if (lead) applyActivity(lead, worker, leadDecided);
  }
  return rows;
}

/** Local midnight before `now`. */
export function startOfDay(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** Elapsed time at minute resolution: "<1m", "12m", "1h 5m". */
export function homeElapsed(startedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - startedAt) / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
