import { useCallback, useEffect, useRef, useState } from "react";

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

/** Marks a scroller whose host (`useLockOverscrollWithin`) contains its wheel. */
export const LOCK_OVERSCROLL_ATTRIBUTE = "data-lock-overscroll";

/**
 * Contains the wheel, as `useLockOverscroll` does, for every scroller marked
 * `data-lock-overscroll` inside a host that outlives them (a file tree made
 * again for each project). In WebKit, adding or removing a wheel listener
 * restyles the whole page (~35 ms), so a scroller coming or going must not:
 * the host holds the one listener, while `enabled`.
 */
export function useLockOverscrollWithin<T extends HTMLElement>(enabled = true) {
  const [host, setHost] = useState<T | null>(null);
  useEffect(() => {
    if (!host || !enabled) return;
    const onWheel = (event: WheelEvent) => {
      const scroller =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(`[${LOCK_OVERSCROLL_ATTRIBUTE}]`)
          : null;
      if (scroller && host.contains(scroller)) lockOverscroll(scroller, event);
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [host, enabled]);
  return setHost;
}
