import type { BrowserBounds, BrowserHole } from "./browser";

/** In-app surfaces that must appear above a native browser page. */
export const BROWSER_OVERLAYS =
  '[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"], [data-popover-side], [data-native-browser-occluded="true"]';

/** Native masks stay cheap; more separate surfaces use the still-image path. */
export const MAX_BROWSER_HOLES = 8;
/** Beyond this share of the visible page, a still image reads better than a mostly empty cut-out. */
export const BROWSER_HOLE_AREA_LIMIT = 0.6;

export type BrowserOverlayState = {
  /** Hide the native page behind a still image (modal or unsupported overlay). */
  capture: boolean;
  /** Cut-outs for nonmodal surfaces over a live page, in page-relative CSS pixels. */
  holes: BrowserHole[];
  /** Elements that produced holes, so their size changes can be observed. */
  elements: HTMLElement[];
};

const NONE: BrowserOverlayState = { capture: false, holes: [], elements: [] };

type Box = { left: number; top: number; right: number; bottom: number };

function visibleArea(bounds: BrowserBounds): Box {
  return {
    left: bounds.x + (bounds.clipLeft ?? 0),
    top: bounds.y,
    right: bounds.x + bounds.width - (bounds.clipRight ?? 0),
    bottom: bounds.y + bounds.height,
  };
}

function intersects(rect: Box, area: Box): boolean {
  return (
    rect.left < area.right &&
    rect.right > area.left &&
    rect.top < area.bottom &&
    rect.bottom > area.top
  );
}

function clientBox(element: HTMLElement): Box | null {
  const rects = [...element.getClientRects()].filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  if (!rects.length) return null;
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
  };
}

/**
 * Entrance animations scale and shift a menu from its anchor. Cut the final
 * rectangle immediately so the native page never covers the opening frames.
 * Only the element's own 2D scale/translate is undone; ancestor transforms
 * are part of the final placement.
 */
function finalBox(element: HTMLElement, box: Box, style: CSSStyleDeclaration) {
  const transform = style.transform;
  if (!transform || transform === "none") return box;
  try {
    const matrix = new DOMMatrixReadOnly(transform);
    if (
      !matrix.is2D ||
      matrix.b !== 0 ||
      matrix.c !== 0 ||
      !(matrix.a > 0) ||
      !(matrix.d > 0)
    )
      return box;
    const [originX = 0, originY = 0] = (style.transformOrigin || "")
      .split(" ")
      .map((value) => parseFloat(value));
    const width = element.offsetWidth || (box.right - box.left) / matrix.a;
    const height = element.offsetHeight || (box.bottom - box.top) / matrix.d;
    const left =
      box.left -
      (Number.isFinite(originX) ? originX : 0) * (1 - matrix.a) -
      matrix.e;
    const top =
      box.top -
      (Number.isFinite(originY) ? originY : 0) * (1 - matrix.d) -
      matrix.f;
    if (![left, top, width, height].every(Number.isFinite)) return box;
    return { left, top, right: left + width, bottom: top + height };
  } catch {
    return box;
  }
}

function cornerRadius(style: CSSStyleDeclaration): number {
  // Use the smallest corner; a larger cut would expose the page beneath a
  // square corner, while a smaller one only shows the pane background.
  const radii = [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ].map((value) => (value?.trim().endsWith("%") ? 0 : parseFloat(value ?? "")));
  const radius = Math.min(...radii.map((value) => (value > 0 ? value : 0)));
  return Number.isFinite(radius) ? radius : 0;
}

function isEntering(element: HTMLElement): boolean {
  try {
    return (element.getAnimations?.() ?? []).some(
      (animation) =>
        animation.playState === "running" || animation.pending === true,
    );
  } catch {
    return false;
  }
}

function contains(outer: BrowserHole, inner: BrowserHole): boolean {
  const slop = 0.5;
  return (
    inner.x >= outer.x - slop &&
    inner.y >= outer.y - slop &&
    inner.x + inner.width <= outer.x + outer.width + slop &&
    inner.y + inner.height <= outer.y + outer.height + slop
  );
}

/**
 * Decide how in-app surfaces appear above a live native page.
 *
 * Modal dialogs, very large surfaces, or engines without cut-out support take
 * the still-image path. Other menus and popovers become rounded holes in the
 * native page, which stays live and sharp around them.
 */
export function browserOverlayState(
  bounds: BrowserBounds,
  holesSupported: boolean,
): BrowserOverlayState {
  const area = visibleArea(bounds);
  const areaWidth = area.right - area.left;
  const areaHeight = area.bottom - area.top;
  if (areaWidth < 1 || areaHeight < 1) return NONE;
  let capture = false;
  const found: { hole: BrowserHole; element: HTMLElement }[] = [];
  for (const element of document.querySelectorAll<HTMLElement>(
    BROWSER_OVERLAYS,
  )) {
    if (element.dataset.nativeBrowserEdge) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden") continue;
    const modal = element.getAttribute("aria-modal") === "true";
    if (
      style.opacity === "0" &&
      !(holesSupported && !modal && isEntering(element))
    )
      continue;
    const box = clientBox(element);
    if (!box) continue;
    // Real modal dialogs block the entire workspace. Nonmodal surfaces only
    // occlude the page where they overlap; a dismiss catcher is not a panel.
    if (modal) {
      capture = true;
      break;
    }
    if (!intersects(box, area)) continue;
    if (!holesSupported) {
      capture = true;
      break;
    }
    const final = finalBox(element, box, style);
    const left = Math.max(area.left, final.left);
    const top = Math.max(area.top, final.top);
    const right = Math.min(area.right, final.right);
    const bottom = Math.min(area.bottom, final.bottom);
    if (right - left < 0.5 || bottom - top < 0.5) continue;
    const width = right - left;
    const height = bottom - top;
    found.push({
      element,
      hole: {
        x: left - bounds.x,
        y: top - bounds.y,
        width,
        height,
        radius: Math.min(cornerRadius(style), width / 2, height / 2),
      },
    });
  }
  if (capture) return { capture: true, holes: [], elements: [] };
  // A popover frame, its animated surface and its menu list nest. Keep only
  // the outermost cut so overlapping paths never cancel each other out.
  const kept = found.filter(
    (entry, index) =>
      !found.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          contains(other.hole, entry.hole) &&
          (!contains(entry.hole, other.hole) || otherIndex < index),
      ),
  );
  if (!kept.length) return NONE;
  const covered = kept.reduce(
    (sum, { hole }) => sum + hole.width * hole.height,
    0,
  );
  if (
    kept.length > MAX_BROWSER_HOLES ||
    covered > areaWidth * areaHeight * BROWSER_HOLE_AREA_LIMIT
  )
    return { capture: true, holes: [], elements: [] };
  return {
    capture: false,
    holes: kept.map(({ hole }) => hole),
    elements: kept.map(({ element }) => element),
  };
}
