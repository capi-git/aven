import { useEffect, useReducer } from "react";

/**
 * Re-render the caller once at `at` (epoch ms), for words that change on
 * their own at a known time: a countdown's next second, a threshold. Keep
 * callers small; nothing ticks while `at` is undefined.
 */
export function useWakeAt(at: number | undefined): void {
  const [wakes, wake] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (at === undefined) return;
    const timer = setTimeout(wake, Math.max(0, at - Date.now()));
    return () => clearTimeout(timer);
    // `wakes` re-arms a timer that fired a moment early for the same time.
  }, [at, wakes]);
}
