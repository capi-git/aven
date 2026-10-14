import { useLayoutEffect, useRef, type RefObject } from "react";
import { effectiveCssZoom } from "../lib/drag";

type DockStart = { left: number; top: number };

let requested: { start: DockStart; hold: number; at: number } | null = null;
/** A request the docking panel did not take up promptly is stale. */
const REQUEST_LIFETIME = 1000;

/**
 * The macOS floating sidebar's card lives in another webview, so the docking
 * panel cannot measure it. Its owner passes the card's place here before
 * pinning; the panel holds there for `hold` ms while the card is removed.
 */
export function requestDockHandoff(start: DockStart, hold = 0) {
  requested = { start, hold, at: performance.now() };
}

/** Pinning a peeked panel docks it from where it already is on screen, as
 * Arc's hidden-to-anchored transition does, instead of jumping into place. */
export function usePanelDockHandoff(
  panel: RefObject<HTMLElement | null>,
  floating: boolean,
) {
  const wasFloating = useRef(floating);
  const from = useRef<DockStart | null>(null);
  // The floating geometry is gone by the time effects run. Read it in the
  // render that docks the panel; only that render pays for the measurement.
  if (wasFloating.current !== floating) {
    wasFloating.current = floating;
    const element = panel.current;
    from.current =
      !floating && element?.parentElement?.dataset.open === "true"
        ? element.getBoundingClientRect()
        : null;
  }

  useLayoutEffect(() => {
    const handoff =
      !floating &&
      requested &&
      performance.now() - requested.at < REQUEST_LIFETIME
        ? requested
        : null;
    if (!floating) requested = null;
    const start = handoff?.start ?? from.current;
    const hold = handoff?.hold ?? 0;
    from.current = null;
    const element = panel.current;
    if (!start || !element || floating || typeof element.animate !== "function")
      return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const end = element.getBoundingClientRect();
    const zoom = effectiveCssZoom(element);
    const dx = (start.left - end.left) / zoom;
    const dy = (start.top - end.top) / zoom;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    const style = getComputedStyle(element);
    // Best effort: an unsupported easing only loses the settle, not the dock.
    try {
      element.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        {
          delay: hold,
          fill: "backwards",
          duration:
            Number.parseFloat(
              style.getPropertyValue("--aven-peek-in-duration"),
            ) || 370,
          easing:
            style.getPropertyValue("--aven-peek-in-easing").trim() ||
            "ease-out",
        },
      );
    } catch {
      // The panel is already in its docked place.
    }
  }, [panel, floating]);
}
