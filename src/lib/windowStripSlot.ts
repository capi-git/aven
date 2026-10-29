import { clientRectScale, effectiveCssZoom, pointInRects } from "./drag";

/**
 * Where a tab let go on the window's strip stands (`windowStripDrop`).
 *
 * The strip cancels the interface zoom with CSS zoom, and the pointer is
 * in the viewport's pixels. Older WebKit (macOS 13 to 26) reports the
 * strip's rects divided by that zoom, so the pointer is compared with them
 * in their own pixels (`pointInRects`); the standard engine reports the
 * viewport's, as the pointer is.
 */

/** Whether (x, y), the pointer in the viewport's pixels, is over the strip. */
export function overStrip(strip: HTMLElement, x: number, y: number): boolean {
  const rect = strip.getBoundingClientRect();
  const at = pointInRects({ x, y }, clientRectScale(strip));
  return (
    rect.width > 0 &&
    at.x >= rect.left &&
    at.x <= rect.right &&
    at.y >= rect.top &&
    at.y <= rect.bottom
  );
}

/**
 * Where a tab held at `x`, the pointer in the viewport's pixels, would
 * stand among the strip's entries `slots`: before the first whose middle
 * is past it, or at the end (null). The result's `x` places the insertion
 * line in the strip's scrolled content, in the strip's own CSS pixels.
 */
export function stripSlotAt(
  strip: HTMLElement,
  slots: readonly HTMLElement[],
  x: number,
): { before: string | null; x: number } {
  const scale = clientRectScale(strip);
  const pointer = pointInRects({ x, y: 0 }, scale).x;
  const origin = strip.getBoundingClientRect().left;
  // A reported distance in the viewport's pixels, then in the strip's own.
  const zoom = effectiveCssZoom(strip) || 1;
  const along = (at: number) =>
    ((at - origin) * scale) / zoom + strip.scrollLeft;
  for (const slot of slots) {
    const rect = slot.getBoundingClientRect();
    if (pointer < rect.left + rect.width / 2)
      return {
        before: slot.dataset.motionSlot ?? null,
        x: along(rect.left) - 1,
      };
  }
  const last = slots.at(-1)?.getBoundingClientRect();
  return { before: null, x: last ? along(last.right) + 1 : 0 };
}
