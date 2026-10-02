export type ScheduledFlush = {
  kind: "raf" | "timeout";
  id: number;
  /** Paced for output nobody is looking at; visible output may preempt it. */
  background?: boolean;
};

/**
 * Streamed text reads smoothly at about 30 updates per second. Each flush
 * re-renders the workspace, so pacing it by time rather than by display frame
 * keeps 120 Hz displays from doubling that work while scrolling and animation
 * still run at the full refresh rate.
 */
export const STREAM_FLUSH_INTERVAL_MS = 32;

/**
 * Output for sessions that are not on screen still has to advance (badges,
 * turn completion, persistence), but not by re-rendering the workspace at the
 * foreground rate.
 */
export const BACKGROUND_STREAM_FLUSH_INTERVAL_MS = 100;

export function cancelScheduledFlush(handle: ScheduledFlush | null) {
  if (!handle) return;
  if (handle.kind === "raf") cancelAnimationFrame(handle.id);
  else clearTimeout(handle.id);
}

/** Schedule the next flush no sooner than the interval after `lastFlushAt`. */
export function scheduleStreamFlush(
  run: () => void,
  lastFlushAt: number,
  now = performance.now(),
  foreground = true,
): ScheduledFlush {
  if (!foreground) {
    return {
      kind: "timeout",
      id: window.setTimeout(run, BACKGROUND_STREAM_FLUSH_INTERVAL_MS),
      background: true,
    };
  }
  if (document.hidden) {
    return {
      kind: "timeout",
      id: window.setTimeout(run, STREAM_FLUSH_INTERVAL_MS),
    };
  }
  const wait = lastFlushAt + STREAM_FLUSH_INTERVAL_MS - now;
  // Within one frame of the deadline, align with the next paint instead.
  if (wait <= 8) return { kind: "raf", id: requestAnimationFrame(run) };
  return { kind: "timeout", id: window.setTimeout(run, wait) };
}
