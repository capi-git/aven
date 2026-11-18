/**
 * What is asleep right now, for the Resources card and the sleep marks on
 * tabs and sidebar rows:
 *
 * - a browser tab is asleep when Memory saver (or the person) released its
 *   page; it reloads when it is shown again;
 * - a chat is awake while its provider process runs. Aven parks idle ones
 *   (see `harness/registry`), and a chat not used since Aven started has no
 *   process yet; both count as asleep. The conversation is kept either way.
 *
 * One small store with a version number, so React reads it through
 * `useSyncExternalStore` without copying sets on every change.
 */

type Listener = () => void;

const sleepingTabs = new Set<string>();
const awakeChats = new Set<string>();
const listeners = new Set<Listener>();
let version = 0;

function changed() {
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function subscribeSleep(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes whenever anything falls asleep or wakes. */
export function sleepVersion(): number {
  return version;
}

export function noteTabSleeping(tabId: string, sleeping: boolean): void {
  if (sleeping === sleepingTabs.has(tabId)) return;
  if (sleeping) sleepingTabs.add(tabId);
  else sleepingTabs.delete(tabId);
  changed();
}

/** The tab closed: it is neither asleep nor awake any more. */
export function forgetTabSleep(tabId: string): void {
  if (sleepingTabs.delete(tabId)) changed();
}

export function isTabAsleep(tabId: string): boolean {
  return sleepingTabs.has(tabId);
}

export function sleepingTabIds(): string[] {
  return [...sleepingTabs];
}

export function noteChatAwake(sessionId: string): void {
  if (awakeChats.has(sessionId)) return;
  awakeChats.add(sessionId);
  changed();
}

export function noteChatAsleep(sessionId: string): void {
  if (awakeChats.delete(sessionId)) changed();
}

/** The chat's provider process runs. */
export function isChatAwake(sessionId: string): boolean {
  return awakeChats.has(sessionId);
}

export function awakeChatIds(): string[] {
  return [...awakeChats];
}

/** Test seam. */
export function resetSleepCenter(): void {
  const had = sleepingTabs.size + awakeChats.size > 0;
  sleepingTabs.clear();
  awakeChats.clear();
  if (had) changed();
}
