import { useSyncExternalStore } from "react";
import { MOTION_ROOT_ATTRIBUTE } from "../lib/motion";

/**
 * Whether Aven's orbs hold still now: the window is hidden, something is
 * being resized, Reduce motion is on (the system's or Aven's own, both
 * marked as `data-motion="reduce"` on the root), or Aven has been left alone
 * a minute (`data-still`, which holds only orbs that are not working). One
 * observer on the root for every orb, so a page full of them adds nothing
 * per orb.
 */
export type OrbHold = {
  all: boolean;
  resting: boolean;
  /** Reduce motion is on: each orb shows a still frame. */
  reduced: boolean;
};

const NONE: OrbHold = { all: false, resting: false, reduced: false };
let current: OrbHold = NONE;
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;
/** Resizes that hold orbs without marking the root (see `holdOrbs`). */
let holds = 0;

function read(): OrbHold {
  const root = document.documentElement;
  const reduced = root.getAttribute(MOTION_ROOT_ATTRIBUTE) === "reduce";
  const all =
    reduced ||
    holds > 0 ||
    root.hasAttribute("data-hidden") ||
    root.classList.contains("is-resizing") ||
    root.classList.contains("is-window-resizing");
  const resting = all || root.hasAttribute("data-still");
  return all === current.all &&
    resting === current.resting &&
    reduced === current.reduced
    ? current
    : { all, resting, reduced };
}

function update() {
  const next = read();
  if (next === current) return;
  current = next;
  for (const notify of listeners) notify();
}

/**
 * Holds every orb still until the returned function is called, for a resize
 * that marks only its own container (a split's divider), so the whole
 * window is never restyled. The release is safe to call more than once.
 */
export function holdOrbs(): () => void {
  holds += 1;
  if (typeof document !== "undefined" && listeners.size > 0) update();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    if (typeof document !== "undefined" && listeners.size > 0) update();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!observer && typeof MutationObserver !== "undefined") {
    current = read();
    observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        "data-hidden",
        "data-still",
        MOTION_ROOT_ATTRIBUTE,
        "class",
      ],
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
