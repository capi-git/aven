import { MOTION_MS } from "./motion";
import { springAt, springCurve, type Spring } from "./spring";

/**
 * The motion of moving tabs: picking one up, the others making room, the
 * drop, combining, tearing out and the pane drop previews. One spring family
 * and one set of numbers, so every part of it moves alike.
 *
 * Springs use Apple's two parameters (see spring.ts): damping 1 settles
 * without overshoot; response is roughly the seconds to get most of the way.
 * TitleBar.css carries `move` and `lift` as sampled `linear()` curves for
 * the CSS that eases with them, behind `@supports`: WebKit before Safari
 * 17.2 has no `linear()` and uses the cubic-bézier set before it. Script
 * never needs `linear()`: its springs are sampled keyframes played with the
 * plain "linear" keyword. motionTokens.test.ts keeps both in step.
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
  /**
   * A quick fade, as Aven's other fades (`MOTION_MS.fast`, 120ms): a pane
   * drop preview coming and going.
   */
  fade: { damping: 1, response: 0.076 },
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
/** And grows in from this scale, about the pointer. */
export const TAB_PREVIEW_ENTER_SCALE = 0.97;
/** With reduced motion, things that would move crossfade this fast instead. */
export const TAB_REDUCED_FADE_MS = MOTION_MS.fast;

/** Position precision: a quarter of a CSS pixel is below what shows. */
export const TAB_PX_PRECISION = 0.25;
/** Scale and opacity precision. */
export const TAB_UNIT_PRECISION = 0.002;

/**
 * The helm's dialog unfurling from its tail (see `ComposerHelm`): one
 * critically damped spring, so it never overshoots a menu that only opened,
 * sampled at a pixel-art beat and snapped to the critter's 3px grid. The
 * frame grows in a few whole steps instead of a smooth scale, as a sprite
 * would, and the lines type in once it is full size.
 */
export const HELM_SPRING = {
  unfurl: { damping: 1, response: 0.3 },
} as const satisfies Record<string, Spring>;

/** One beat of the unfurl, in ms: the frame changes size once per beat. */
export const HELM_UNFURL_BEAT_MS = 40;
/** The frame's steps before it is full size; the rows follow. */
export const HELM_UNFURL_STEPS = 4;
/** The grid the frame's size snaps to: one critter pixel. */
export const HELM_PIXEL = 3;

/**
 * The frame's size at each beat of the unfurl, as fractions of its full
 * width and height: the spring's progress at each beat, snapped down to the
 * pixel grid of a frame `size` px across, the last step always whole.
 */
export function helmUnfurlSteps(
  size: number,
  {
    beatMs = HELM_UNFURL_BEAT_MS,
    steps = HELM_UNFURL_STEPS,
    pixel = HELM_PIXEL,
  }: { beatMs?: number; steps?: number; pixel?: number } = {},
): number[] {
  const out: number[] = [];
  for (let step = 1; step <= steps; step++) {
    if (step === steps) {
      out.push(1);
      break;
    }
    const progress = springAt(
      HELM_SPRING.unfurl,
      0,
      1,
      0,
      (step * beatMs) / 1000,
    ).value;
    const snapped = Math.max(
      pixel,
      Math.floor((progress * size) / pixel) * pixel,
    );
    out.push(Math.min(1, snapped / Math.max(size, 1)));
  }
  return out;
}
