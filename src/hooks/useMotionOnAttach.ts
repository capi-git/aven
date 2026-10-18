import { useCallback, useRef } from "react";
import { playMotion, type MotionName } from "../lib/motion";

/**
 * A ref that plays `name` once on the element it is attached to, when that
 * element first appears. Later renders leave it alone, so a streamed update
 * or a changed `name` never restarts it; without a name it plays nothing.
 */
export function useMotionOnAttach<T extends Element>(
  name: MotionName | undefined,
) {
  const current = useRef(name);
  current.current = name;
  return useCallback((element: T | null) => {
    if (element && current.current) playMotion(element, current.current);
  }, []);
}
