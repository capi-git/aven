/**
 * A floating sidebar's slide and a native browser page's leading edge only
 * move together if they start together. The page animates its own edge after
 * its layout crosses processes, so the workspace picks the moment: it starts
 * the panel's CSS slide (and the workspace crop that follows it) at a set
 * time and gives the page that same wall-clock time.
 */

/** How long a close waits for a native page's layout to arrive, so both
 * edges leave together instead of the page trailing behind a dark gap. */
export const NATIVE_SLIDE_CLOSE_LEAD_MS = 48;

export type SharedSlide = {
  /** When the slide starts, in milliseconds since 1970. */
  at: number;
  /** How long it lasts, in milliseconds. */
  duration: number;
};

function isTransformTransition(animation: Animation) {
  return (
    typeof CSSTransition !== "undefined" &&
    animation instanceof CSSTransition &&
    animation.transitionProperty === "transform"
  );
}

/**
 * Start the transitions and animations that an open-state change just created
 * on `elements` together, `lead` ms from now, and return when the panel's
 * slide (its transform transition) starts and how long it lasts. A slide that
 * already has a start, set by another page reacting to the same change,
 * keeps it. Null when nothing slides, as with reduced motion.
 */
export function startSharedSlide(
  elements: readonly (Element | null | undefined)[],
  lead: number,
): SharedSlide | null {
  const animations = elements.flatMap((element) =>
    element && typeof element.getAnimations === "function"
      ? element.getAnimations()
      : [],
  );
  const slide = animations.find(
    (animation) =>
      animation.playState !== "idle" && isTransformTransition(animation),
  );
  if (!slide) return null;
  const timing = slide.effect?.getComputedTiming();
  const duration = Number(timing?.duration);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  // Style changes made in this task have no start time until the next frame.
  const start =
    slide.startTime === null
      ? performance.now() + Math.max(0, lead)
      : Number(slide.startTime);
  for (const animation of animations)
    if (animation.startTime === null && animation.playState !== "idle")
      animation.startTime = start;
  const delay = Number(timing?.delay) || 0;
  return {
    at: Date.now() + (start + delay - performance.now()),
    duration,
  };
}
