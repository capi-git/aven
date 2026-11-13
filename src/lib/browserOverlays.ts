import type { BrowserBounds, BrowserHole, BrowserShade } from "./browser";
import { effectiveCssZoom, viewportRect } from "./drag";

/** In-app surfaces that must appear above a native browser page. */
export const BROWSER_OVERLAYS =
  '[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"], [data-popover-side], [data-native-browser-occluded="true"]';

/** Native masks stay cheap; more separate surfaces use the still-image path. */
export const MAX_BROWSER_HOLES = 8;
/** Beyond this share of the visible page, a still image reads better than a mostly empty cut-out. */
export const BROWSER_HOLE_AREA_LIMIT = 0.6;

/**
 * The backdrops that veil the whole window behind a modal dialog. The
 * workspace draws them beneath a native page, where they cannot dim it, so
 * the page is dimmed by a veil of its own to match (`BrowserShade`).
 */
export const MODAL_VEILS = ".modal-backdrop, .workspace-dialog-shade";
/** No backdrop fades in for longer than this; the native side refuses more. */
const MAX_SHADE_FADE_MS = 1000;

/**
 * Marks a surface that moves with the pointer, such as a dragged tab's copy.
 * It is cut out of a live page exactly where it is drawn, never at a final
 * box, and only once a still image of the page lies beneath the page: its
 * cut-out reaches the screen a frame before or after WebKit draws it, and
 * that gap must show the page, never the window behind it.
 */
export const BROWSER_MOVING_ATTRIBUTE = "data-native-browser-moving";

export type BrowserOverlayState = {
  /** Hide the native page behind a still image (an overlay it cannot show live). */
  capture: boolean;
  /**
   * A modal dialog is open: the live page keeps its place under this veil
   * and takes no pointer, and the dialog is one of `holes`. Never set with
   * `capture`.
   */
  shade?: BrowserShade;
  /** Cut-outs for nonmodal surfaces over a live page, in page-relative CSS pixels. */
  holes: BrowserHole[];
  /** Elements that produced holes, so their size changes can be observed. */
  elements: HTMLElement[];
  /**
   * Moving surfaces over the page, where they are drawn, in page-relative
   * CSS pixels; never cut without a still image beneath. An engine without
   * cut-outs takes the still-image path for them, as for any overlay.
   */
  moving: BrowserHole[];
  /**
   * A moving surface is mid-animation (its springs run as WAAPI, which
   * changes no attribute): where it is drawn must be read again next frame.
   */
  movingAnimates: boolean;
};

const NONE: BrowserOverlayState = {
  capture: false,
  holes: [],
  elements: [],
  moving: [],
  movingAnimates: false,
};

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

/** Where `element` is drawn, in the viewport's pixels on any engine. */
function clientBox(element: HTMLElement): Box | null {
  const rects = [...element.getClientRects()]
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => viewportRect(element, rect));
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
 * Only the element's own 2D scale/translate is undone, and only while it is
 * animating: a transform that places a surface (a centred tooltip, a copy
 * following the pointer) is where it is drawn. Ancestor transforms are part
 * of the final placement.
 *
 * The transform, its origin and `offsetWidth` are in the element's own CSS
 * pixels; `box` is in the viewport's (`clientBox`, on either kind of
 * engine). Under CSS zoom (the window strip cancels the interface zoom) one
 * of the element's pixels is its effective zoom in the viewport.
 */
function finalBox(element: HTMLElement, box: Box, style: CSSStyleDeclaration) {
  const transform = style.transform;
  if (!transform || transform === "none" || !isEntering(element)) return box;
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
    const zoom = effectiveCssZoom(element);
    if (!(zoom > 0)) return box;
    const [originX = 0, originY = 0] = (style.transformOrigin || "")
      .split(" ")
      .map((value) => parseFloat(value));
    const width =
      (element.offsetWidth || (box.right - box.left) / (matrix.a * zoom)) *
      zoom;
    const height =
      (element.offsetHeight || (box.bottom - box.top) / (matrix.d * zoom)) *
      zoom;
    const left =
      box.left -
      ((Number.isFinite(originX) ? originX : 0) * (1 - matrix.a) + matrix.e) *
        zoom;
    const top =
      box.top -
      ((Number.isFinite(originY) ? originY : 0) * (1 - matrix.d) + matrix.f) *
        zoom;
    if (![left, top, width, height].every(Number.isFinite)) return box;
    return { left, top, right: left + width, bottom: top + height };
  } catch {
    return box;
  }
}

/**
 * How opaque a plain black CSS colour is, in any notation an engine reports
 * (`rgba(0, 0, 0, 0.4)`, `rgb(0 0 0 / 40%)`, `oklab(0 0 0 / 0.4)`,
 * `color(srgb 0 0 0 / 0.4)`). Null for any other colour: only black can be
 * laid over a live page as a plain veil.
 */
export function blackOpacity(color: string): number | null {
  const match = /^([a-z]+)\((.*)\)$/i.exec(color.trim());
  if (!match) return null;
  const [channels = "", slashAlpha] = match[2].split("/");
  const tokens = channels.split(/[\s,]+/).filter(Boolean);
  // `color(srgb 0 0 0)` names its colour space first.
  if (match[1].toLowerCase() === "color") tokens.shift();
  // The comma notation carries its opacity as a fourth value.
  const legacyAlpha =
    slashAlpha === undefined && tokens.length === 4 ? tokens.pop() : undefined;
  if (
    tokens.length !== 3 ||
    tokens.some((token) => token !== "none" && parseFloat(token) !== 0)
  )
    return null;
  const text = (slashAlpha ?? legacyAlpha ?? "1").trim();
  const value = parseFloat(text) / (text.endsWith("%") ? 100 : 1);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

/** A CSS time (`0.12s`, `120ms`), in ms. */
function milliseconds(time: string): number {
  const value = parseFloat(time);
  if (!Number.isFinite(value)) return 0;
  return time.trim().endsWith("ms") ? value : value * 1000;
}

/** A modal dialog's backdrop: around it, or beside it or one of its ancestors. */
function modalVeil(modal: HTMLElement): HTMLElement | null {
  for (
    let node = modal.parentElement;
    node && node !== document.body;
    node = node.parentElement
  ) {
    if (node.matches(MODAL_VEILS)) return node;
    const beside = [...node.children].find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.matches(MODAL_VEILS),
    );
    if (beside) return beside;
  }
  return null;
}

/**
 * The veil a modal dialog's backdrop casts over the page in `area`, or null
 * when a native page cannot match it: one that does not cover the page, or
 * one that is not plain black (a blur, a picture). The page is then hidden
 * behind a still image, as for any other overlay it cannot show live.
 */
function veilShade(veil: HTMLElement, area: Box): BrowserShade | null {
  const style = getComputedStyle(veil);
  if (style.display === "none" || style.visibility === "hidden") return null;
  const filter =
    style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter");
  if (filter && filter !== "none") return null;
  if (style.backgroundImage && style.backgroundImage !== "none") return null;
  const box = clientBox(veil);
  if (
    !box ||
    box.left > area.left + 1 ||
    box.top > area.top + 1 ||
    box.right < area.right - 1 ||
    box.bottom < area.bottom - 1
  )
    return null;
  const opacity = blackOpacity(style.backgroundColor);
  if (!opacity) return null;
  const fades = style.animationName && style.animationName !== "none";
  const fadeMs = fades
    ? milliseconds(style.animationDuration.split(",")[0] ?? "")
    : 0;
  return {
    opacity,
    fadeMs: Math.min(MAX_SHADE_FADE_MS, Math.max(0, Math.round(fadeMs))),
  };
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
 * Menus and popovers become rounded holes in the native page, which stays
 * live and sharp around them. So does a modal dialog, with the page dimmed
 * under a veil that matches the dialog's backdrop (`shadeSupported`): the
 * page is never hidden, captured or redrawn for it. Very large menus, a
 * dialog whose backdrop the page cannot match, or an engine without
 * cut-outs take the still-image path.
 */
export function browserOverlayState(
  bounds: BrowserBounds,
  holesSupported: boolean,
  shadeSupported = false,
): BrowserOverlayState {
  const area = visibleArea(bounds);
  const areaWidth = area.right - area.left;
  const areaHeight = area.bottom - area.top;
  if (areaWidth < 1 || areaHeight < 1) return NONE;
  let capture = false;
  let shade: BrowserShade | undefined;
  const veils = new Set<HTMLElement>();
  const moving: BrowserHole[] = [];
  let movingAnimates = false;
  const found: {
    hole: BrowserHole;
    element: HTMLElement;
    visibleArea: number;
  }[] = [];
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
    // Real modal dialogs block the entire workspace: the page dims under
    // their veil wherever they are, and they are cut out of it like a menu
    // where they overlap. Nonmodal surfaces only occlude the page where
    // they overlap; a dismiss catcher is not a panel.
    if (modal) {
      const backdrop =
        holesSupported && shadeSupported ? modalVeil(element) : null;
      const veil = backdrop && veilShade(backdrop, area);
      if (!backdrop || !veil) {
        capture = true;
        break;
      }
      // A dialog over a dialog: two backdrops, one over the other. Two
      // dialogs on one backdrop are dimmed once.
      if (!veils.has(backdrop))
        shade = shade
          ? {
              opacity: 1 - (1 - shade.opacity) * (1 - veil.opacity),
              fadeMs: veil.fadeMs,
            }
          : veil;
      veils.add(backdrop);
    }
    if (!intersects(box, area)) continue;
    if (element.hasAttribute(BROWSER_MOVING_ATTRIBUTE) && holesSupported) {
      // Where it is drawn now; the page keeps it beneath until a still
      // image can show through any gap.
      moving.push({
        x: box.left - bounds.x,
        y: box.top - bounds.y,
        width: box.right - box.left,
        height: box.bottom - box.top,
        radius: Math.min(
          cornerRadius(style) * effectiveCssZoom(element),
          (box.right - box.left) / 2,
          (box.bottom - box.top) / 2,
        ),
      });
      for (
        let node: HTMLElement | null = element;
        node && node !== document.body && !movingAnimates;
        node = node.parentElement
      )
        movingAnimates = isEntering(node);
      continue;
    }
    if (!holesSupported) {
      capture = true;
      break;
    }
    const final = finalBox(element, box, style);
    const visibleWidth =
      Math.min(area.right, final.right) - Math.max(area.left, final.left);
    const visibleHeight =
      Math.min(area.bottom, final.bottom) - Math.max(area.top, final.top);
    if (visibleWidth < 0.5 || visibleHeight < 0.5) continue;
    // Send the menu's whole rounded shape, not its intersection with the
    // page: rounding a clipped rectangle bites into a menu that crosses the
    // page edge. The native mask subtracts it from the page shape exactly.
    const width = final.right - final.left;
    const height = final.bottom - final.top;
    found.push({
      element,
      visibleArea: visibleWidth * visibleHeight,
      hole: {
        x: final.left - bounds.x,
        y: final.top - bounds.y,
        width,
        height,
        radius: Math.min(cornerRadius(style), width / 2, height / 2),
      },
    });
  }
  if (capture)
    return { capture: true, holes: [], elements: [], moving, movingAnimates };
  // A popover frame, its animated surface and its menu list nest. Keep only
  // the outermost cut so overlapping paths never cancel each other out.
  // When a square frame and its rounded surface share one box (bare
  // popovers), keep the rounded one so no square corner exposes the page.
  const kept = found
    .filter(
      (entry, index) =>
        !found.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            contains(other.hole, entry.hole) &&
            (!contains(entry.hole, other.hole) || otherIndex < index),
        ),
    )
    .map((entry) => {
      const radius = Math.max(
        entry.hole.radius,
        ...found
          .filter(
            (other) =>
              contains(other.hole, entry.hole) &&
              contains(entry.hole, other.hole),
          )
          .map((other) => other.hole.radius),
      );
      return { ...entry, hole: { ...entry.hole, radius } };
    });
  if (!kept.length)
    return moving.length || shade
      ? { ...NONE, moving, movingAnimates, ...(shade ? { shade } : {}) }
      : NONE;
  const covered = kept.reduce((sum, entry) => sum + entry.visibleArea, 0);
  // A dimmed page is cut however much of it a dialog covers: what is left
  // of it stays live, and nothing is captured.
  if (
    kept.length > MAX_BROWSER_HOLES ||
    (!shade && covered > areaWidth * areaHeight * BROWSER_HOLE_AREA_LIMIT)
  )
    return { capture: true, holes: [], elements: [], moving, movingAnimates };
  return {
    capture: false,
    holes: kept.map(({ hole }) => hole),
    elements: kept.map(({ element }) => element),
    moving,
    movingAnimates,
    ...(shade ? { shade } : {}),
  };
}
