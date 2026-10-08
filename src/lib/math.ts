/** Constrain a value to inclusive bounds; NaN stays NaN. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
