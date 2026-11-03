import {
  AVEN_MARK_DOT_RADIUS,
  AVEN_MARK_GRID,
  avenMarkDots,
} from "../lib/avenMark";

const DOTS = avenMarkDots();

/**
 * Aven's mark, Rise, on the page rather than on the app icon's tile: the
 * staircase of dots alone, in the text colour so it reads in light and dark
 * themes, with no tile or glow. Size it in whole multiples of the 5 × 5
 * grid, such as the default 15 px (three pixels a cell, like the project
 * marks), so every dot centres on a whole device pixel at 2×.
 */
export function AvenMark({
  className = "size-[15px]",
}: {
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${AVEN_MARK_GRID.width} ${AVEN_MARK_GRID.height}`}
      fill="currentColor"
      className={className}
    >
      {DOTS.map((dot) => (
        <circle
          key={`${dot.cx},${dot.cy}`}
          cx={dot.cx}
          cy={dot.cy}
          r={AVEN_MARK_DOT_RADIUS}
        />
      ))}
    </svg>
  );
}
