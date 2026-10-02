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
