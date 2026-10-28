/**
 * The window's strip as a place to let go of a tab dragged from a pane's
 * header. Each drags in its own title bar, so they meet here: the strip says
 * where a tab let go over it would stand and shows that place; a pane's
 * header asks while its tab is held, and puts it there on release.
 */
export type WindowStripZone = {
  /**
   * Where a tab let go at (x, y), in client pixels, would stand: before the
   * entry `before`, or at the end (null). Null when (x, y) is not over the
   * strip.
   */
  slotAt: (x: number, y: number) => { before: string | null } | null;
  /** Show where a tab held at `x` would stand, or nothing (null). */
  show: (x: number | null) => void;
};

let zone: WindowStripZone | null = null;

/** The window's strip takes tabs from panes; returns the release. */
export function setWindowStripZone(next: WindowStripZone): () => void {
  zone = next;
  return () => {
    if (zone !== next) return;
    next.show(null);
    zone = null;
  };
}

export function windowStripZone(): WindowStripZone | null {
  return zone;
}
