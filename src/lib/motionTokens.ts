import { MOTION_MS } from "./motion";
import { springCurve, type Spring } from "./spring";

/**
 * The motion of moving tabs: picking one up, the others making room, the
 * drop, combining, tearing out and the pane drop previews. One spring family
 * and one set of numbers, so every part of it moves alike.
 *
 * Springs use Apple's two parameters (see spring.ts): damping 1 settles
 * without overshoot; response is roughly the seconds to get most of the way.
 * `motion.css` carries `move` and `lift` as sampled `linear()` curves for
 * the CSS that eases with them; motionTokens.test.ts keeps both in step.
 */
export const TAB_SPRING = {
  /** Things that travel: siblings, the drop, flying home, morphs, previews. */
  move: { damping: 1, response: 0.22 },
  /** The drop after a quick release: a touch of overshoot, from the throw. */
  flick: { damping: 0.86, response: 0.22 },
  /** Picking up and putting down: scale, shadow and face. */
  lift: { damping: 1, response: 0.18 },
  /** Snapping out of the strip's rubber band, and back into it. */
  pop: { damping: 0.78, response: 0.22 },
} as const satisfies Record<string, Spring>;

/**
 * `move` and `lift` as CSS curves (`--aven-tab-spring-move`, `-lift` and
 * their `-ms` in TitleBar.css), sampled to within 0.4% of the target.
 */
export const TAB_CSS_SPRINGS = {
  move: springCurve(TAB_SPRING.move, { precision: 0.004 }),
  lift: springCurve(TAB_SPRING.lift, { precision: 0.004 }),
} as const;

/**
 * A picked-up tab closes in around the pointer into a compact chip, its
 * icon and name, no wider than this (px); over a pane, where it should not
 * hide the drop preview, a smaller one.
 */
export const TAB_CHIP_MAX_WIDTH = 176;
export const TAB_CHIP_TINY_WIDTH = 112;
/** How much a picked-up tab grows. */
export const TAB_LIFT_SCALE = 1.02;
/** Let go faster than this (px/s) and the drop overshoots a little. */
export const TAB_FLICK_SPEED = 500;
/**
 * A copy flying to its place keeps its floating face until it is this close
 * (px), then is set down into the tab's resting look.
 */
export const TAB_SET_DOWN_PX = 3;
/** Rubber band over the strip's height; UIScrollView's constant. */
export const TAB_RUBBER_BAND = 0.55;
/** Pointer moves older than this (ms) say nothing about the release speed. */
export const TAB_VELOCITY_WINDOW_MS = 80;
/** A pane drop preview fades in and out this fast. */
export const TAB_PREVIEW_FADE_MS = MOTION_MS.fast;
/** And grows in from this scale, about the pointer. */
export const TAB_PREVIEW_ENTER_SCALE = 0.97;
/** With reduced motion, things that would move crossfade this fast instead. */
export const TAB_REDUCED_FADE_MS = MOTION_MS.fast;

/** Position precision: a quarter of a CSS pixel is below what shows. */
export const TAB_PX_PRECISION = 0.25;
/** Scale and opacity precision. */
export const TAB_UNIT_PRECISION = 0.002;
