import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { canDeferStreamCommit, createLiveSessionStore } from "../lib/liveSessions";
import type { Session } from "../lib/session";

/** Visible transcripts update immediately; workspace chrome catches up at most four times a second. */
const TRANSCRIPT_COMMIT_INTERVAL_MS = 250;

/** Owns live and committed session state in one place. All mutations read the newest state. */
export function useWorkspaceSessions(initial: () => Session[]) {
  const [sessions, setCommittedSessions] = useState(initial);
  const sessionsRef = useRef(sessions);
  const [liveSessions] = useState(() => createLiveSessionStore(sessions));
  const transcriptCommit = useRef<number | null>(null);
  const cancelCommit = useCallback(() => {
    if (transcriptCommit.current !== null) {
      clearTimeout(transcriptCommit.current);
      transcriptCommit.current = null;
    }
  }, []);
  const commitSessions = useCallback((next: Session[]) => {
    cancelCommit();
    sessionsRef.current = next;
    liveSessions.set(next);
    setCommittedSessions(next);
  }, [cancelCommit, liveSessions]);
  const setSessions = useCallback((action: SetStateAction<Session[]>) => {
    commitSessions(typeof action === "function" ? action(sessionsRef.current) : action);
  }, [commitSessions]);
  const flushCommittedSessions = useCallback(() => {
    if (transcriptCommit.current === null) return;
    cancelCommit();
    setCommittedSessions(sessionsRef.current);
  }, [cancelCommit]);
  const commitStream = useCallback((next: Session[], externallyRendered: ReadonlySet<string>) => {
    if (!canDeferStreamCommit(sessionsRef.current, next, externallyRendered)) {
      commitSessions(next);
      return;
    }
    sessionsRef.current = next;
    liveSessions.set(next);
    transcriptCommit.current ??= window.setTimeout(flushCommittedSessions, TRANSCRIPT_COMMIT_INTERVAL_MS);
  }, [commitSessions, liveSessions, flushCommittedSessions]);
  useEffect(() => cancelCommit, [cancelCommit]);
  return { sessions, sessionsRef, liveSessions, setSessions, commitStream, flushCommittedSessions };
}
