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
 * long turn's claim from expiring. Each refresh carries the chats' latest
 * progress fingerprint, so the host can release a turn stuck for hours.
 */
export function useAgentKeepAwake(
  workingSessionIds: ReadonlySet<string>,
  progress = "",
  report: (
    enabled: boolean,
    sessionIds: readonly string[],
    progress: string,
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
        sessions.length ? progressRef.current : "",
      );
    send();
    if (!sessions.length) return;
    const timer = window.setInterval(send, AGENT_KEEP_AWAKE_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [enabled, key]);
  useEffect(
    () => () => void reportRef.current(loadAgentKeepAwake(), [], ""),
    [],
  );
}
