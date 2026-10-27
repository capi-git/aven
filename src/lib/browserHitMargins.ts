import type { BrowserBounds, BrowserHitMargins } from "./browser";

/**
 * Elements a live page must leave its pointer events to: dividers that
 * resize the panes beside it and the window edge that reveals the hidden
 * sidebar. Panes meet flush, so a native page would otherwise cover most of
 * a divider's grab area.
 */
export const BROWSER_HIT_MARGIN_ATTRIBUTE = "data-native-hit-margin";

/** No margin is wider than this, whatever a handle measures. */
export const MAX_BROWSER_HIT_MARGIN = 12;

type Rect = Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">;

function visible(element: Element) {
  if (element.closest("[hidden], [inert]")) return false;
  const style = getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

/**
 * Strips along the page's edges, in CSS pixels, where its native view lets
 * the pointer through to the handles beneath it. Only a handle that reaches
 * an edge counts, so a divider inside the page's own split never does: tall
 * handles give left and right margins, wide ones top and bottom.
 */
export function browserHitMargins(
  bounds: Pick<BrowserBounds, "x" | "y" | "width" | "height">,
  handles: Iterable<{ rects: Iterable<Rect> }>,
): BrowserHitMargins | null {
  const page = {
    left: bounds.x,
    top: bounds.y,
    right: bounds.x + bounds.width,
    bottom: bounds.y + bounds.height,
  };
  const edge = 0.5;
  const margins = { left: 0, top: 0, right: 0, bottom: 0 };
  for (const handle of handles)
    for (const rect of handle.rects) {
      const left = Math.max(rect.left, page.left);
      const right = Math.min(rect.right, page.right);
      const top = Math.max(rect.top, page.top);
      const bottom = Math.min(rect.bottom, page.bottom);
      if (right - left <= 0 || bottom - top <= 0) continue;
      const tall = rect.bottom - rect.top >= rect.right - rect.left;
      if (tall) {
        if (left <= page.left + edge)
          margins.left = Math.max(margins.left, right - page.left);
        else if (right >= page.right - edge)
          margins.right = Math.max(margins.right, page.right - left);
      } else if (top <= page.top + edge)
        margins.top = Math.max(margins.top, bottom - page.top);
      else if (bottom >= page.bottom - edge)
        margins.bottom = Math.max(margins.bottom, page.bottom - top);
    }
  const clamp = (value: number, span: number) =>
    Math.min(value, MAX_BROWSER_HIT_MARGIN, span / 2);
  const result = {
    left: clamp(margins.left, bounds.width),
    top: clamp(margins.top, bounds.height),
    right: clamp(margins.right, bounds.width),
    bottom: clamp(margins.bottom, bounds.height),
  };
  return result.left || result.top || result.right || result.bottom
    ? result
    : null;
}

/** The page's bounds with margins for the handles now on screen. */
export function withBrowserHitMargins(bounds: BrowserBounds): BrowserBounds {
  const handles = [
    ...document.querySelectorAll<HTMLElement>(
      `[${BROWSER_HIT_MARGIN_ATTRIBUTE}]`,
    ),
  ]
    .filter(visible)
    .map((element) => ({ rects: element.getClientRects() }));
  const hitMargins = handles.length ? browserHitMargins(bounds, handles) : null;
  return hitMargins ? { ...bounds, hitMargins } : bounds;
}
