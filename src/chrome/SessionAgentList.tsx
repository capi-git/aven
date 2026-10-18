import { AlertCircle, Check, LoaderCircle, Pause, Square } from "./icons";
import type { SessionAgent } from "../lib/session";
import "./SessionAgentList.css";

const agentStatusLabels: Record<SessionAgent["status"], string> = {
  running: "Working",
  waiting: "Waiting",
  completed: "Done",
  failed: "Failed",
  stopped: "Stopped",
  unknown: "Status unknown",
};

/**
 * A chat's agents, one row each with what it does and how it stands: the
 * run status's Agents details, and the team bar's Agents list.
 */
export function SessionAgentList({
  agents,
}: {
  agents: readonly SessionAgent[];
}) {
  return (
    <ul aria-label="Agent status" className="session-run-agent-list">
      {agents.map((agent) => {
        const Icon =
          agent.status === "running"
            ? LoaderCircle
            : agent.status === "completed"
              ? Check
              : agent.status === "waiting"
                ? Pause
                : agent.status === "stopped"
                  ? Square
                  : AlertCircle;
        return (
          <li key={agent.id} data-agent-state={agent.status}>
            <span
              aria-hidden="true"
              className={
                agent.status === "running" ? "session-run-spinner" : undefined
              }
            >
              <Icon className="size-3.5" />
            </span>
            <div className="session-run-agent-copy">
              <strong>{agent.title}</strong>
              {agent.detail ? <span>{agent.detail}</span> : null}
            </div>
            <span className="session-run-agent-label">
              {agentStatusLabels[agent.status]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
