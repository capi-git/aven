import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  claimScheduledSlot,
  listScheduledAgents,
  loadKeepAwake,
  runDueScheduledAgents,
  setSystemKeepAwake,
  subscribeKeepAwake,
  subscribeScheduledAgents,
  wantsKeepAwake,
  type ScheduledAgent,
} from "../lib/scheduledAgents";

export const SCHEDULE_CHECK_MS = 30_000;
/** Give a restored window time to settle before a missed schedule fires. */
export const SCHEDULE_FIRST_CHECK_MS = 5_000;

/**
 * Start due scheduled agents while this window is open. Hidden windows have
 * their timers throttled, so each check compares due times with the wall
 * clock, and returning to the window checks straight away.
 */
export function useScheduledAgents(
  start: (agent: ScheduledAgent) => void,
  claim: (slot: string) => Promise<boolean> = claimScheduledSlot,
) {
  const startRef = useRef(start);
  startRef.current = start;
  const claimRef = useRef(claim);
  claimRef.current = claim;

  useEffect(() => {
    let checking = false;
    let disposed = false;
    const check = () => {
      if (checking || disposed) return;
      checking = true;
      void runDueScheduledAgents({
        now: Date.now(),
        claim: (slot) => claimRef.current(slot),
        fire: (agent) => {
          if (!disposed) startRef.current(agent);
        },
      })
        .catch(() => {
          // A failed check is retried on the next tick.
        })
        .finally(() => {
          checking = false;
        });
    };
    const first = window.setTimeout(check, SCHEDULE_FIRST_CHECK_MS);
    const timer = window.setInterval(check, SCHEDULE_CHECK_MS);
    const onVisible = () => {
      if (!document.hidden) check();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

export function useKeepAwakeSetting(): boolean {
  return useSyncExternalStore(subscribeKeepAwake, loadKeepAwake);
}

/**
 * Hold off idle sleep while the setting is on and an automation is waiting.
 * Every window sends the same answer, so the host keeps a single hold.
 */
export function useAutomationsKeepAwake(
  apply: (enabled: boolean) => Promise<void> | void = setSystemKeepAwake,
) {
  const on = useKeepAwakeSetting();
  const agents = useSyncExternalStore(
    subscribeScheduledAgents,
    listScheduledAgents,
  );
  const wanted = wantsKeepAwake(on, agents);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    void applyRef.current(wanted);
  }, [wanted]);
}
