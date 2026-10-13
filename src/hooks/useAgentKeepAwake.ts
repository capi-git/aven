import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  AGENT_KEEP_AWAKE_HEARTBEAT_MS,
  type AgentKeepAwakeProgress,
  agentKeepAwakeProgressFor,
  agentKeepAwakeSessions,
  loadAgentKeepAwake,
  reportAgentKeepAwake,
  subscribeAgentKeepAwake,
} from "../lib/agentKeepAwake";

const NO_PROGRESS: AgentKeepAwakeProgress = Object.freeze({});

export function useAgentKeepAwakeSetting(): boolean {
  return useSyncExternalStore(subscribeAgentKeepAwake, loadAgentKeepAwake);
}

/**
 * Report this window's working chats to the shared native keep-awake hold.
 * The host counts every window's chats together; an empty list (including on
 * unmount) releases this window's claim, and a refresh each minute keeps a
 * long turn's claim from expiring. Each refresh carries the chats' latest
 * progress fingerprints, so the host can release a turn stuck for hours.
 */
export function useAgentKeepAwake(
  workingSessionIds: ReadonlySet<string>,
  progress: AgentKeepAwakeProgress = NO_PROGRESS,
  report: (
    enabled: boolean,
    sessionIds: readonly string[],
    progress: AgentKeepAwakeProgress,
  ) => Promise<void> | void = reportAgentKeepAwake,
) {
  const enabled = useAgentKeepAwakeSetting();
  const key = agentKeepAwakeSessions(workingSessionIds).join("\n");
  const reportRef = useRef(report);
  reportRef.current = report;
  // Progress changes with every streamed token; read it at report time
  // instead of re-reporting each change.
  const progressRef = useRef(progress);
  progressRef.current = progress;
  useEffect(() => {
    const sessions = key ? key.split("\n") : [];
    const send = () =>
      void reportRef.current(
        enabled,
        sessions,
        agentKeepAwakeProgressFor(progressRef.current, sessions),
      );
    send();
    if (!sessions.length) return;
    const timer = window.setInterval(send, AGENT_KEEP_AWAKE_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [enabled, key]);
  useEffect(
    () => () => void reportRef.current(loadAgentKeepAwake(), [], NO_PROGRESS),
    [],
  );
}
