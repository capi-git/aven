import type { BrowserState } from "./browser";

const pages = new Map<string, (state: BrowserState) => void>();
const listeners = new Set<() => void>();
let pauses = 0;

/** Native pages remain mounted while the update snapshots and closes them. */
export function browserUpdatePaused(): boolean {
  return pauses > 0;
}

export function subscribeBrowserUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function pauseBrowsersForUpdate(): () => void {
  pauses += 1;
  if (pauses === 1) for (const listener of listeners) listener();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pauses -= 1;
    if (pauses === 0) for (const listener of listeners) listener();
  };
}

export function registerBrowserUpdatePage(
  nativeId: string,
  receive: (state: BrowserState) => void,
): () => void {
  pages.set(nativeId, receive);
  return () => {
    if (pages.get(nativeId) === receive) pages.delete(nativeId);
  };
}

/** Refresh persisted metadata from the guarded native snapshot, before close. */
export function applyBrowserUpdateStates(states: BrowserState[]): void {
  // Validate the whole snapshot first: an unrepresented page must not be lost.
  for (const state of states) {
    if (!pages.has(state.id))
      throw new Error("A browser tab is still opening. Try restarting again.");
  }
  for (const state of states) pages.get(state.id)!(state);
}
