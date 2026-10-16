import {
  AVEN_MARK_BODY_PATH,
  AVEN_MARK_GRID,
  AVEN_MARK_SUMMIT_COLOR,
  AVEN_MARK_SUMMIT_PATH,
} from "../lib/avenMark";

/**
 * Aven's Pixel A on the page rather than on the app icon's tile: the body
 * takes the text colour so it reads in light and dark themes, and the summit
 * pixel stays Aven's blue. Size it in whole multiples of the 7 × 8 grid, such
 * as the default 14 × 16 px, so every cell lands on whole pixels.
 */
export function AvenMark({ className = "h-4 w-3.5" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${AVEN_MARK_GRID.width} ${AVEN_MARK_GRID.height}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <path d={AVEN_MARK_BODY_PATH} fill="currentColor" />
      <path d={AVEN_MARK_SUMMIT_PATH} fill={AVEN_MARK_SUMMIT_COLOR} />
    </svg>
  );
}
