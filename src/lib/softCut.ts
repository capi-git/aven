// Softer ways to cut text and scroll areas off, after Rune's `truncate_fade`,
// `truncate_middle` and `scroll_edge_fade` (github.com/anomalyco/rune,
// crates/rune/README.md, MIT, © 2026 Anomaly).

/**
 * The longest `text` that fits `width` with its middle replaced by "…",
 * keeping as much of both ends as fits, and the file's name before its
 * folders. `measure` gives a string's width.
 */
export function cutMiddle(
  text: string,
  width: number,
  measure: (value: string) => number,
): string {
  if (measure(text) <= width) return text;
  const chars = Array.from(text);
  const name = Array.from(text.slice(text.lastIndexOf("/") + 1)).length;
  // Half each, or more of the end to keep the file's name, leaving a few
  // characters of the start.
  const cut = (keep: number) => {
    const tail = Math.max(Math.ceil(keep / 2), Math.min(name, keep - 4));
    return (
      chars.slice(0, keep - tail).join("") +
      "…" +
      chars.slice(chars.length - tail).join("")
    );
  };
  let low = 0;
  let high = chars.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (measure(cut(middle)) <= width) low = middle;
    else high = middle - 1;
  }
  return cut(low);
}

/** Pixels hidden past an edge at which its fade is at full strength. */
export const EDGE_FADE_FULL_PX = 15;
/** Pixels of scroll over which a header's shadow comes in. */
export const STUCK_SHADOW_PX = 8;

/**
 * How strongly each edge of a scroll area fades (0 to 1): only while content
 * is hidden past it, coming in over the first 15 px of it.
 */
export function edgeFades(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): { top: number; bottom: number } {
  const below = Math.max(0, scrollHeight - clientHeight - scrollTop);
  const above = Math.max(0, scrollTop);
  const strength = (hidden: number) =>
    Math.round(Math.min(1, hidden / EDGE_FADE_FULL_PX) * 100) / 100;
  return { top: strength(above), bottom: strength(below) };
}

/** How strong a header's shadow is (0 to 1) once its body has scrolled. */
export function stuckShadow(scrollTop: number): number {
  return (
    Math.round(Math.min(1, Math.max(0, scrollTop) / STUCK_SHADOW_PX) * 100) /
    100
  );
}
