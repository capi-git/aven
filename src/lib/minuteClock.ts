/**
 * A wall clock that ticks once a minute, shared by everything showing a
 * relative time. One timer runs only while something is subscribed, so a
 * screen of "5m ago" labels costs one wakeup a minute and nothing once it
 * closes.
 */
const MINUTE = 60_000;
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule() {
  // Land just after the next minute boundary, so labels turn over together.
  const wait = MINUTE - (Date.now() % MINUTE) + 50;
  timer = setTimeout(() => {
    now = Date.now();
    for (const listener of listeners) listener();
    schedule();
  }, wait);
}

function catchUp() {
  if (Math.abs(Date.now() - now) >= 30_000) now = Date.now();
}

export function subscribeMinuteClock(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    catchUp();
    schedule();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

/**
 * The time of the last tick. With nobody subscribed it catches up first, so
 * the first render after a quiet spell is current; while subscribed it only
 * changes on a tick, which keeps every reader in one render consistent.
 */
export function minuteClockNow(): number {
  if (listeners.size === 0) catchUp();
  return now;
}
