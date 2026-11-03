import { useEffect, useReducer, useRef } from "react";

/**
 * Re-render the caller once at `at` (epoch ms), for words that change on
 * their own at a known time: a countdown's next second, a threshold. Keep
 * callers small; nothing ticks while `at` is undefined, or once `at` has
 * passed, however long the caller goes on passing it.
 */
export function useWakeAt(at: number | undefined): void {
  const [wakes, wake] = useReducer((count: number) => count + 1, 0);
  const passed = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (at === undefined || passed.current === at) return;
    const timer = setTimeout(
      () => {
        if (Date.now() >= at) passed.current = at;
        wake();
      },
      Math.max(0, at - Date.now()),
    );
    return () => clearTimeout(timer);
    // `wakes` re-arms a timer that fired a moment early for the same time.
  }, [at, wakes]);
}
