/**
 * Retained hidden workspace surfaces keep their layout for instant switching,
 * but WebKit keeps a full render tree for each of them. A surface that stays
 * hidden long enough is demoted to `display: none`, which frees that tree
 * while React state and the DOM survive. Scroll offsets do not survive
 * `display: none`, so they are captured before demotion and restored after.
 */

export const HIDDEN_SURFACE_DEMOTE_MS = 3 * 60_000;

export type ScrollOffsets = Map<Element, { top: number; left: number }>;

export function captureScrollOffsets(root: Element): ScrollOffsets {
  const saved: ScrollOffsets = new Map();
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (element.scrollTop > 0 || element.scrollLeft > 0)
      saved.set(element, { top: element.scrollTop, left: element.scrollLeft });
  }
  return saved;
}

export function restoreScrollOffsets(saved: ScrollOffsets) {
  for (const [element, { top, left }] of saved) {
    if (!element.isConnected) continue;
    if (element.scrollTop !== top) element.scrollTop = top;
    if (element.scrollLeft !== left) element.scrollLeft = left;
  }
}

/** Tracks how long each hidden surface has been hidden. */
export class HiddenSurfaceClock {
  private hiddenSince = new Map<string, number>();

  /** Record the current hidden set; newly hidden ids start their clock now. */
  update(hiddenIds: Iterable<string>, now: number) {
    const next = new Set(hiddenIds);
    for (const id of this.hiddenSince.keys()) {
      if (!next.has(id)) this.hiddenSince.delete(id);
    }
    for (const id of next) {
      if (!this.hiddenSince.has(id)) this.hiddenSince.set(id, now);
    }
  }

  /** Ids hidden for at least `age` milliseconds. */
  due(now: number, age = HIDDEN_SURFACE_DEMOTE_MS): string[] {
    return [...this.hiddenSince]
      .filter(([, since]) => now - since >= age)
      .map(([id]) => id);
  }

  /** Every hidden id, for immediate demotion under memory pressure. */
  all(): string[] {
    return [...this.hiddenSince.keys()];
  }

  get size() {
    return this.hiddenSince.size;
  }
}
