import { useEffect, useRef, type RefObject } from "react";
import { getPtyStatus } from "../lib/pty";
import { isWindowActive, subscribeWindowActivity } from "../lib/windowActivity";

/** All presented splits poll while their native window is active. */
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
      if (disposed || !ready.current || !isWindowActive() || inFlight.current)
        return;
      inFlight.current = true;
      void getPtyStatus(id)
        .then(({ foreground }) => {
          if (disposed || !isWindowActive()) return;
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
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      if (!isWindowActive()) return;
      refresh();
      timer = setInterval(refresh, 1000);
    };
    const unsubscribe = subscribeWindowActivity(sync);
    sync();
    return () => {
      disposed = true;
      if (timer !== undefined) clearInterval(timer);
      unsubscribe();
    };
  }, [id, presented, ready]);
}
