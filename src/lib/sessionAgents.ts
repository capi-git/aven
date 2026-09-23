import type { Session, SessionAgent } from "./session";
import type { OrchestrationRun } from "./orchestration";

export function isActiveSessionAgent(agent: SessionAgent): boolean {
  return agent.status === "running" || agent.status === "waiting";
}

export function activeSessionAgents(session: Session): SessionAgent[] {
  return session.liveAgents?.filter(isActiveSessionAgent) ?? [];
}

export function uncertainSessionAgents(session: Session): SessionAgent[] {
  return session.liveAgents?.filter(agent => agent.status === "unknown") ?? [];
}

export function sessionAgentSummary(agents: readonly SessionAgent[]): string {
  const active = agents.filter(isActiveSessionAgent).length;
  const uncertain = agents.filter(agent => agent.status === "unknown").length;
  const done = agents.filter(agent => agent.status === "completed").length;
  const failed = agents.filter(agent => agent.status === "failed").length;
  const stopped = agents.filter(agent => agent.status === "stopped").length;
  return [
    active ? `${active} active` : "",
    uncertain ? `${uncertain} status unknown` : "",
    done ? `${done} done` : "",
    failed ? `${failed} failed` : "",
    stopped ? `${stopped} stopped` : "",
  ].filter(Boolean).join(" · ");
}

/** Include Aven-managed workers without writing derived state into chat history. */
export function sessionWithManagedAgents(session: Session, runs: readonly OrchestrationRun[], workerAgents: readonly SessionAgent[] = []): Session {
  const run = runs.find(run => run.leadId === session.id);
  const tasks = run?.status === "active" || run?.status === "paused" ? run.tasks : [];
  if (!tasks.length && !workerAgents.length) return session;
  const workers: SessionAgent[] = tasks.map(task => ({
    id: `managed:${task.sessionId}`,
    title: task.title,
    status: task.status === "running" || task.status === "cancelling" ? "running"
      : task.status === "queued" ? "waiting"
      : task.status === "cancelled" ? "stopped" : task.status,
    detail: task.status === "cancelling" ? "Stopping"
      : task.status === "queued" ? (run?.status === "paused" ? "Paused" : "Queued")
      : task.error,
  }));
  return { ...session, liveAgents: [...session.liveAgents ?? [], ...workers, ...workerAgents] };
}
