import { effectiveCssZoom } from "./drag";
import { MOTION_EASE, MOTION_MS, motionReduced, playMotion } from "./motion";

/**
 * Rows that glide to a new place (FLIP). A list's direct children carry
 * `data-motion-key`; when their order, membership or state changes, each row
 * that stays is drawn where it was and glides to where it is now by a
 * transform, and each new row fades in. Layout is never animated, the DOM
 * order and focus are React's, and nothing is measured unless the keys
 * changed.
 */
export const MOTION_KEY_ATTRIBUTE = "data-motion-key";

/** More changes than this at once is a new list, which simply appears. */
const MAX_CHANGED_ROWS = 8;

export type RowSnapshot = {
  /** Where each row was, in viewport pixels. */
  rects: Map<string, DOMRect>;
  /** Rows that were not there before. */
  added: Set<string>;
};

function rowsOf(list: HTMLElement): HTMLElement[] {
  return [...list.children].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.hasAttribute(MOTION_KEY_ATTRIBUTE),
  );
}

export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/**
 * Before React changes the list: where its rows are, or null when nothing
 * should move (motion is off, the list is not on screen, or it is a new
 * list rather than a few rows changing).
 */
export function captureRows(
  list: HTMLElement | null,
  before: readonly string[],
  after: readonly string[],
): RowSnapshot | null {
  if (!list || motionReduced() || !list.isConnected) return null;
  const was = new Set(before);
  const added = new Set(after.filter((key) => !was.has(key)));
  const kept = after.length - added.size;
  const removed = before.length - kept;
  if (
    kept === 0 ||
    kept * 2 < before.length ||
    added.size + removed > MAX_CHANGED_ROWS
  )
    return null;
  if (!list.getClientRects().length) return null;
  const rects = new Map<string, DOMRect>();
  for (const row of rowsOf(list))
    rects.set(
      row.getAttribute(MOTION_KEY_ATTRIBUTE)!,
      row.getBoundingClientRect(),
    );
  return { rects, added };
}

const glides = new WeakMap<Element, Animation>();

/** After React changed the list: each kept row glides, each new row fades in. */
export function playRows(list: HTMLElement | null, snapshot: RowSnapshot) {
  if (!list || motionReduced()) return;
  const rows = rowsOf(list);
  // A glide still running is drawn where it is now (the snapshot saw that),
  // and its new glide starts from there.
  for (const row of rows) glides.get(row)?.cancel();
  // Read every new place first, then start animations, so starting one
  // never makes the next read lay the list out again.
  let zoom: number | null = null;
  const moves: { row: HTMLElement; x: number; y: number }[] = [];
  const fades: HTMLElement[] = [];
  for (const row of rows) {
    const key = row.getAttribute(MOTION_KEY_ATTRIBUTE)!;
    const first = snapshot.rects.get(key);
    if (!first) {
      if (snapshot.added.has(key)) fades.push(row);
      continue;
    }
    const last = row.getBoundingClientRect();
    const x = first.left - last.left;
    const y = first.top - last.top;
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
    zoom ??= effectiveCssZoom(list);
    moves.push({ row, x: x / zoom, y: y / zoom });
  }
  for (const row of fades) playMotion(row, "fade");
  for (const { row, x, y } of moves) {
    if (typeof row.animate !== "function") continue;
    const animation = row.animate(
      [{ transform: `translate3d(${x}px, ${y}px, 0)` }, { transform: "none" }],
      { duration: MOTION_MS.glide, easing: MOTION_EASE.out },
    );
    glides.set(row, animation);
    // A glide cut short by the next change rejects `finished`; that is fine.
    void animation.finished?.catch(() => {});
    animation.onfinish = () => {
      if (glides.get(row) === animation) glides.delete(row);
    };
  }
}
