import { SETTINGS } from "./settingDefinitions";

/**
 * Aven's motion. Quick, eased-out animations of `transform` and `opacity`
 * only, which make the app feel faster without ever making anything wait:
 * the change they show has already happened when they start.
 *
 * The durations and curves live in `src/motion.css` as CSS variables. These
 * copies are for the one animation script starts itself with the Web
 * Animations API (rows gliding to a new place, see `listMotion.ts`); a test
 * keeps them equal to the CSS.
 *
 * One switch turns all of it off: `html[data-motion="reduce"]`, set when the
 * system or Settings › Appearance asks for reduced motion. The CSS zeroes its
 * durations, and everything here checks `motionReduced()` first.
 */
export const MOTION_MS = {
  fast: 120,
  base: 150,
  glide: 160,
} as const;

export const MOTION_EASE = {
  out: "cubic-bezier(0.22, 1, 0.36, 1)",
  spring: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;

/** The attribute that starts a one-shot animation in motion.css. */
export const MOTION_ATTRIBUTE = "data-aven-motion";
/** On the root: "reduce" or "full". */
export const MOTION_ROOT_ATTRIBUTE = "data-motion";

export type MotionName =
  | "rise"
  | "fade"
  | "roll"
  | "flash"
  | "pane-in"
  /** Where a moved tab landed: its strip entry, segment or pane glows once. */
  | "land";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function reduceQuery(): MediaQueryList | null {
  try {
    return typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
      ? window.matchMedia(REDUCE_QUERY)
      : null;
  } catch {
    return null;
  }
}

export function systemReducesMotion(): boolean {
  return reduceQuery()?.matches === true;
}

/** True when motion is off, by the system's setting or Aven's. */
export function motionReduced(): boolean {
  if (typeof document === "undefined") return true;
  const state = document.documentElement.getAttribute(MOTION_ROOT_ATTRIBUTE);
  if (state) return state === "reduce";
  return systemReducesMotion() || SETTINGS.reduceMotion.load();
}

/** Marks the root from the system's setting and Aven's own. */
export function applyMotionPreference(): void {
  if (typeof document === "undefined") return;
  const reduce = SETTINGS.reduceMotion.load() || systemReducesMotion();
  const value = reduce ? "reduce" : "full";
  const root = document.documentElement;
  if (root.getAttribute(MOTION_ROOT_ATTRIBUTE) !== value)
    root.setAttribute(MOTION_ROOT_ATTRIBUTE, value);
}

/**
 * Applies the preference and follows changes to either setting, in this
 * window and others. Event-driven only; returns a function that stops.
 */
export function initMotionPreference(): () => void {
  applyMotionPreference();
  const query = reduceQuery();
  const onChange = () => applyMotionPreference();
  query?.addEventListener?.("change", onChange);
  const unsubscribe = SETTINGS.reduceMotion.subscribe(onChange);
  return () => {
    query?.removeEventListener?.("change", onChange);
    unsubscribe();
  };
}

const running = new WeakMap<Element, () => void>();

function restartCssAnimation(element: Element) {
  try {
    for (const animation of element.getAnimations?.() ?? []) {
      if (
        "animationName" in animation &&
        typeof animation.animationName === "string" &&
        animation.animationName.startsWith("aven-")
      )
        animation.currentTime = 0;
    }
  } catch {
    // Best effort: it simply runs on from where it was.
  }
}

/**
 * Plays one of motion.css's one-shot animations on `element`, and removes
 * its attribute when it ends so nothing is left running or composited.
 * Nothing waits for it, and it sets no timer: an element that is not
 * displayed yet plays it when it is. Returns false when motion is off.
 */
export function playMotion(
  element: Element | null | undefined,
  name: MotionName,
): boolean {
  if (!element || motionReduced()) return false;
  const again = element.getAttribute(MOTION_ATTRIBUTE) === name;
  running.get(element)?.();
  element.setAttribute(MOTION_ATTRIBUTE, name);
  // The same attribute value again would not restart a CSS animation.
  if (again) restartCssAnimation(element);
  const finish = (event?: Event) => {
    if (event && event.target !== element) return;
    element.removeEventListener("animationend", finish);
    element.removeEventListener("animationcancel", finish);
    if (running.get(element) === finish) running.delete(element);
    if (element.getAttribute(MOTION_ATTRIBUTE) === name)
      element.removeAttribute(MOTION_ATTRIBUTE);
  };
  element.addEventListener("animationend", finish);
  element.addEventListener("animationcancel", finish);
  running.set(element, finish);
  return true;
}

/** How long past its duration a bounded animation may run before it is stopped. */
export const MOTION_BOUND_SLACK_MS = 50;

export type BoundedMotion = {
  /** The animation, or null where the element cannot animate. */
  readonly animation: Animation | null;
  /** Stop it now without running its end. */
  stop(): void;
};

/**
 * Plays a script-started animation that always ends. WebKit can hold back
 * its animation timeline while a native Chromium page covers the view, so an
 * animation may never finish on its own; a timer at its duration (plus a
 * little) stops it and runs `onEnd` regardless, and nothing it drew is left
 * on screen. `onEnd` runs once, in the same task that stops the animation,
 * so an element it hides never flashes back at full strength.
 */
export function playBounded(
  element: Element,
  keyframes: Keyframe[],
  options: { duration: number; easing?: string; fill?: FillMode },
  onEnd?: () => void,
): BoundedMotion {
  let done = false;
  const animation =
    typeof (element as HTMLElement).animate === "function"
      ? element.animate(keyframes, options)
      : null;
  const end = () => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    animation?.cancel();
    onEnd?.();
  };
  const timer = window.setTimeout(
    end,
    options.duration + MOTION_BOUND_SLACK_MS,
  );
  if (animation) animation.onfinish = end;
  return {
    animation,
    stop() {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      animation?.cancel();
    },
  };
}
