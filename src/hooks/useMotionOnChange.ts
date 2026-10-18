import { useLayoutEffect, useRef } from "react";
import { playMotion, type MotionName } from "../lib/motion";

/**
 * Plays `name` on the element each time `value` changes after it first
 * shows: a counter or status word rolls into its new value ("round 2 of 4"
 * to "round 3 of 4", "1 of 3 done" to "2 of 3 done"). The new value is
 * already in place when it starts. An undefined value never animates.
 */
export function useMotionOnChange(
  element: { readonly current: Element | null },
  value: string | number | undefined,
  name: MotionName = "roll",
) {
  const previous = useRef(value);
  useLayoutEffect(() => {
    if (previous.current === value) return;
    const before = previous.current;
    previous.current = value;
    if (before === undefined || value === undefined) return;
    playMotion(element.current, name);
  }, [element, name, value]);
}
