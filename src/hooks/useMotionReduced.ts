import { useSyncExternalStore } from "react";
import { MOTION_ROOT_ATTRIBUTE, motionReduced } from "../lib/motion";

function subscribe(onChange: () => void): () => void {
  if (
    typeof document === "undefined" ||
    typeof MutationObserver === "undefined"
  )
    return () => {};
  // `initMotionPreference` marks the root in every window, from the
  // system's setting and Aven's own; follow that one switch.
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [MOTION_ROOT_ATTRIBUTE],
  });
  return () => observer.disconnect();
}

/** True while motion is off, by the system's setting or Aven's. */
export function useMotionReduced(): boolean {
  return useSyncExternalStore(subscribe, motionReduced, () => true);
}
