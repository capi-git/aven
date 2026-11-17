import { ThinkingOrb } from "./ThinkingOrb";

/**
 * A working line's spinner: a small Thinking Orb in the text colour, as
 * wide as the line's glyph and square. Its orb holds still while the
 * window is hidden.
 */
export function TerminalSpinner({
  className = "inline-block w-3.5 select-none text-center text-ui-caption leading-none",
}: {
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={className}
      style={{ aspectRatio: "1", verticalAlign: "middle" }}
    >
      <ThinkingOrb look={{ state: "working" }} urgent />
    </span>
  );
}
