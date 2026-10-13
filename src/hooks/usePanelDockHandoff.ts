import { useLayoutEffect, useRef, type RefObject } from "react";
import { effectiveCssZoom } from "../lib/drag";

/** Pinning a peeked panel docks it from where it already is on screen, as
 * Arc's hidden-to-anchored transition does, instead of jumping into place. */
export function usePanelDockHandoff(
  panel: RefObject<HTMLElement | null>,
  floating: boolean,
) {
  const wasFloating = useRef(floating);
  const from = useRef<DOMRect | null>(null);
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
    const start = from.current;
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
