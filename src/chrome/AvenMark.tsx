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
  climb = false,
}: {
  className?: string;
  /**
   * Its steps light in turn from the bottom up, twice, then it rests: Aven
   * climbing, as the logo does when it moves (index.css).
   */
  climb?: boolean;
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
          {...(climb
            ? {
                className: "aven-mark-climb",
                // The bottom step first, up to the top one.
                style: {
                  animationDelay: `${(AVEN_MARK_GRID.height - 0.5 - dot.cy) * 110}ms`,
                },
              }
            : {})}
        />
      ))}
    </svg>
  );
}
