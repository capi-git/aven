/** A scoped scrollbar gesture. Native wheel and selection input stay untouched. */
export const TRANSCRIPT_SCROLL_DRAG_EVENT = "aven-transcript-scroll-drag";

export function setTranscriptScrollDragging(
  el: HTMLElement,
  dragging: boolean,
) {
  el.dispatchEvent(
    new CustomEvent(TRANSCRIPT_SCROLL_DRAG_EVENT, { detail: dragging }),
  );
}

export type ScrollBox = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/** At the very end, not just inside the bottom margin. */
export function isAtEnd(el: ScrollBox): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 1;
}

/**
 * A taller viewport or shorter content clamps the old offset to the new
 * bottom. That is a layout adjustment, not the reader scrolling.
 */
export function scrollClampedToBottom(
  el: ScrollBox,
  previousTop: number,
): boolean {
  const bottom = Math.max(0, el.scrollHeight - el.clientHeight);
  return previousTop > bottom && Math.abs(el.scrollTop - bottom) < 1;
}

/** True when the offset moved since `previousTop` by something other than a clamp. */
export function readerScrolled(el: ScrollBox, previousTop: number): boolean {
  return (
    el.scrollTop !== previousTop && !scrollClampedToBottom(el, previousTop)
  );
}

/** The content and viewport heights as of the last offset this side saw. */
export type ScrollExtent = Pick<ScrollBox, "scrollHeight" | "clientHeight">;

/**
 * Content shrinking under the reader, such as finished work folding away,
 * clamped them to the end while the viewport did not grow. They now see the
 * end and nothing is left below it, so this counts as following. A taller
 * viewport over unchanged content is only layout and keeps the old choice.
 */
export function contentShrankToEnd(
  el: ScrollBox,
  previousTop: number,
  previous: ScrollExtent,
): boolean {
  return (
    el.scrollHeight < previous.scrollHeight &&
    el.clientHeight <= previous.clientHeight &&
    scrollClampedToBottom(el, previousTop)
  );
}

/**
 * Whether to follow the end after the offset moved from `previousTop`. The
 * direction decides, not the distance: moving up leaves, and only moving down
 * all the way to the end resumes. A small downward reversal while reading
 * near the end must not snap the next chunk under the reader. Pass the
 * `previous` extent so a content shrink that clamps to the end follows.
 */
export function followsAfterScroll(
  el: ScrollBox,
  previousTop: number,
  following: boolean,
  previous?: ScrollExtent,
): boolean {
  if (!readerScrolled(el, previousTop)) {
    if (previous && contentShrankToEnd(el, previousTop, previous)) return true;
    return following;
  }
  return el.scrollTop > previousTop && isAtEnd(el);
}
