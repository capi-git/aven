/**
 * The Stack, a project's mark: three pages in a 64-unit box, the back two
 * fainter. While the project is open in the sidebar the back two turn out
 * from the point at the front page's bottom middle, so the pages fan out.
 * StackMark.css draws the same numbers; StackMark.test.ts keeps them equal.
 */
export const STACK_VIEW_BOX = "0 0 64 64";

/** Back to front. */
export const STACK_PAGES = [
  { part: "back", x: 14, y: 8, width: 36, height: 30, radius: 5 },
  { part: "middle", x: 10, y: 15, width: 44, height: 32, radius: 5.5 },
  { part: "front", x: 6, y: 23, width: 52, height: 33, radius: 6 },
] as const;

/** How far the back pages turn while the project is open, in degrees. */
export const STACK_FAN_DEGREES = { back: -14, middle: -6 } as const;

/** The point they turn around: the front page's bottom middle. */
export const STACK_FAN_ORIGIN = { x: 32, y: 56 } as const;

/**
 * The turn a computed CSS `transform` gives, in degrees: 0 for none, null
 * when it can't be read. Reads `matrix()` and `matrix3d()`, as browsers
 * report a `rotate()`.
 */
export function rotationDegrees(transform: string): number | null {
  const value = transform.trim();
  if (!value || value === "none") return 0;
  const match = /^matrix(3d)?\(([^)]+)\)$/.exec(value);
  if (!match) return null;
  const numbers = match[2].split(",").map((part) => Number(part.trim()));
  if (numbers.some((number) => !Number.isFinite(number))) return null;
  // Both forms start with the first column's x and y: cos and sin.
  const [a, b] = numbers;
  if (match[1] ? numbers.length !== 16 : numbers.length !== 6) return null;
  return (Math.atan2(b, a) * 180) / Math.PI;
}
