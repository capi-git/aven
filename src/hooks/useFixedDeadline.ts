import { useCallback, useEffect, useRef } from "react";

/** Coalesce changing values without postponing the oldest pending work. */
export function useFixedDeadline(drain: () => void, delay: number) {
  const latest = useRef(drain);
  latest.current = drain;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(() => {
    if (timer.current !== undefined) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      latest.current();
    }, delay);
  }, [delay]);
}
