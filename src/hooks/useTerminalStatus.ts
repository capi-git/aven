import { useEffect, useRef, type RefObject } from "react";
import { getPtyStatus } from "../lib/pty";

/** Presentation is independent of keyboard focus: visible splits still poll. */
export function useTerminalStatus(
  id: string,
  presented: boolean,
  ready: RefObject<boolean>,
  onStatus: (foreground: string | null) => void,
) {
  const latest = useRef(onStatus);
  latest.current = onStatus;
  const inFlight = useRef(false);
  useEffect(() => {
    if (!presented) return;
    let disposed = false;
    let last: string | null | undefined;
    const refresh = () => {
      if (disposed || !ready.current || document.hidden || inFlight.current)
        return;
      inFlight.current = true;
      void getPtyStatus(id)
        .then(({ foreground }) => {
          if (disposed || document.hidden) return;
          const value = foreground?.trim() || null;
          if (value === last) return;
          last = value;
          latest.current(value);
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight.current = false;
        });
    };
    refresh();
    const timer = setInterval(refresh, 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [id, presented, ready]);
}
