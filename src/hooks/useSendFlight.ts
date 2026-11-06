import { useCallback, useRef } from "react";
import { playMotion, type MotionName } from "../lib/motion";
import { landSentText } from "../lib/sendFlight";

/**
 * A ref for a sent message's bubble: when it first appears with `rise`, the
 * words the message box just sent fly into it; a message nobody just sent
 * here (an older one, another window) rises as before. Later renders leave
 * it alone, as `useMotionOnAttach` does.
 */
export function useSendFlight<T extends HTMLElement>(
  motion: MotionName | undefined,
  text: string,
) {
  const current = useRef({ motion, text });
  current.current = { motion, text };
  return useCallback((element: T | null) => {
    const { motion, text } = current.current;
    if (!element || !motion) return;
    if (motion === "rise" && landSentText(element, text)) return;
    playMotion(element, motion);
  }, []);
}
