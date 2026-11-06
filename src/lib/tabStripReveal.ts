/** The last reveal, for the in-app check to report beside a missed press. */
export let lastTabReveal: {
  id: string | null;
  at: number;
  left: number | null;
} | null = null;

/** Bring `tab` into its strip's view, to the nearest edge. */
export function revealTab(tab: HTMLElement) {
  tab.scrollIntoView({ inline: "nearest", block: "nearest" });
  lastTabReveal = {
    id: tab.dataset.surfaceTabId ?? tab.dataset.motionSlot ?? null,
    at: performance.now(),
    left:
      tab.closest<HTMLElement>("[data-sortable-scroll-container]")
        ?.scrollLeft ?? null,
  };
}

/**
 * Whether `tab` sits wholly in `strip`'s view, clear of the strip's scroll
 * padding where there is more to scroll toward (the scroll arrows sit
 * there). The padding is in the strip's own pixels; the boxes are zoomed.
 */
export function tabInView(tab: Element, strip: HTMLElement): boolean {
  const box = tab.getBoundingClientRect();
  const view = strip.getBoundingClientRect();
  const style = getComputedStyle(strip);
  const zoom =
    (strip as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
  const room = (value: string) => (parseFloat(value) || 0) * zoom;
  const towardStart = strip.scrollLeft > 1;
  const towardEnd =
    strip.scrollLeft < strip.scrollWidth - strip.clientWidth - 1;
  return (
    box.left >=
      view.left + (towardStart ? room(style.scrollPaddingLeft) : 0) - 0.5 &&
    box.right <=
      view.right - (towardEnd ? room(style.scrollPaddingRight) : 0) + 0.5
  );
}
