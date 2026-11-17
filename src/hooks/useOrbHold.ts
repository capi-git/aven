import { useSyncExternalStore } from "react";

/**
 * Whether Aven's orbs hold still now: the window is hidden, something is
 * being resized, or Aven has been left alone a minute (`data-still`, which
 * holds only orbs that are not working). One observer on the root for
 * every orb, so a page full of them adds nothing per orb.
 */
export type OrbHold = { all: boolean; resting: boolean };

const NONE: OrbHold = { all: false, resting: false };
let current: OrbHold = NONE;
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function read(): OrbHold {
  const root = document.documentElement;
  const all =
    root.hasAttribute("data-hidden") ||
    root.classList.contains("is-resizing") ||
    root.classList.contains("is-window-resizing");
  const resting = all || root.hasAttribute("data-still");
  return all === current.all && resting === current.resting
    ? current
    : { all, resting };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!observer && typeof MutationObserver !== "undefined") {
    current = read();
    observer = new MutationObserver(() => {
      const next = read();
      if (next === current) return;
      current = next;
      for (const notify of listeners) notify();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-hidden", "data-still", "class"],
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

const snapshot = () => current;
const serverSnapshot = () => NONE;

export function useOrbHold(): OrbHold {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
