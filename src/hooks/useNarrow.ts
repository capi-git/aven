import { useCallback, useLayoutEffect, useState } from "react";

/**
 * An element's width in CSS pixels, kept current as it resizes (0 until it
 * is laid out), for controls that drop their words for icons in a narrow
 * chat rather than cutting them off. Measured here, not by a container
 * query: WebKit sizes a container after interface zoom. Pass the returned
 * ref to the element; it may mount later than the component.
 */
export function useWidth<T extends HTMLElement>(): [
  (node: T | null) => void,
  number,
] {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => {
      const current = node.clientWidth;
      // Not laid out (a parked pane): keep what was known.
      if (current > 0) setWidth(current);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  const ref = useCallback((next: T | null) => setNode(next), []);
  return [ref, width];
}

/** Whether an element is narrower than `width` CSS pixels (see `useWidth`). */
export function useNarrow<T extends HTMLElement>(
  width: number,
): [(node: T | null) => void, boolean] {
  const [ref, current] = useWidth<T>();
  return [ref, current > 0 && current < width];
}
