/**
 * Coalesces refreshes that many events can trigger (git changes every few
 * seconds while an agent edits, window focus, visibility): at most one load
 * runs at a time, and automatic ones start no closer together than
 * `minIntervalMs`. A request inside that window runs once when it ends.
 */
export function createRefreshGate(
  load: () => Promise<unknown>,
  minIntervalMs: number,
  now: () => number = Date.now,
) {
  let inFlight = false;
  let pending = false;
  let lastStart = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const start = () => {
    if (stopped) return;
    inFlight = true;
    pending = false;
    lastStart = now();
    void load()
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
        if (pending) request();
      });
  };

  /** Ask for a refresh; `force` skips the interval (a user action). */
  const request = (force = false) => {
    if (stopped) return;
    if (inFlight) {
      pending = true;
      return;
    }
    const wait = lastStart + minIntervalMs - now();
    if (force || wait <= 0) {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      start();
      return;
    }
    pending = true;
    timer ??= setTimeout(() => {
      timer = undefined;
      if (pending) request();
    }, wait);
  };

  return {
    request,
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
