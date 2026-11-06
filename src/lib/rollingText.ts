// Which characters of a changing label roll, after Rune's RollingText
// (github.com/anomalyco/rune, crates/rune-kit/src/rolling_text.rs, MIT,
// © 2026 Anomaly): characters the new text shares with the old keep their
// place or slide to it, and only the rest roll in, as an odometer does.

/** Extra time per changed character, left to right (ms). */
export const ROLL_STAGGER_MS = 30;
/** The stagger stops growing after this many characters. */
export const ROLL_STAGGER_CAP = 6;
/** How long a character takes to roll in or out (ms). */
export const ROLL_MS = 260;
/** Matching the middle only runs while old × new fits this. */
const LCS_BUDGET = 48 * 48;

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** The characters a reader sees, emoji and accents held together. */
export function glyphs(text: string): string[] {
  if (!segmenter) return Array.from(text);
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/**
 * Which way new characters roll: up while the number rises (and for text
 * without a number), down when it falls, as SwiftUI's numeric text does.
 */
export function rollsDown(
  previous: number | undefined,
  next: number | undefined,
): boolean {
  return (
    previous != null &&
    next != null &&
    Number.isFinite(previous) &&
    Number.isFinite(next) &&
    next < previous
  );
}

/**
 * For each character of `next`, the index of the `old` character it
 * continues, or null when it rolls in. Matches keep order: the shared start
 * and end, then a weighted longest common run of the middle that prefers
 * characters staying in place. A middle match counts only in a run of two or
 * more, or alone when it holds its place (the ":" of "1:00" to "0:59").
 *
 * A `trailing` label sits against its right edge and matches like an
 * odometer, from the right: "10s" to "100s" keeps "0s" and rolls "10" in,
 * and a digit never slides to another column.
 */
export function matchGlyphs(
  old: readonly string[],
  next: readonly string[],
  trailing = false,
): (number | null)[] {
  const out: (number | null)[] = new Array(next.length).fill(null);
  const shortest = Math.min(old.length, next.length);
  const digit = (char: string) => /^[0-9]+$/.test(char);
  let suffix = 0;
  const matchSuffix = (prefix: number) => {
    while (
      suffix < shortest - prefix &&
      old[old.length - 1 - suffix] === next[next.length - 1 - suffix]
    ) {
      out[next.length - 1 - suffix] = old.length - 1 - suffix;
      suffix += 1;
    }
  };
  if (trailing) matchSuffix(0);
  let prefix = 0;
  while (
    prefix < shortest - suffix &&
    old[prefix] === next[prefix] &&
    !(trailing && digit(next[prefix]))
  ) {
    out[prefix] = prefix;
    prefix += 1;
  }
  if (!trailing) matchSuffix(prefix);
  const a = old.slice(prefix, old.length - suffix);
  const b = next.slice(prefix, next.length - suffix);
  if (a.length === 0 || b.length === 0 || a.length * b.length > LCS_BUDGET) {
    return out;
  }
  const shift = (i: number, j: number) => {
    const end = Math.abs(a.length - i - (b.length - j));
    return trailing ? end : Math.min(Math.abs(i - j), end);
  };
  const weight = (i: number, j: number) => 8 - Math.min(shift(i, j), 7);
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const skip = Math.max(
        table[(i + 1) * width + j],
        table[i * width + j + 1],
      );
      table[i * width + j] =
        a[i] === b[j]
          ? Math.max(skip, table[(i + 1) * width + j + 1] + weight(i, j))
          : skip;
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (
      a[i] === b[j] &&
      table[i * width + j] === table[(i + 1) * width + j + 1] + weight(i, j)
    ) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  pairs.forEach(([i, j], index) => {
    const before = pairs[index - 1];
    const after = pairs[index + 1];
    const run =
      (before && before[0] === i - 1 && before[1] === j - 1) ||
      (after && after[0] === i + 1 && after[1] === j + 1);
    if (run || shift(i, j) === 0) out[prefix + j] = prefix + i;
  });
  return out;
}
