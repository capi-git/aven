import type { OrchestrationRun, OrchestrationTask } from "./orchestration";
import type { Session } from "./session";

/**
 * What the orchestrator keeps for a lead beside the run itself, which the
 * real-app check reads when a lead was never woken: whether a wake-up is in
 * flight, which blocked requests the lead was told about, and which agents
 * are blocked now (`Orchestrator.inspect`).
 */
export type OrchestrationWakeState = {
  waking: boolean;
  announced: string[];
  blocked: string[];
};

const activeTask = (task: OrchestrationTask) =>
  task.status === "running" || task.status === "cancelling";

/**
 * Whether a run still keeps the other chats in its project from working:
 * it is active or paused, or an agent of its is still running. Such a run
 * left behind by a step that gave up on it would have the next steps' chats
 * refused as "busy with a run", so the step stops it first.
 */
export function runHoldsProject(run: OrchestrationRun | undefined): boolean {
  return (
    !!run &&
    (run.status === "active" ||
      run.status === "paused" ||
      run.tasks.some(activeTask))
  );
}

function quoted(text: string | undefined, limit = 80): string {
  const line = (text ?? "").trim().replace(/\s+/g, " ");
  return `“${line.length > limit ? `${line.slice(0, limit - 1)}…` : line}”`;
}

function chatState(session: Session | undefined): string {
  if (!session) return "chat not open";
  const parts = [session.busy ? "working" : "idle"];
  if (session.queuedMessages?.length)
    parts.push(`${session.queuedMessages.length} queued`);
  if (session.pendingQuestion)
    parts.push(`asking (requestId ${session.pendingQuestion.requestId})`);
  return parts.join(", ");
}

/**
 * Where a run stands, for the error of a step that gave up on it: the run's
 * status and how often its lead was woken, the lead (working or idle, with
 * queued messages, asking, and what it last said), each agent (its task's
 * status, whether its result reached the lead, and whether it waits on a
 * question) and the orchestrator's wake-up state when the check can read
 * it. One line, so the step's detail says which side went quiet.
 */
export function describeOrchestrationRun(
  run: OrchestrationRun | undefined,
  sessions: readonly Session[],
  wake?: OrchestrationWakeState,
): string {
  if (!run) return "no run";
  const session = (id: string) => sessions.find((entry) => entry.id === id);
  const lead = session(run.leadId);
  const lastSaid = [...(lead?.blocks ?? [])]
    .reverse()
    .find((block) => block.role === "assistant" && block.text?.trim())?.text;
  const woken = run.continuations ?? 0;
  const parts = [
    `run ${run.status}${run.error ? ` (${run.error})` : ""}, lead woken ${woken} ${woken === 1 ? "time" : "times"}`,
    `lead ${chatState(lead)}${lastSaid ? `, last said ${quoted(lastSaid)}` : ""}`,
    ...run.tasks.map((task) => {
      const state: string[] = [task.status];
      if (task.accepted) state.push("accepted");
      else if (!task.delivered && !activeTask(task) && task.status !== "queued")
        state.push("result not delivered to the lead");
      if (task.error) state.push(`error ${quoted(task.error)}`);
      return `agent ${quoted(task.title ?? task.id ?? task.sessionId)} ${state.join(", ")}; its ${chatState(session(task.sessionId))}`;
    }),
  ];
  if (wake)
    parts.push(
      `wake-up ${wake.waking ? "in flight" : "not in flight"}, lead told of ${wake.announced.join(", ") || "no request"}, blocked now: ${wake.blocked.join(", ") || "none"}`,
    );
  return parts.join("; ");
}
