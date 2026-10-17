import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

type Point = { x: number; y: number };

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Cards that moved since the last commit glide from where they were, even
 * into another column: each card is found by its `data-glide-key`, so a
 * card React remounted elsewhere still starts from its old place. Only
 * transforms move (the stylesheet sets the transition on `[data-gliding]`);
 * a card that appeared fades in through `data-glide-enter`. Nothing moves
 * with reduced motion. Positions are read after each commit, and again after
 * the container scrolls or resizes, never on a timer.
 */
export function useCardGlide(
  container: RefObject<HTMLElement | null>,
  /** Changes whenever cards may have moved, such as their ids in order. */
  layoutKey: string,
): void {
  const places = useRef<Map<string, Point> | null>(null);
  const frame = useRef<number | null>(null);

  const measure = (root: HTMLElement): Map<string, Point> => {
    const origin = root.getBoundingClientRect();
    const next = new Map<string, Point>();
    for (const card of root.querySelectorAll<HTMLElement>("[data-glide-key]")) {
      const key = card.dataset.glideKey;
      if (!key) continue;
      const rect = card.getBoundingClientRect();
      next.set(key, {
        x: rect.left - origin.left + root.scrollLeft,
        y: rect.top - origin.top + root.scrollTop,
      });
    }
    return next;
  };

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const before = places.current;
    const origin = root.getBoundingClientRect();
    const moving: { card: HTMLElement; dx: number; dy: number }[] = [];
    const entering: HTMLElement[] = [];
    const after = new Map<string, Point>();
    for (const card of root.querySelectorAll<HTMLElement>("[data-glide-key]")) {
      const key = card.dataset.glideKey;
      if (!key) continue;
      const rect = card.getBoundingClientRect();
      const place = {
        x: rect.left - origin.left + root.scrollLeft,
        y: rect.top - origin.top + root.scrollTop,
      };
      after.set(key, place);
      if (!before) continue;
      const was = before.get(key);
      if (!was) entering.push(card);
      else if (
        Math.abs(was.x - place.x) > 0.5 ||
        Math.abs(was.y - place.y) > 0.5
      )
        moving.push({ card, dx: was.x - place.x, dy: was.y - place.y });
    }
    places.current = after;
    if (reducedMotion()) return;
    for (const card of entering) card.setAttribute("data-glide-enter", "");
    if (!moving.length && !entering.length) return;
    // Draw each moved card where it was, then let it glide to its place.
    for (const { card, dx, dy } of moving) {
      card.setAttribute("data-gliding", "start");
      card.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      for (const { card } of moving) {
        if (!card.isConnected) continue;
        card.setAttribute("data-gliding", "");
        card.style.transform = "";
        const done = (event: TransitionEvent) => {
          if (event.target !== card || event.propertyName !== "transform")
            return;
          card.removeEventListener("transitionend", done);
          card.removeAttribute("data-gliding");
        };
        card.addEventListener("transitionend", done);
      }
      for (const card of entering) {
        const done = () => {
          card.removeEventListener("animationend", done);
          card.removeAttribute("data-glide-enter");
        };
        card.addEventListener("animationend", done);
      }
    });
  }, [container, layoutKey]);

  // Scrolling or resizing moves cards without a commit: read them again so
  // the next change glides from where they really are.
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    let pending: number | null = null;
    const remeasure = () => {
      if (pending !== null) return;
      pending = requestAnimationFrame(() => {
        pending = null;
        if (places.current) places.current = measure(root);
      });
    };
    root.addEventListener("scroll", remeasure, { passive: true });
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(remeasure)
        : null;
    observer?.observe(root);
    return () => {
      root.removeEventListener("scroll", remeasure);
      observer?.disconnect();
      if (pending !== null) cancelAnimationFrame(pending);
    };
  }, [container]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
}
