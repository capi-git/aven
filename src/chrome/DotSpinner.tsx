import type { OrbState } from "@yogesharc/thinking-orbs";
import { ThinkingOrb } from "./ThinkingOrb";
import "./DotSpinner.css";

/**
 * A small grey Thinking Orb while something works (a script, a pull
 * request's checks): the running ring, or `background` for something that
 * keeps running, like a dev server. Still under Reduce motion; paused while
 * the window is hidden.
 */
export function DotSpinner({
  size = 12,
  state = "working",
}: {
  size?: number;
  state?: Extract<OrbState, "working" | "background" | "searching">;
}) {
  return (
    <span className="dot-spinner" style={{ width: size, height: size }}>
      <ThinkingOrb look={{ state }} urgent />
    </span>
  );
}
