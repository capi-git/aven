export function setGrabbing(on: boolean) {
  document.body.style.cursor = on ? "grabbing" : "";
}

/** Convert viewport CSS distances into an element's local CSS distances.
 * Page zoom affects client coordinates and bounds equally; only CSS zoom on
 * this element and its ancestors belongs in this conversion. */
export function effectiveCssZoom(element: HTMLElement): number {
  const current = element.currentCSSZoom;
  if (Number.isFinite(current) && current > 0) return current;
  // Older WebKit and DOM test environments do not expose currentCSSZoom.
  let zoom = 1;
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    const value = getComputedStyle(node).zoom || "1";
    const factor = Number.parseFloat(value) / (value.endsWith("%") ? 100 : 1);
    if (Number.isFinite(factor) && factor > 0) zoom *= factor;
  }
  return zoom;
}

/**
 * How this engine reports the client rects of an element under CSS zoom.
 * "standard" (standardized CSS zoom, what macOS 27's WebKit does): in the
 * viewport's pixels. "legacy" (WebKit before it): divided by the
 * element's effective CSS zoom. Aven supports macOS releases with either,
 * and the window strip is CSS-zoomed, so this is measured once, with a probe.
 */
export type CssZoomRects = "standard" | "legacy";
let zoomRects: CssZoomRects | undefined;

export function cssZoomRects(): CssZoomRects {
  if (zoomRects) return zoomRects;
  if (typeof document === "undefined" || !document.body) return "standard";
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;left:0;top:0;width:10px;height:10px;zoom:2;visibility:hidden;pointer-events:none";
  document.body.append(probe);
  try {
    const width = probe.getBoundingClientRect().width;
    // A DOM without layout (tests) measures nothing; ask again later.
    if (!(width > 0)) return "standard";
    zoomRects = Math.abs(width - 10) < 1 ? "legacy" : "standard";
    return zoomRects;
  } finally {
    probe.remove();
  }
}

/** Tests: pretend the engine reports zoomed rects one way, or measure again. */
export function setCssZoomRectsForTests(mode: CssZoomRects | undefined) {
  zoomRects = mode;
}

/**
 * What `element`'s reported client rects are multiplied by to be in the
 * viewport's pixels, the pointer's (`clientX`, `elementFromPoint`): its
 * effective CSS zoom on a legacy engine, else 1.
 */
export function clientRectScale(element: HTMLElement): number {
  if (cssZoomRects() !== "legacy") return 1;
  const zoom = effectiveCssZoom(element);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/** A rect `element` reported (`getClientRects`), in the viewport's pixels. */
export function viewportRect(
  element: HTMLElement,
  rect: Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">,
): { left: number; top: number; right: number; bottom: number } {
  const zoom = clientRectScale(element);
  return {
    left: rect.left * zoom,
    top: rect.top * zoom,
    right: rect.right * zoom,
    bottom: rect.bottom * zoom,
  };
}

/**
 * `clientRectScale` for one gesture: each element's measured once, since
 * zoom does not change mid-drag, and without `currentCSSZoom` measuring
 * reads every ancestor's style.
 */
export function clientRectScales(): (element: HTMLElement) => number {
  const scales = new WeakMap<HTMLElement, number>();
  return (element) => {
    if (cssZoomRects() !== "legacy") return 1;
    let scale = scales.get(element);
    if (scale === undefined) {
      scale = clientRectScale(element);
      scales.set(element, scale);
    }
    return scale;
  };
}

/**
 * The pointer (`clientX`, `clientY`: the viewport's pixels) where rects
 * that scale by `scale` (`clientRectScale`) are reported, for hit tests
 * against them. The window strip cancels the interface zoom with CSS zoom,
 * and older WebKit reports its rects divided by that zoom, so the pointer
 * is divided too; elsewhere, and on the standard engine, it is as it is.
 */
export function pointInRects(
  point: { x: number; y: number },
  scale: number,
): { x: number; y: number } {
  return scale === 1 ? point : { x: point.x / scale, y: point.y / scale };
}

/**
 * How a press or drag of a sortable ended: let go (`release`), Escape, a
 * cancelling event by its type (`blur` is the window's own, never an
 * element's), or `cancel` (a new press, or the sortable going away).
 */
export type DragEnd = {
  how:
    | "release"
    | "Escape"
    | "blur"
    | "pointercancel"
    | "lostpointercapture"
    | "cancel";
  /** Whether the page had focus then (`document.hasFocus()`). */
  focused: boolean;
  /** When, on `performance.now()`'s clock. */
  at: number;
};

let lastEnd: DragEnd | null = null;

/** A sortable's press or drag has ended, `how`. */
export function noteDragEnd(how: DragEnd["how"]) {
  lastEnd = {
    how,
    focused: typeof document.hasFocus === "function" && document.hasFocus(),
    at: performance.now(),
  };
}

/**
 * How the last press or drag of any sortable ended, so the real-app check
 * can say what ended a drag it was still carrying.
 */
export function lastDragEnd(): DragEnd | null {
  return lastEnd;
}

/** Block native text selection for the duration of a reorder gesture. */
export function suppressTextSelection() {
  const onSelectStart = (event: Event) => {
    event.preventDefault();
  };
  window.addEventListener("selectstart", onSelectStart);
  document.documentElement.classList.add("is-reordering");
  window.getSelection()?.removeAllRanges();
  return () => {
    window.removeEventListener("selectstart", onSelectStart);
    document.documentElement.classList.remove("is-reordering");
    window.getSelection()?.removeAllRanges();
  };
}
