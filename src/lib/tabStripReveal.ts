/** How long a tab's grow-in can last, with room to spare (aven-tab-open). */
export const TAB_GROW_IN_LIMIT_MS = 600;

/**
 * Bring a newly selected tab fully into the strip's view, and keep it there
 * while it grows in.
 *
 * A tab opens from no width (`aven-tab-open` on its `[data-tab-opening]`
 * slot), so scrolling it into view as it is selected brings in only its
 * first pixels, and the strip then overflows past it as it grows: the new
 * tab ends up off the strip's end, under its scroll arrow. Following the
 * slot's size until its grow-in ends leaves the whole tab in view, clear of
 * the arrows (the strip's scroll padding). Returns a stop.
 */
export function revealTab(
  tab: HTMLElement,
  slot: HTMLElement | null,
): () => void {
  const reveal = () =>
    tab.scrollIntoView({ inline: "nearest", block: "nearest" });
  reveal();
  if (
    !slot?.hasAttribute("data-tab-opening") ||
    typeof ResizeObserver === "undefined"
  )
    return () => {};
  const observer = new ResizeObserver(reveal);
  observer.observe(slot);
  const ended = (event: AnimationEvent) => {
    // Only the slot's own grow-in, not an animation inside the tab.
    if (event.target !== slot) return;
    reveal();
    stop();
  };
  const timer = setTimeout(() => stop(), TAB_GROW_IN_LIMIT_MS);
  function stop() {
    observer.disconnect();
    slot?.removeEventListener("animationend", ended);
    clearTimeout(timer);
  }
  slot.addEventListener("animationend", ended);
  return stop;
}
