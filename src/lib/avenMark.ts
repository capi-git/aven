/**
 * Aven's mark, Rise: a 5 × 5 staircase of round dots, one more on each row
 * down, climbing to the top-left. One character per cell: "#" is a lit dot.
 * Keep it in step with RISE in scripts/render-brand-icons.py, which draws
 * the app icon from the same grid.
 */
export const AVEN_MARK_ROWS = [
  "#....",
  "##...",
  "###..",
  "####.",
  "#####",
] as const;

export const AVEN_MARK_GRID = {
  width: AVEN_MARK_ROWS[0].length,
  height: AVEN_MARK_ROWS.length,
} as const;

/**
 * A dot's radius in cells: 0.68 of a cell across, as on the app icon, so at
 * the 15 px default (3 px cells) each dot is 2 px wide with a 1 px gap.
 */
export const AVEN_MARK_DOT_RADIUS = 0.34;

/** The centre of each lit dot, in cells over the grid's viewBox. */
export function avenMarkDots(): { cx: number; cy: number }[] {
  const dots: { cx: number; cy: number }[] = [];
  AVEN_MARK_ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; x++)
      if (row[x] === "#") dots.push({ cx: x + 0.5, cy: y + 0.5 });
  });
  return dots;
}
