import { useLayoutEffect } from "react";

/** The limits a content width is at or under, as `data-width-bands` holds them. */
export function widthBands(width: number, limits: readonly number[]): string {
  return limits.filter((limit) => width <= limit).join(" ");
}

/**
 * Marks an element with the width limits its content box is under, for CSS
 * that would otherwise ask with `@container`. WebKit restyles everything inside
 * a query container each time its size changes, whether or not a query's
 * answer did: 20 ms per sidebar toggle around a chat. This restyles only when
 * a limit is crossed, so use it where the element holds a lot.
 *
 * The observer reports before the first paint. A hidden element (width 0) keeps
 * its marks, so coming back restyles nothing.
 */
export function useWidthBands(
  element: HTMLElement | null,
  limits: readonly number[],
) {
  useLayoutEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries.at(-1)?.contentRect?.width ?? 0;
      if (width <= 0) return;
      const bands = widthBands(width, limits);
      if (bands === (element.getAttribute("data-width-bands") ?? "")) return;
      if (bands) element.setAttribute("data-width-bands", bands);
      else element.removeAttribute("data-width-bands");
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, limits]);
}
