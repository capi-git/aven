/** How long startup work usually takes to settle after the first paint. */
const SETTLE_MS = 1_500;

/**
 * Run `task` once the window is idle after startup: when the browser next
 * reports idle time after `SETTLE_MS`, or after twice that at the latest.
 * WebKit has no `requestIdleCallback`, so there the delay alone decides.
 * Returns a function that cancels the task.
 */
export function whenIdle(task: () => void): () => void {
  let idle: number | undefined;
  const timer = window.setTimeout(() => {
    if (typeof window.requestIdleCallback !== "function") return task();
    idle = window.requestIdleCallback(task, { timeout: SETTLE_MS });
  }, SETTLE_MS);
  return () => {
    window.clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}
