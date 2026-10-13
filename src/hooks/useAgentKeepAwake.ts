import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  AGENT_KEEP_AWAKE_HEARTBEAT_MS,
  agentKeepAwakeSessions,
  loadAgentKeepAwake,
  reportAgentKeepAwake,
  subscribeAgentKeepAwake,
} from "../lib/agentKeepAwake";

export function useAgentKeepAwakeSetting(): boolean {
  return useSyncExternalStore(subscribeAgentKeepAwake, loadAgentKeepAwake);
}

/**
 * Report this window's working chats to the shared native keep-awake hold.
 * The host counts every window's chats together; an empty list (including on
 * unmount) releases this window's claim, and a refresh each minute keeps a
 * long turn's claim from expiring.
 */
export function useAgentKeepAwake(
  busySessionIds: ReadonlySet<string>,
  report: (
    enabled: boolean,
    sessionIds: readonly string[],
  ) => Promise<void> | void = reportAgentKeepAwake,
) {
  const enabled = useAgentKeepAwakeSetting();
  const key = agentKeepAwakeSessions(busySessionIds).join("\n");
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    const sessions = key ? key.split("\n") : [];
    void reportRef.current(enabled, sessions);
    if (!sessions.length) return;
    const timer = window.setInterval(
      () => void reportRef.current(enabled, sessions),
      AGENT_KEEP_AWAKE_HEARTBEAT_MS,
    );
    return () => window.clearInterval(timer);
  }, [enabled, key]);
  useEffect(() => () => void reportRef.current(loadAgentKeepAwake(), []), []);
}
