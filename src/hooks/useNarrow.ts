import {
  useCallback,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";

/**
 * What an element's width in CSS pixels works out to (`choose` gets 0 until it
 * is laid out), for controls that drop their words for icons in a narrow chat
 * rather than cutting them off. It renders when the answer changes, not on every
 * frame of a sidebar or pane drag. Measured here, not by a container query:
 * WebKit sizes a container after interface zoom. Pass the returned ref to the
 * element; it may mount later than the component.
 */
export function useWidthChoice<T extends HTMLElement, V>(
  choose: (width: number) => V,
): [(node: T | null) => void, V] {
  const [node, setNode] = useState<T | null>(null);
  const [, render] = useReducer((count: number) => count + 1, 0);
  const width = useRef(0);
  const latest = useRef(choose);
  latest.current = choose;
  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => {
      const current = node.clientWidth;
      // Not laid out (a parked pane): keep what was known.
      if (current <= 0) return;
      const before = latest.current(width.current);
      width.current = current;
      if (!Object.is(before, latest.current(current))) render();
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  const ref = useCallback((next: T | null) => setNode(next), []);
  return [ref, choose(width.current)];
}

/** Whether an element is narrower than `width` CSS pixels (see `useWidthChoice`). */
export function useNarrow<T extends HTMLElement>(
  width: number,
): [(node: T | null) => void, boolean] {
  return useWidthChoice<T, boolean>(
    (current) => current > 0 && current < width,
  );
}

/**
 * Keeps `data-narrow` on an element while it is narrower than `width` CSS
 * pixels, without a render, for its styles to follow. Use it in place of a
 * container query on anything large: WebKit rechecks every element under a
 * container each time it changes size, about 40 ms a frame in a long chat. This
 * touches them only when the width crosses the line.
 */
export function useNarrowMark(node: HTMLElement | null, width: number) {
  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => {
      const current = node.clientWidth;
      if (current > 0) node.toggleAttribute("data-narrow", current < width);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, width]);
}
