/**
 * Manual scroll anchoring. WebKit has no CSS `overflow-anchor`, so when a
 * scroller's text rewraps at a new width the content above the reading
 * position changes height and the line being read slides away. Capture the
 * element at the top edge while the reader scrolls, then restore it after
 * layout (a ResizeObserver callback runs after layout and before paint).
 */
export type ScrollAnchor = {
  element: Element;
  /** The element's top, relative to the scroller's top edge. */
  offset: number;
  /** The share of the element above the top edge, when it straddles it. */
  ratio: number | null;
  /** The element's width when captured; a change means its text rewrapped. */
  width: number;
  /** The scroll position this anchor describes. */
  scrollTop: number;
};

type Hit = { element: Element; rect: DOMRect };

// Turns → rows → message → markdown blocks → list items stay well inside this.
const MAX_DEPTH = 12;

function isEmpty(rect: DOMRect) {
  return rect.width <= 0 && rect.height <= 0;
}

/** The first child box whose bottom is below `top`, looking through
 * `display: contents` wrappers. Flow children stack in order, so a binary
 * search skips long runs above the edge before the linear check. */
function firstBelow(parent: Element, top: number, depth: number): Hit | null {
  const children = parent.children;
  let lo = 0;
  let hi = children.length;
  while (hi - lo > 8) {
    const mid = (lo + hi) >> 1;
    const rect = children[mid].getBoundingClientRect();
    if (!isEmpty(rect) && rect.bottom <= top) lo = mid + 1;
    else hi = mid;
  }
  for (let index = lo; index < children.length; index++) {
    const element = children[index];
    const rect = element.getBoundingClientRect();
    if (isEmpty(rect)) {
      if (depth >= MAX_DEPTH || !element.childElementCount) continue;
      const nested = firstBelow(element, top, depth + 1);
      if (nested) return nested;
      continue;
    }
    if (rect.bottom > top) return { element, rect };
  }
  return null;
}

/** Nested scrollers move their children on their own; anchor on the box. */
function scrollsItself(element: Element) {
  return element.scrollHeight > element.clientHeight + 1;
}

function viewTop(scroller: HTMLElement) {
  return scroller.getBoundingClientRect().top + scroller.clientTop;
}

function describe(
  element: Element,
  box: { top: number; height: number; width: number },
  top: number,
  scrollTop: number,
): ScrollAnchor {
  const offset = box.top - top;
  return {
    element,
    offset,
    ratio: offset < 0 && box.height > 0 ? -offset / box.height : null,
    width: box.width,
    scrollTop,
  };
}

/** Find the deepest element at the scroller's top edge. */
export function captureScrollAnchor(
  scroller: HTMLElement,
): ScrollAnchor | null {
  if (scroller.clientHeight <= 0) return null;
  const top = viewTop(scroller);
  let parent: Element = scroller;
  let found: Hit | null = null;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const hit = firstBelow(parent, top, depth);
    if (!hit) break;
    found = hit;
    if (
      hit.rect.top >= top ||
      !hit.element.childElementCount ||
      scrollsItself(hit.element)
    )
      break;
    parent = hit.element;
  }
  return found
    ? describe(found.element, found.rect, top, scroller.scrollTop)
    : null;
}

/**
 * Scroll so the anchored content is where the reader left it. A straddling
 * element whose width changed keeps the same share above the edge, which
 * approximates the same line after a rewrap; otherwise its top stays put, so
 * growth below the edge (streaming text, an opened fold) never moves it.
 * Updates `anchor` for the new layout. Returns false when the element can no
 * longer be measured and the caller should capture a new anchor.
 */
export function restoreScrollAnchor(
  scroller: HTMLElement,
  anchor: ScrollAnchor,
): boolean {
  if (scroller.clientHeight <= 0) return true;
  if (!anchor.element.isConnected || !scroller.contains(anchor.element))
    return false;
  const rect = anchor.element.getBoundingClientRect();
  if (isEmpty(rect)) return false;
  const top = viewTop(scroller);
  const reflowed = anchor.ratio !== null && rect.width !== anchor.width;
  const delta = reflowed
    ? rect.top + anchor.ratio! * rect.height - top
    : rect.top - top - anchor.offset;
  const before = scroller.scrollTop;
  if (Math.abs(delta) >= 0.5) scroller.scrollTop = before + delta;
  const moved = scroller.scrollTop - before;
  const next = describe(
    anchor.element,
    { top: rect.top - moved, height: rect.height, width: rect.width },
    top,
    scroller.scrollTop,
  );
  // Keep the reader's share exactly; recomputing it from a rounded scroll
  // position would let repeated rewraps drift.
  if (reflowed && next.ratio !== null && Math.abs(moved - delta) < 1)
    next.ratio = anchor.ratio;
  Object.assign(anchor, next);
  return true;
}
