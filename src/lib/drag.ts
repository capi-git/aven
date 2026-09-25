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
