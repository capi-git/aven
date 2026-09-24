import { useCallback, useEffect, useRef } from "react";

/** Contain only the intended axis, after any nested scroller had its turn. */
export function lockOverscroll(el: HTMLElement, event: WheelEvent) {
  if (event.defaultPrevented || event.ctrlKey || !event.cancelable) return;
  const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
  const delta = horizontal ? event.deltaX : event.deltaY;
  if (!delta) return;
  const metrics = (node: HTMLElement) =>
    horizontal
      ? [node.scrollLeft, node.clientWidth, node.scrollWidth]
      : [node.scrollTop, node.clientHeight, node.scrollHeight];
  // Most wheel events land mid-scroll. Only an edge can be contained, so skip
  // the nested-scroller walk and its style reads until this element hits one.
  const [position, size, total] = metrics(el);
  if (
    total <= size + 1 ||
    (delta < 0 ? position > 0 : position + size < total - 1)
  )
    return;
  for (
    let node = event.target instanceof HTMLElement ? event.target : null;
    node && node !== el;
    node = node.parentElement
  ) {
    const [position, size, total] = metrics(node);
    if (
      total <= size + 1 ||
      (delta < 0 ? position <= 0 : position + size >= total - 1)
    )
      continue;
    const overflow = horizontal
      ? getComputedStyle(node).overflowX
      : getComputedStyle(node).overflowY;
    if (/auto|scroll/.test(overflow)) return;
  }
  event.preventDefault();
}

export function useLockOverscroll<T extends HTMLElement>() {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    const onWheel = (event: WheelEvent) => lockOverscroll(el, event);
    el.addEventListener("wheel", onWheel, { passive: false });
    cleanup.current = () => el.removeEventListener("wheel", onWheel);
  }, []);
}
