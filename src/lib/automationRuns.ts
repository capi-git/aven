import {
  automationPrompt,
  parseAutomationReview,
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
import { newSession, type Block, type Session } from "./session";

/**
 * Starting an automation run. The run gets a chat of its own, which stays in
 * Automations: it is added to the workspace with no tab, kept out of the
 * chats list (see `automationChatIds`), and its turn posts nothing to
 * Activity. You hear about a run only when it needs you: it failed, or it
 * left a card to review. Approvals and questions still reach you as they do
 * from any chat.
 */

/** Why a run tells you about itself, if it does. */
export type AutomationRunNotice = {
  kind: "failed" | "review";
  run: ScheduledRun;
  session: Session;
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

/** Start one run of `agent` now. Resolves with the run as first saved. */
export async function startAutomationRun(
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
  };
  let folder = agent.project;
  let problem: string | null = null;
  if (!folder.trim()) {
    try {
      folder = await deps.noProjectFolder();
    } catch {
      folder = "";
    }
  }
  problem = await (
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
  deps.addChat(session);
  let settled = false;
  const settle = (outcome: ControlOutcome) => {
    if (settled) return;
    settled = true;
    const saved = settleAutomationRun(
      run.id,
      outcome,
      deps.blocks(session.id),
      now(),
    );
    if (!saved) return;
    if (saved.status === "failed")
      deps.notify?.({ kind: "failed", run: saved, session });
    else if (
      saved.review?.status === "open" &&
      saved.review.postedAt >= run.startedAt
    )
      deps.notify?.({ kind: "review", run: saved, session });
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
 * Your answer to a run's card ("Publish"): sent to the run's chat as a new
 * turn, which stays in Automations like the run did. The run reads as
 * running again, then as the turn ends; the card is done.
 */
export function continueAutomationRun(
  run: ScheduledRun,
  message: string,
  deps: Pick<AutomationRunDeps, "blocks" | "notify" | "now"> & {
    submit: (
      sessionId: string,
      text: string,
      settle: (outcome: ControlOutcome) => void,
    ) => boolean | void;
    session: Session;
  },
) {
  const now = deps.now ?? Date.now;
  if (!run.sessionId) return;
  const review = run.review
    ? { ...run.review, status: "done" as const, resolvedAt: now() }
    : undefined;
  updateScheduledRun(run.id, {
    status: "running",
    error: undefined,
    finishedAt: undefined,
    ...(review ? { review } : {}),
  });
  const startedAt = now();
  let settled = false;
  const settle = (outcome: ControlOutcome) => {
    if (settled) return;
    settled = true;
    const saved = settleAutomationRun(
      run.id,
      outcome,
      deps.blocks(run.sessionId!),
      now(),
    );
    if (!saved) return;
    if (saved.status === "failed")
      deps.notify?.({ kind: "failed", run: saved, session: deps.session });
    else if (
      saved.review?.status === "open" &&
      saved.review.postedAt >= startedAt
    )
      deps.notify?.({ kind: "review", run: saved, session: deps.session });
  };
  try {
    if (deps.submit(run.sessionId, message, settle) === false)
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
}
