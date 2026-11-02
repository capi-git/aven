import { useCallback, useRef, type WheelEvent } from "react";
import { TAB_WHEEL_START, tabAfterStep, tabWheelStep } from "../lib/tabWheel";

/**
 * Hover a tab strip and scroll to switch tabs. The handler reads the
 * strip's own `role="tab"` buttons and clicks the next one, so it works on
 * any strip without knowing its tabs. Sideways scrolling, and scrolling
 * with a modifier held, is left to the strip.
 */
export function useWheelTabSwitch(): (event: WheelEvent<HTMLElement>) => void {
  const state = useRef(TAB_WHEEL_START);
  return useCallback((event: WheelEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
      return;
    const { step, state: next } = tabWheelStep(state.current, {
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      now: performance.now(),
    });
    state.current = next;
    if (!step) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).filter((button) => !button.disabled);
    const target = tabAfterStep(
      buttons.map((button) => ({
        button,
        selected: button.getAttribute("aria-selected") === "true",
      })),
      step,
    );
    if (!target) return;
    event.preventDefault();
    target.button.click();
  }, []);
}
