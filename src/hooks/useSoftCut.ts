import { useCallback, useEffect, useRef, useState } from "react";
import { cutMiddle, edgeFades, stuckShadow } from "../lib/softCut";
import "../chrome/SoftCut.css";

// Hooks for softer cut-offs (src/lib/softCut.ts). Each measures with a
// ResizeObserver, whose report comes after layout, so none of them makes
// WebKit lay out early; and each writes only when what it shows changes.

type FadeCutState = { outer: number; inner: number };
const fadeCuts = new WeakMap<Element, FadeCutState>();
const fadeOwners = new WeakMap<Element, Element>();
let fadeObserver: ResizeObserver | null = null;

function observeFadeCut(outer: HTMLElement) {
  if (typeof ResizeObserver === "undefined") return () => {};
  fadeObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      const owner = fadeOwners.get(entry.target) ?? entry.target;
      const state = fadeCuts.get(owner);
      if (!state) continue;
      const width = entry.contentRect.width;
      // Hidden (a pane out of sight, Settings over the workspace): keep the
      // label as it was, so showing it again changes nothing.
      if (width <= 0) continue;
      if (entry.target === owner) state.outer = width;
      else state.inner = width;
      const cut = state.outer > 0 && state.inner > state.outer + 0.5;
      if (owner.hasAttribute("data-cut") !== cut)
        owner.toggleAttribute("data-cut", cut);
    }
  });
  const inner = outer.firstElementChild;
  fadeCuts.set(outer, { outer: 0, inner: 0 });
  fadeObserver.observe(outer);
  if (inner) {
    fadeOwners.set(inner, outer);
    fadeObserver.observe(inner);
  }
  return () => {
    // Stand-in observers in tests may have no unobserve.
    if (typeof fadeObserver?.unobserve === "function") {
      fadeObserver.unobserve(outer);
      if (inner) fadeObserver.unobserve(inner);
    }
    fadeCuts.delete(outer);
  };
}

/**
 * A ref for a one-line label (`.fade-cut` holding one `.fade-cut-text`) that
 * marks it `data-cut` while its text runs past its end, so its last 1.5em
 * fades out instead of ending in "…". The whole text stays in the label.
 */
export function useFadeCut<T extends HTMLElement>() {
  const stop = useRef<(() => void) | null>(null);
  return useCallback((element: T | null) => {
    stop.current?.();
    stop.current = element ? observeFadeCut(element) : null;
  }, []);
}

const widths = new Map<string, CanvasRenderingContext2D | null>();

function measurer(font: string): ((value: string) => number) | null {
  let context = widths.get(font);
  if (context === undefined) {
    context =
      typeof document !== "undefined"
        ? document.createElement("canvas").getContext("2d")
        : null;
    if (context) context.font = font;
    widths.set(font, context);
  }
  return context ? (value) => context.measureText(value).width : null;
}

/**
 * The text to show for a path or file name in an element of a given width:
 * the whole of it when it fits, or both ends with "…" for the middle. Pass
 * the returned ref to the element; give the element `title` the whole text.
 */
export function useMiddleCut<T extends HTMLElement>(
  text: string,
): [(element: T | null) => void, string] {
  const [element, setElement] = useState<T | null>(null);
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") {
      setShown(text);
      return;
    }
    let measure: ((value: string) => number) | null = null;
    const fit = (width: number) => {
      if (width <= 0) return;
      measure ??= measurer(getComputedStyle(element).font);
      const next = measure ? cutMiddle(text, width, measure) : text;
      setShown((current) => (current === next ? current : next));
    };
    const observer = new ResizeObserver(([entry]) =>
      fit(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, text]);
  const ref = useCallback((next: T | null) => setElement(next), []);
  return [ref, shown];
}

/**
 * Keeps a scroll area's edge fades and header shadow in step with where it
 * has scrolled: `--aven-edge-top` and `--aven-edge-bottom` (0 to 1) while
 * content is hidden past an edge, and `--aven-stuck` (0 to 1) over the first
 * 8 px of scroll. They are registered as not inherited (index.css), so a
 * change restyles the scroll area alone, never what it holds; and they are
 * written only when they change, which is only near an edge.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const stop = useRef<(() => void) | null>(null);
  return useCallback((element: T | null) => {
    stop.current?.();
    stop.current = null;
    if (!element) return;
    let last = "";
    let frame = 0;
    const update = () => {
      frame = 0;
      const { scrollTop, scrollHeight, clientHeight } = element;
      const fades = edgeFades(scrollTop, scrollHeight, clientHeight);
      const stuck = stuckShadow(scrollTop);
      const key = `${fades.top}/${fades.bottom}/${stuck}`;
      if (key === last) return;
      last = key;
      element.style.setProperty("--aven-edge-top", String(fades.top));
      element.style.setProperty("--aven-edge-bottom", String(fades.bottom));
      element.style.setProperty("--aven-stuck", String(stuck));
      element.toggleAttribute("data-edge-fade", fades.top + fades.bottom > 0);
      element.toggleAttribute("data-stuck", stuck > 0);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    element.addEventListener("scroll", schedule, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(element);
    for (const child of element.children) observer?.observe(child);
    schedule();
    stop.current = () => {
      element.removeEventListener("scroll", schedule);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
