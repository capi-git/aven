import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import {
  nextUsageReset,
  releaseUsageHold,
  setContinueAtReset,
} from "../lib/messageQueue";
import type { Session } from "../lib/session";

/** "Continue at" turned on or off from a chat's message box. */
export const CONTINUE_AT_RESET_EVENT = "aven:continue-at-reset";

export type ContinueAtResetDetail = { sessionId: string; on: boolean };

/** Ask the workspace to turn "Continue at" on or off for a chat. */
export function requestContinueAtReset(sessionId: string, on: boolean): void {
  window.dispatchEvent(
    new CustomEvent<ContinueAtResetDetail>(CONTINUE_AT_RESET_EVENT, {
      detail: { sessionId, on },
    }),
  );
}

/**
 * A sleeping Mac stops timers, so a long wait looks again at least this
 * often, as well as when the window comes back.
 */
const RECHECK_MS = 60_000;

/**
 * Lets each chat's usage hold go once its limit resets, so its queued
 * messages send (and "Continue at", when on, sends its continue): on a timer
 * set for the next reset, and whenever the window is shown or focused again,
 * as after the Mac wakes. Also applies "Continue at" choices.
 */
export function useUsageHoldRelease(
  sessions: readonly Session[],
  setSessions: Dispatch<SetStateAction<Session[]>>,
): void {
  const nextReset = useMemo(() => nextUsageReset(sessions), [sessions]);

  useEffect(() => {
    if (nextReset === undefined) return;
    const release = () =>
      setSessions((prev) => {
        const now = Date.now();
        let changed = false;
        const next = prev.map((session) => {
          const released = releaseUsageHold(session, now);
          if (released !== session) changed = true;
          return released;
        });
        return changed ? next : prev;
      });
    let timer = 0;
    const schedule = () => {
      const wait = nextReset - Date.now();
      if (wait <= 0) return release();
      timer = window.setTimeout(schedule, Math.min(wait, RECHECK_MS));
    };
    schedule();
    const onVisible = () => {
      if (document.visibilityState === "visible") release();
    };
    window.addEventListener("focus", release);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", release);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [nextReset, setSessions]);

  useEffect(() => {
    const onToggle = (event: Event) => {
      const detail = (event as CustomEvent<ContinueAtResetDetail>).detail;
      if (!detail?.sessionId) return;
      setSessions((prev) => {
        let changed = false;
        const next = prev.map((session) => {
          if (session.id !== detail.sessionId) return session;
          const updated = setContinueAtReset(session, detail.on);
          if (updated !== session) changed = true;
          return updated;
        });
        return changed ? next : prev;
      });
    };
    window.addEventListener(CONTINUE_AT_RESET_EVENT, onToggle);
    return () => window.removeEventListener(CONTINUE_AT_RESET_EVENT, onToggle);
  }, [setSessions]);
}
