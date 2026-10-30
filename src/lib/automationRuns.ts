import { isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  automationPrompt,
  parseAutomationReview,
  reviewAction,
  stripAutomationReview,
} from "./automationReview";
import type { ControlOutcome } from "./orchestration";
import {
  finalAssistantText,
  getScheduledRun,
  runSummary,
  saveScheduledRun,
  scheduledAgentProblem,
  updateScheduledRun,
  type ScheduledAgent,
  type ScheduledRun,
} from "./scheduledAgents";
import { logError } from "./errors";
import { newSession, type Block, type Session } from "./session";

/**
 * Starting an automation run. The run gets a chat of its own, which stays in
 * Automations: it is added to the workspace with no tab, kept out of the
 * chats list (see `automationChatIds`), and its turn posts nothing to
 * Activity. You hear about a run only when it needs you: it failed (or could
 * not start), or it left a card to review. Approvals and questions still
 * reach you as they do from any chat.
 */

/**
 * Why a run tells you about itself, if it does. A run that could not start
 * has no chat (`session` is absent).
 */
export type AutomationRunNotice = {
  kind: "failed" | "review";
  run: ScheduledRun;
  session?: Session;
};

export type AutomationRunDeps = {
  /** Where an automation in no project runs: the chats folder. */
  noProjectFolder: () => Promise<string>;
  problem?: (agent: ScheduledAgent, folder: string) => Promise<string | null>;
  /** Puts the run's chat into the workspace, with no tab. */
  addChat: (session: Session) => void;
  /**
   * Sends the run's turn. `text` is what the agent gets, `displayText` what
   * the chat shows; `settle` is called once with the outcome.
   */
  submit: (
    session: Session,
    turn: { text: string; displayText: string },
    settle: (outcome: ControlOutcome) => void,
  ) => boolean | void;
  /** The chat's blocks once its turn has settled. */
  blocks: (sessionId: string) => readonly Block[] | undefined;
  notify?: (notice: AutomationRunNotice) => void;
  now?: () => number;
  id?: () => string;
};

/** The chat's title: the automation it runs for. */
export function automationChatTitle(agent: Pick<ScheduledAgent, "name">) {
  return `Scheduled · ${agent.name}`;
}

/**
 * Records how a settled turn went on its run: status, summary, and a card
 * when the agent left one. Returns the run as saved, or undefined when the
 * run is gone.
 */
export function settleAutomationRun(
  runId: string,
  outcome: ControlOutcome,
  blocks: readonly Block[] | undefined,
  now: number,
): ScheduledRun | undefined {
  const run = getScheduledRun(runId);
  if (!run) return undefined;
  // Stopped (from another window) while this turn ran: it stays stopped,
  // whatever the turn went on to say.
  if (run.status === "cancelled") return run;
  const reply = finalAssistantText(blocks ?? []) || outcome.text;
  const review =
    outcome.status === "completed" ? parseAutomationReview(reply, now) : null;
  const patch: Partial<ScheduledRun> = {
    status: outcome.status,
    summary: runSummary(stripAutomationReview(reply)),
    error: outcome.error,
    finishedAt: now,
    // A card you already acted on stays as it was; a new one replaces it.
    ...(review ? { review } : {}),
  };
  updateScheduledRun(runId, patch);
  return getScheduledRun(runId);
}

/** Calls `notify` for a settled turn that needs you. */
function noticeFor(
  saved: ScheduledRun,
  session: Session,
  turnStartedAt: number,
  notify: AutomationRunDeps["notify"],
) {
  if (saved.status === "failed")
    notify?.({ kind: "failed", run: saved, session });
  else if (
    saved.review?.status === "open" &&
    saved.review.postedAt >= turnStartedAt
  )
    notify?.({ kind: "review", run: saved, session });
}

/** Runs on their way to starting, by automation: a second press joins it. */
const starting = new Map<string, Promise<ScheduledRun>>();
/** Runs whose turn this window is taking, and will settle, with their chats. */
const liveRuns = new Map<string, string>();

/**
 * Start one run of `agent` now. Resolves with the run as first saved.
 * Pressed again while that run is still starting, it starts no second one.
 */
export function startAutomationRun(
  agent: ScheduledAgent,
  deps: AutomationRunDeps,
): Promise<ScheduledRun> {
  const pending = starting.get(agent.id);
  if (pending) return pending;
  const next = beginAutomationRun(agent, deps).finally(() =>
    starting.delete(agent.id),
  );
  starting.set(agent.id, next);
  return next;
}

/**
 * Stop on a run whose turn no window is taking (Aven quit during it):
 * nothing else will settle it, so it ends here as stopped. Returns whether
 * it did.
 */
export function stopUnattendedRun(runId: string, now = Date.now()): boolean {
  const run = getScheduledRun(runId);
  if (run?.status !== "running" || liveRuns.has(runId)) return false;
  updateScheduledRun(runId, { status: "cancelled", finishedAt: now });
  return true;
}

/** Asks every window to stop a run's turn; payload: the run's id. */
export const RUN_STOP_EVENT = "aven:automation-run-stop";
/** The window taking that turn answers that it stops it. */
export const RUN_STOP_CLAIM_EVENT = "aven:automation-run-stop-claim";
/** How long Stop waits for the window taking the turn to answer. */
export const RUN_STOP_WAIT_MS = 400;

/** How windows tell each other about Stop; null with no other windows. */
export type RunStopEvents = {
  emit: (event: string, runId: string) => Promise<void>;
  listen: (
    event: string,
    handler: (runId: string) => void,
  ) => Promise<() => void>;
};

function windowEvents(): RunStopEvents | null {
  if (!isTauri()) return null;
  return {
    emit: (event, runId) => emit(event, runId),
    listen: (event, handler) =>
      listen<string>(event, ({ payload }) => {
        if (typeof payload === "string") handler(payload);
      }),
  };
}

/**
 * Stop on a run. The window taking its turn stops the chat there, and the
 * turn settles the run as stopped; this may be another window, which is
 * asked. A run no window is taking (Aven quit during it) is marked stopped
 * here. Resolves with where it stopped.
 */
export async function stopAutomationRun(
  runId: string,
  stopChat: (sessionId: string) => void,
  {
    events = windowEvents(),
    waitMs = RUN_STOP_WAIT_MS,
    now = Date.now,
  }: {
    events?: RunStopEvents | null;
    waitMs?: number;
    now?: () => number;
  } = {},
): Promise<"here" | "elsewhere" | "nowhere" | null> {
  const run = getScheduledRun(runId);
  if (run?.status !== "running") return null;
  const live = liveRuns.get(runId);
  if (live) {
    stopChat(live);
    return "here";
  }
  if (events) {
    let answer: () => void = () => {};
    const answered = new Promise<boolean>((resolve) => {
      answer = () => resolve(true);
      setTimeout(() => resolve(false), waitMs);
    });
    const stopListening = await events
      .listen(RUN_STOP_CLAIM_EVENT, (id) => {
        if (id === runId) answer();
      })
      .catch((error: unknown) => {
        logError("Couldn't hear back about stopping a run", error);
        return () => {};
      });
    try {
      await events.emit(RUN_STOP_EVENT, runId);
      if (await answered) return "elsewhere";
    } catch (error) {
      logError("Couldn't ask other windows to stop a run", error);
    } finally {
      stopListening();
    }
  }
  if (run.sessionId) stopChat(run.sessionId);
  return stopUnattendedRun(runId, now()) ? "nowhere" : null;
}

/**
 * Answers other windows' Stop for a run whose turn this window is taking:
 * says so, and stops its chat here. Returns how to stop listening.
 */
export function answerRunStops(
  stopChat: (sessionId: string) => void,
  events: RunStopEvents | null = windowEvents(),
): () => void {
  if (!events) return () => {};
  let stopListening: (() => void) | null = null;
  let gone = false;
  void events
    .listen(RUN_STOP_EVENT, (runId) => {
      const sessionId = liveRuns.get(runId);
      if (!sessionId) return;
      void events
        .emit(RUN_STOP_CLAIM_EVENT, runId)
        .catch((error: unknown) => logError("Couldn't answer a Stop", error));
      stopChat(sessionId);
    })
    .then(
      (unlisten) => {
        if (gone) unlisten();
        else stopListening = unlisten;
      },
      (error: unknown) => logError("Couldn't listen for Stop", error),
    );
  return () => {
    gone = true;
    stopListening?.();
  };
}

async function beginAutomationRun(
  agent: ScheduledAgent,
  deps: AutomationRunDeps,
): Promise<ScheduledRun> {
  const now = deps.now ?? Date.now;
  const id = deps.id ?? (() => crypto.randomUUID());
  const base = {
    id: id(),
    scheduleId: agent.id,
    name: agent.name,
    project: agent.project,
    summary: "",
    startedAt: now(),
    inAutomations: true as const,
  };
  let folder = agent.project;
  if (!folder.trim()) {
    try {
      folder = await deps.noProjectFolder();
    } catch {
      folder = "";
    }
  }
  const problem = await (
    deps.problem ??
    ((item, where) => scheduledAgentProblem(item, undefined, where))
  )(agent, folder);
  if (problem) {
    const failed: ScheduledRun = {
      ...base,
      status: "failed",
      error: problem,
      finishedAt: now(),
    };
    saveScheduledRun(failed);
    // It needs you as much as a run that failed on its way.
    deps.notify?.({ kind: "failed", run: failed });
    return failed;
  }
  const session: Session = {
    ...newSession(agent.harness, folder, agent.model, agent.runtimeMode),
    title: automationChatTitle(agent),
  };
  const run: ScheduledRun = {
    ...base,
    project: folder,
    sessionId: session.id,
    status: "running",
  };
  // Saved before the chat exists, so no list ever shows it as a chat.
  saveScheduledRun(run);
  liveRuns.set(run.id, session.id);
  deps.addChat(session);
  let settled = false;
  const settle = (outcome: ControlOutcome) => {
    if (settled) return;
    settled = true;
    liveRuns.delete(run.id);
    const saved = settleAutomationRun(
      run.id,
      outcome,
      deps.blocks(session.id),
      now(),
    );
    if (saved) noticeFor(saved, session, run.startedAt, deps.notify);
  };
  try {
    const accepted = deps.submit(
      session,
      { text: automationPrompt(agent.prompt), displayText: agent.prompt },
      settle,
    );
    if (accepted === false)
      settle({
        status: "failed",
        text: "",
        error: "The agent could not start this run.",
      });
  } catch (error) {
    settle({
      status: "failed",
      text: "",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return run;
}

/**
 * Why a card's answer can't go to the run's chat now, in plain words, or
 * null when it can. The card shows it rather than doing nothing.
 */
export function cardAnswerProblem(
  session: Pick<Session, "busy" | "queuedMessages"> | null | undefined,
): string | null {
  if (!session) return "Aven couldn’t open this run’s chat.";
  if (session.busy || session.queuedMessages?.length)
    return "The run’s chat is busy. Try again once it finishes.";
  return null;
}

/**
 * Whether a card's button can be pressed: the card is still open and the
 * run is not already taking a turn.
 */
export function canAnswerCard(run: ScheduledRun | undefined): boolean {
  return (
    !!run?.sessionId &&
    run.review?.status === "open" &&
    run.status !== "running"
  );
}

/**
 * Your answer to a run's card: Aven's own words for the card's kind
 * ("Publish the draft now."), never the agent's, sent to the run's chat as a
 * new turn that stays in Automations like the run did. The card is done at
 * once, so a second press sends nothing; the run reads as running from now,
 * then as the turn ends. Returns whether anything was sent.
 */
export function continueAutomationRun(
  runId: string,
  deps: Pick<AutomationRunDeps, "blocks" | "notify" | "now"> & {
    submit: (
      sessionId: string,
      text: string,
      settle: (outcome: ControlOutcome) => void,
    ) => boolean | void;
    session: Session;
  },
): boolean {
  const now = deps.now ?? Date.now;
  // Read again: the card may have been answered, or the run may be working,
  // since the button was drawn.
  const run = getScheduledRun(runId);
  if (!canAnswerCard(run) || run!.sessionId !== deps.session.id) return false;
  const review = run!.review!;
  const sessionId = run!.sessionId!;
  const turnStartedAt = now();
  updateScheduledRun(runId, {
    status: "running",
    error: undefined,
    finishedAt: undefined,
    turnStartedAt,
    review: { ...review, status: "done", resolvedAt: turnStartedAt },
  });
  liveRuns.set(runId, sessionId);
  let settled = false;
  const settle = (outcome: ControlOutcome) => {
    if (settled) return;
    settled = true;
    liveRuns.delete(runId);
    const saved = settleAutomationRun(
      runId,
      outcome,
      deps.blocks(sessionId),
      now(),
    );
    if (saved) noticeFor(saved, deps.session, turnStartedAt, deps.notify);
  };
  try {
    if (deps.submit(sessionId, reviewAction(review).message, settle) === false)
      settle({
        status: "failed",
        text: "",
        error: "The agent could not take this turn.",
      });
  } catch (error) {
    settle({
      status: "failed",
      text: "",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
}
