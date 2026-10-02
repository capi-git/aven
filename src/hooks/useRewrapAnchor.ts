import { useCallback, useEffect, useRef } from "react";
import {
  captureScrollAnchor,
  restoreScrollAnchor,
  type ScrollAnchor,
} from "../lib/scrollAnchor";

/**
 * Keep the line at the top of a scroller in place when its text rewraps at a
 * new width. Content changes at an unchanged width keep the plain scroll
 * offset, as `overflow-anchor: none` asks for.
 */
export function useRewrapAnchor<T extends HTMLElement>() {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    let anchor: ScrollAnchor | null = null;
    // Nothing above the first line can move it.
    const capture = () => {
      anchor = el.scrollTop > 0 ? captureScrollAnchor(el) : null;
    };
    const onScroll = () => {
      if (anchor?.scrollTop === el.scrollTop && anchor.element.isConnected)
        return;
      capture();
    };
    const onResize = () => {
      if (!anchor || !anchor.element.isConnected) return capture();
      const width = anchor.element.getBoundingClientRect().width;
      if (width === anchor.width || !restoreScrollAnchor(el, anchor)) capture();
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener("scroll", onScroll, { passive: true });
    cleanup.current = () => {
      observer.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, []);
}
