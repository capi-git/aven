/**
 * The message box paints its words in an overlay (`.composer-highlight`)
 * over an invisible field (`.composer-field`), whose caret is the one you
 * see. The two must lay out each line in the same place, or the caret sits
 * off the words. This measures both in the live page: the field's line
 * boxes from its own geometry (where WebKit puts its lines and caret), the
 * overlay's from the painted text itself.
 */

export type ComposerLineBoxes = {
  /** Top of each line box in the field, in viewport pixels. */
  field: number[];
  /** Top of each line box the overlay painted, in viewport pixels. */
  overlay: number[];
  lineHeight: number;
  /** The two elements' own boxes, which must be the same box. */
  fieldBox: { top: number; height: number };
  overlayBox: { top: number; height: number };
};

const px = (value: string) => Number.parseFloat(value) || 0;

/**
 * Both elements' line boxes in a message box, or null when it has no field,
 * no overlay or nothing typed. Line tops are rounded to a hundredth.
 */
export function composerLineBoxes(box: ParentNode): ComposerLineBoxes | null {
  const field = box.querySelector<HTMLTextAreaElement>(".composer-field");
  const overlay = box.querySelector<HTMLElement>(".composer-highlight");
  if (!field || !overlay) return null;
  const view = field.ownerDocument.defaultView;
  if (!view) return null;
  const style = view.getComputedStyle(field);
  const rect = field.getBoundingClientRect();
  // Under CSS zoom the rects are zoomed and the styles are not: measure
  // the styles in the rects' pixels.
  const scale =
    field.offsetHeight > 0 && rect.height > 0
      ? rect.height / field.offsetHeight
      : 1;
  const lineHeight = px(style.lineHeight) * scale;
  if (!lineHeight) return null;

  // The overlay's painted lines: each glyph run's box, centred in its line.
  const range = field.ownerDocument.createRange();
  range.selectNodeContents(overlay);
  const tops = new Map<number, number>();
  for (const rect of range.getClientRects()) {
    if (!rect.height) continue;
    const top = rect.top - (lineHeight - rect.height) / 2;
    const key = Math.round(top);
    tops.set(key, Math.min(tops.get(key) ?? top, top));
  }
  const overlayLines = [...tops.values()]
    .sort((a, b) => a - b)
    .map((top) => Math.round(top * 100) / 100);
  if (!overlayLines.length) return null;

  // The field's lines start below its border and padding, less its scroll.
  const first =
    rect.top +
    (px(style.borderTopWidth) + px(style.paddingTop) - field.scrollTop) * scale;
  const fieldLines = overlayLines.map(
    (_, index) => Math.round((first + index * lineHeight) * 100) / 100,
  );
  const overlayRect = overlay.getBoundingClientRect();
  return {
    field: fieldLines,
    overlay: overlayLines,
    lineHeight,
    fieldBox: { top: rect.top, height: rect.height },
    overlayBox: { top: overlayRect.top, height: overlayRect.height },
  };
}

/**
 * Why the caret would sit off the words, or null: a line of the overlay
 * more than `tolerance` px from the field's, or the two boxes apart.
 */
export function lineBoxProblem(
  boxes: ComposerLineBoxes,
  tolerance = 1,
): string | null {
  const { fieldBox, overlayBox } = boxes;
  if (
    Math.abs(fieldBox.top - overlayBox.top) > tolerance ||
    Math.abs(fieldBox.height - overlayBox.height) > tolerance
  )
    return `the overlay's box (${round(overlayBox.top)}, ${round(overlayBox.height)} tall) is not the field's (${round(fieldBox.top)}, ${round(fieldBox.height)} tall)`;
  for (let index = 0; index < boxes.overlay.length; index++) {
    const drift = boxes.overlay[index] - boxes.field[index];
    if (Math.abs(drift) > tolerance)
      return `line ${index + 1} is painted ${round(Math.abs(drift))}px ${drift < 0 ? "above" : "below"} the field's line, where the caret is`;
  }
  return null;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
