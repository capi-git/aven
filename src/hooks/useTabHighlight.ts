import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { effectiveCssZoom } from "../lib/drag";
import { motionReduced, playBounded, type BoundedMotion } from "../lib/motion";
import { TAB_PX_PRECISION, TAB_SPRING } from "../lib/motionTokens";
import { springKeyframes } from "../lib/spring";
import {
  TAB_SLIDE_EASE,
  TAB_SLIDE_MS,
  highlightKeyframes,
  planHighlight,
  sameTrackBox,
  type TrackBox,
} from "../lib/tabTrack";

/** Marks the element whose box the highlight takes: one per tab. */
export const TAB_TRACK_ID_ATTRIBUTE = "data-tab-track-id";

function trackSlot(strip: HTMLElement, id: string): HTMLElement | null {
  for (const slot of strip.querySelectorAll<HTMLElement>(
    `[${TAB_TRACK_ID_ATTRIBUTE}]`,
  ))
    if (slot.getAttribute(TAB_TRACK_ID_ATTRIBUTE) === id) return slot;
  return null;
}

/** A box on screen as a place along the strip's scrolled content. */
function boxIn(
  strip: HTMLElement,
  rect: { left: number; width: number },
): TrackBox {
  const zoom = effectiveCssZoom(strip) || 1;
  const outer = strip.getBoundingClientRect();
  return {
    x: (rect.left - outer.left) / zoom + strip.scrollLeft - strip.clientLeft,
    width: rect.width / zoom,
  };
}

/**
 * One highlight under a strip's tabs that slides to the tab in front
 * (see tabTrack.ts). The strip draws `<span ref={…} className=
 * "aven-tab-highlight">` as its first child and marks each tab's outer box
 * with `data-tab-track-id`. While the highlight is drawn the strip carries
 * `data-tab-highlight="on"` and the front tab leaves its own fill to it;
 * with `enabled` false (a tab being dragged, a lone tab) the front tab
 * draws its own fill again.
 *
 * Placement is measured after layout, from the tab's own box, so a slide
 * never waits for an animation frame (WebKit defers those while a Chromium
 * page covers it) and runs on the compositor as a transform.
 */
export function useTabHighlight(
  strip: RefObject<HTMLElement | null>,
  frontId: string | null,
  {
    enabled,
    layoutKey,
    glideFrom,
  }: {
    enabled: boolean;
    layoutKey: string;
    /**
     * After a drop or a split coming apart, the box on screen the tab in
     * front stood in (once): the highlight glides from there on the same
     * spring the strip morphs on, rather than appearing in place.
     */
    glideFrom?: (
      id: string,
    ) => { left: number; width: number; velocity?: number } | null;
  },
) {
  const highlight = useRef<HTMLElement | null>(null);
  const state = useRef<{
    front: string | null;
    box: TrackBox | null;
    from: TrackBox | null;
    slide: BoundedMotion | null;
  }>({ front: null, box: null, from: null, slide: null });
  const current = useRef({ frontId, enabled, glideFrom });
  current.current = { frontId, enabled, glideFrom };

  const place = useCallback(() => {
    const root = strip.current;
    const element = highlight.current;
    if (!root || !root.isConnected) return;
    if (!element) {
      // No highlight drawn: the front tab keeps its own fill.
      if (root.dataset.tabHighlight === "on") root.dataset.tabHighlight = "off";
      state.current.box = null;
      return;
    }
    const { frontId: front, enabled: on, glideFrom: origin } = current.current;
    const slot = on && front ? trackSlot(root, front) : null;
    const rect = slot?.getBoundingClientRect();
    // A strip that is not laid out (hidden) keeps what it had until shown.
    if (slot && rect && rect.width <= 0 && rect.height <= 0) return;
    const target = slot && rect ? boxIn(root, rect) : null;
    const running = state.current.slide?.animation ?? null;
    const drawn = running
      ? boxIn(root, element.getBoundingClientRect())
      : state.current.box;
    const plan = planHighlight({
      previousFront: state.current.front,
      drawn,
      front: front ?? null,
      target,
      reduced: motionReduced(),
    });
    state.current.front = front ?? null;
    const show = plan.to ? "on" : "off";
    if (root.dataset.tabHighlight !== show) root.dataset.tabHighlight = show;
    if (!plan.to) {
      state.current.slide?.stop();
      state.current.slide = null;
      state.current.box = null;
      state.current.from = null;
      return;
    }
    const to = plan.to;
    if (!sameTrackBox(state.current.box, to) || !element.style.width) {
      element.style.width = `${to.width}px`;
      element.style.transform = `translateX(${to.x}px)`;
    }
    state.current.box = to;
    // Where the tab in front stood before a drop or morph: glide from there
    // on the strip's spring.
    const stood = front ? origin?.(front) : null;
    const glide =
      stood && !motionReduced() && typeof element.animate === "function"
        ? springKeyframes(
            {
              x: {
                spring: TAB_SPRING.move,
                from: boxIn(root, stood).x,
                to: to.x,
                // With the speed its tab had, so the two move as one.
                velocity: (stood.velocity ?? 0) / (effectiveCssZoom(root) || 1),
                precision: TAB_PX_PRECISION,
              },
              width: {
                spring: TAB_SPRING.move,
                from: stood.width / (effectiveCssZoom(root) || 1),
                to: to.width,
                velocity: 0,
                precision: TAB_PX_PRECISION,
              },
            },
            ({ x, width }) => ({
              transform: `translateX(${x}px) scaleX(${to.width > 0 ? width / to.width : 1})`,
            }),
          )
        : null;
    if (glide) {
      state.current.slide?.stop();
      state.current.from = null;
      const slide = playBounded(
        element,
        glide.keyframes,
        { duration: glide.ms, easing: "linear" },
        () => {
          if (state.current.slide === slide) state.current.slide = null;
        },
      );
      state.current.slide = slide;
    } else if (plan.from && typeof element.animate === "function") {
      state.current.slide?.stop();
      const from = plan.from;
      state.current.from = from;
      // Bounded: if WebKit holds the timeline back, the highlight still
      // ends up under the front tab.
      const slide = playBounded(
        element,
        highlightKeyframes(from, to),
        { duration: TAB_SLIDE_MS, easing: TAB_SLIDE_EASE },
        () => {
          if (state.current.slide !== slide) return;
          state.current.slide = null;
          state.current.from = null;
        },
      );
      state.current.slide = slide;
    } else if (running && state.current.from) {
      // The strip changed shape mid-slide (a tab growing in): keep sliding,
      // towards where the front tab is now.
      const effect = running.effect;
      if (effect instanceof KeyframeEffect)
        effect.setKeyframes(highlightKeyframes(state.current.from, to));
    }
  }, [strip]);

  // Every commit that can move the front tab: a new front, tabs opening,
  // closing or reordering.
  useLayoutEffect(place, [place, frontId, enabled, layoutKey]);

  // Layout that changes without a render: the window resizing, a tab
  // growing in or a closed one's space collapsing.
  useLayoutEffect(() => {
    const root = strip.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => place());
    observer.observe(root);
    for (const slot of root.querySelectorAll(`[${TAB_TRACK_ID_ATTRIBUTE}]`))
      observer.observe(slot);
    return () => observer.disconnect();
  }, [strip, place, layoutKey]);

  useLayoutEffect(
    () => () => {
      state.current.slide?.stop();
      state.current.slide = null;
    },
    [],
  );

  return useCallback((element: HTMLElement | null) => {
    highlight.current = element;
  }, []);
}
