/**
 * Tab switches that bring in a native browser page. React swaps workspace
 * surfaces in one frame, but a native page appears only after its layout IPC
 * returns, so for a frame or more neither the old tab nor the new page is on
 * screen and the window background flashes through.
 *
 * An incoming page registers here until the native side confirms it is shown.
 * Meanwhile the outgoing content stays painted underneath: HTML surfaces are
 * held by WorkspaceStage and outgoing native pages delay their hide. A page
 * that never confirms is released after BROWSER_HANDOFF_MAX_MS.
 */

export const BROWSER_HANDOFF_MAX_MS = 300;

const pending = new Map<string, number>();
const listeners = new Set<() => void>();

function prune(now: number) {
  for (const [id, since] of pending) {
    if (now - since >= BROWSER_HANDOFF_MAX_MS) pending.delete(id);
  }
}

function notifyIfSettled() {
  if (pending.size) return;
  for (const listener of [...listeners]) listener();
}

/** An incoming page is about to be shown. Repeated calls keep its start time. */
export function beginBrowserHandoff(id: string, now = Date.now()) {
  if (!pending.has(id)) pending.set(id, now);
}

/** The page is shown, hidden again, or gone. */
export function endBrowserHandoff(id: string) {
  if (pending.delete(id)) notifyIfSettled();
}

export function browserHandoffPending(now = Date.now()): boolean {
  prune(now);
  return pending.size > 0;
}

/**
 * Resolve once no incoming page is waiting, or at the deadline. The first
 * microtask lets every layout effect of the current React commit register
 * its incoming page before the check.
 */
export async function waitForBrowserHandoff(): Promise<void> {
  await Promise.resolve();
  if (!browserHandoffPending()) return;
  const oldest = Math.min(...pending.values());
  const remaining = Math.max(0, oldest + BROWSER_HANDOFF_MAX_MS - Date.now());
  await new Promise<void>((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      listeners.delete(done);
      resolve();
    };
    const timer = window.setTimeout(done, remaining);
    listeners.add(done);
  });
}

/** Test-only reset. */
export function resetBrowserHandoff() {
  pending.clear();
  listeners.clear();
}
