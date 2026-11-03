import { PROJECT_SIGILS, type DotSigil } from "./dotSigils";

/**
 * Tabs pinned to the start of the window's strip, shown as their mark alone.
 * A pin belongs to the tab, so it comes back with the tab: after a restart, in
 * another window, or with Reopen closed tab. A chat closed and opened again
 * later from the sidebar is a new tab, and starts unpinned.
 */
const KEY = "aven.pinnedTabs.v1";
/** Pins of tabs long closed must not pile up forever. */
const LIMIT = 64;

const listeners = new Set<() => void>();
let cached: ReadonlySet<string> | null = null;

function read(): ReadonlySet<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id) => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function loadPinnedTabs(): ReadonlySet<string> {
  cached ??= read();
  return cached;
}

/** Pins or unpins a tab and returns the pins that now stand. */
export function setTabPinned(id: string, pinned: boolean): ReadonlySet<string> {
  const next = new Set(loadPinnedTabs());
  if (pinned) next.add(id);
  else next.delete(id);
  const kept = [...next].slice(-LIMIT);
  cached = new Set(kept);
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Still pinned in this window; it just won't come back after a restart.
  }
  listeners.forEach((listener) => listener());
  return cached;
}

export function subscribePinnedTabs(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY && event.key !== null) return;
    cached = null;
    listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Pinned tabs first, each side keeping its own order. */
export function pinnedFirst(
  ids: readonly string[],
  pinned: ReadonlySet<string>,
): string[] {
  return [
    ...ids.filter((id) => pinned.has(id)),
    ...ids.filter((id) => !pinned.has(id)),
  ];
}

/**
 * A dot mark for each pinned tab, in the order they were pinned: chosen from
 * the tab's id so it keeps its mark, and moved along if an earlier pin has it.
 */
export function pinnedTabSigils(ids: readonly string[]): Map<string, DotSigil> {
  const taken = new Set<number>();
  const marks = new Map<string, DotSigil>();
  for (const id of ids) {
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    let at = hash % PROJECT_SIGILS.length;
    if (taken.size < PROJECT_SIGILS.length)
      while (taken.has(at)) at = (at + 1) % PROJECT_SIGILS.length;
    taken.add(at);
    marks.set(id, PROJECT_SIGILS[at]);
  }
  return marks;
}
