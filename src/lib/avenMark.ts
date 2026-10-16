import { AVEN_THEME_COLORS } from "./appearance";
import { mascotPath } from "./projectMascots";

/**
 * Aven's mark, the Pixel A, one character per cell: "#" is the body and "B"
 * the summit pixel at the apex. Keep it in step with PIXEL_A in
 * scripts/render-brand-icons.py, which draws the app icon from the same grid.
 */
export const AVEN_MARK_ROWS = [
  "...B...",
  "..###..",
  ".##.##.",
  ".#...#.",
  "#######",
  "##...##",
  "#.....#",
  "#.....#",
] as const;

export const AVEN_MARK_GRID = {
  width: AVEN_MARK_ROWS[0].length,
  height: AVEN_MARK_ROWS.length,
} as const;

/** SVG path data over the grid's viewBox: the body, then the summit pixel. */
export const AVEN_MARK_BODY_PATH = mascotPath(AVEN_MARK_ROWS);
export const AVEN_MARK_SUMMIT_PATH = mascotPath(
  AVEN_MARK_ROWS.map((row) => row.replace(/[^B]/g, ".").replace(/B/g, "#")),
);

/** The summit is always Aven's blue accent, as on the app icon. */
export const AVEN_MARK_SUMMIT_COLOR = AVEN_THEME_COLORS.dark.accent;
