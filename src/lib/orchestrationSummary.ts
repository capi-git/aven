import type { OrchestrationRun, TaskStatus } from "./orchestration";
import { sessionNeedsInput, type HarnessId, type Session } from "./session";
import { pendingRequestKey } from "./teamAttention";

/** Small history projection; never includes prompts, results or credentials. */
export type OrchestrationSummary = {
  status: OrchestrationRun["status"];
  live?: boolean;
  tasks: {
    sessionId: string;
    title: string;
    harness: HarnessId;
    model: string;
    status: TaskStatus;
    /** Blocked on an approval or a question that the lead answers. */
    needsInput?: boolean;
    /** The lead left that request unanswered, so it was handed to you. */
    handedToYou?: boolean;
  }[];
};

export function summarizeOrchestration(
  run: OrchestrationRun,
  sessions: readonly Session[],
): OrchestrationSummary {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return {
    status: run.status,
    live: true,
    tasks: run.tasks.map(
      ({ sessionId, title, harness, model, status, escalated }) => {
        const session = byId.get(sessionId);
        const needsInput = !!session && sessionNeedsInput(session);
        return {
          sessionId,
          title,
          harness,
          model,
          status,
          needsInput,
          ...(needsInput &&
          escalated &&
          session &&
          pendingRequestKey(session) === escalated
            ? { handedToYou: true }
            : {}),
        };
      },
    ),
  };
}

/** One word for a run, as a person would say it. */
export function orchestrationStatusWord(
  status: OrchestrationRun["status"],
): string {
  return {
    active: "Running",
    paused: "Paused",
    finished: "Finished",
    stopped: "Stopped",
  }[status];
}

export function orchestrationTaskLabel(
  task: OrchestrationSummary["tasks"][number],
  summary: OrchestrationSummary,
): string {
  // An agent's approval or question is the lead's to answer, not yours,
  // until the lead leaves it and it is handed to you.
  if (task.needsInput && summary.status === "active")
    return task.handedToYou ? "Needs you" : "Lead deciding";
  // Read back from an earlier session: whatever was going on was cut short.
  if (
    !summary.live &&
    (task.status === "running" || task.status === "cancelling")
  )
    return "Interrupted";
  if (!summary.live && task.status === "queued") return "Not started";
  if (summary.status === "paused" && task.status === "queued") return "Paused";
  return {
    queued: "Queued",
    running: "Working",
    cancelling: "Stopping",
    completed: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
  }[task.status];
}

/**
 * "3 done · 1 cancelled": cancelled tasks are left out of what had to be
 * done, so a finished run never reads as if one task is still missing.
 */
export function orchestrationProgress(summary: OrchestrationSummary): string {
  const count = (status: TaskStatus) =>
    summary.tasks.filter((task) => task.status === status).length;
  const done = count("completed");
  const failed = count("failed");
  const cancelled = count("cancelled");
  const counted = summary.tasks.length - cancelled;
  return [
    done === counted ? `${done} done` : `${done}/${counted} done`,
    failed ? `${failed} failed` : "",
    cancelled ? `${cancelled} cancelled` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function timeAgo(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return "";
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** "Finished · 4 agents · 2h ago": an ended run's card, folded to a line. */
export function orchestrationFoldedLine(
  summary: OrchestrationSummary,
  endedAt: number | undefined,
  now: number,
): string {
  const agents = `${summary.tasks.length} ${summary.tasks.length === 1 ? "agent" : "agents"}`;
  const when = endedAt === undefined ? "" : timeAgo(endedAt, now);
  return [orchestrationStatusWord(summary.status), agents, when]
    .filter(Boolean)
    .join(" · ");
}

/** A run that is over keeps only a one-line card until it is opened. */
export function orchestrationEnded(summary: OrchestrationSummary): boolean {
  return summary.status === "finished" || summary.status === "stopped";
}

/**
 * What the macOS floating sidebar needs of the runs: their states, errors
 * and task rows, without prompts, results, retry receipts or the control
 * path. The full runs hold up to 40 results of 20,000 characters each, and
 * the workspace re-sends the sidebar's snapshot after every render.
 */
export function sidebarRuns(
  runs: readonly OrchestrationRun[],
): OrchestrationRun[] {
  return runs.map(sidebarRun);
}

const slimRuns = new WeakMap<OrchestrationRun, OrchestrationRun>();
function sidebarRun(run: OrchestrationRun): OrchestrationRun {
  let slim = slimRuns.get(run);
  if (!slim) {
    slim = {
      ...run,
      cli: "",
      allowedModels: undefined,
      requests: {},
      tasks: run.tasks.map((task) => ({
        ...task,
        prompt: "",
        result: "",
        files: [],
        scopes: [],
      })),
    };
    slimRuns.set(run, slim);
  }
  return slim;
}

let lastSidebarRuns:
  { runs: readonly OrchestrationRun[]; encoded: unknown } | undefined;
/** Encoded once per change of the run list, not once per workspace render. */
export function encodedSidebarRuns(
  runs: readonly OrchestrationRun[],
  encode: (value: unknown) => unknown,
): unknown {
  if (lastSidebarRuns?.runs !== runs)
    lastSidebarRuns = { runs, encoded: encode(sidebarRuns(runs)) };
  return lastSidebarRuns.encoded;
}
