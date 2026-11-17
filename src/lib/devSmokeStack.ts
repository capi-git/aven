import { STACK_FAN_DEGREES, rotationDegrees } from "./stackMark";

/**
 * What the real-app check (`useDevSmoke`) reads off a project's Stack in
 * the sidebar: which mark it is, any animation running in it, and how its
 * back pages are turned and timed.
 */
export type StackReading = {
  /** The mark's `data-kind`: `folder`, `stack`, `logo`, or `mark` (dots). */
  kind: string | null;
  /** A folder drawn open (`data-open` on the mark). */
  open?: boolean;
  /** CSS animations running in it; a Stack never has one. */
  animations: readonly string[];
  /** The back and middle pages' computed transforms. */
  back: string;
  middle: string;
  /** Their computed transition durations. */
  durations: readonly string[];
};

/** Reads a project mark on screen, or null when there is none. */
export function readStack(mark: Element | null): StackReading | null {
  if (!mark) return null;
  const back = mark.querySelector(".stack-mark-back");
  const middle = mark.querySelector(".stack-mark-middle");
  const animations =
    typeof mark.getAnimations === "function"
      ? mark
          .getAnimations({ subtree: true })
          .flatMap((animation) =>
            "animationName" in animation
              ? [String((animation as CSSAnimation).animationName)]
              : [],
          )
      : [];
  return {
    kind: mark.getAttribute("data-kind"),
    open: mark.hasAttribute("data-open"),
    animations,
    back: back ? getComputedStyle(back).transform : "",
    middle: middle ? getComputedStyle(middle).transform : "",
    durations: [back, middle].map((page) =>
      page ? getComputedStyle(page).transitionDuration : "",
    ),
  };
}

/** The longest of a computed CSS time list ("0.16s", "160ms, 0s"), in ms. */
export function longestMs(times: string): number {
  return Math.max(
    0,
    ...times
      .split(",")
      .map((time) => time.trim())
      .filter(Boolean)
      .map((time) =>
        time.endsWith("ms")
          ? Number(time.slice(0, -2))
          : time.endsWith("s")
            ? Number(time.slice(0, -1)) * 1000
            : Number.NaN,
      )
      .map((ms) => (Number.isFinite(ms) ? ms : 0)),
  );
}

/**
 * Why a project's Stack is not as it should be, or null when it is: still
 * (no animation), its back pages fanned exactly while the project is open,
 * and the fan eased unless reduced motion is on, when it just changes.
 */
export function stackProblem(
  reading: StackReading | null,
  { open, reducedMotion }: { open: boolean; reducedMotion: boolean },
): string | null {
  if (!reading) return "is missing";
  // The sidebar draws a project as a folder: still, and open exactly while
  // the project is.
  if (reading.kind === "folder") {
    if (reading.animations.length)
      return `moves (${reading.animations.join(", ")})`;
    if (Boolean(reading.open) !== open)
      return `shows ${reading.open ? "an open" : "a closed"} folder while the project is ${open ? "open" : "closed"}`;
    return null;
  }
  if (reading.kind !== "stack")
    return `is not a Stack (it is ${reading.kind ?? "unmarked"})`;
  if (reading.animations.length)
    return `moves (${reading.animations.join(", ")})`;
  const turns = {
    back: rotationDegrees(reading.back),
    middle: rotationDegrees(reading.middle),
  };
  for (const page of ["back", "middle"] as const) {
    const turn = turns[page];
    if (turn === null)
      return `has a ${page} page turned in a way it can't read (${reading[page] || "none"})`;
    const expected = open ? STACK_FAN_DEGREES[page] : 0;
    if (Math.abs(turn - expected) > 0.5)
      return `has its ${page} page at ${turn.toFixed(1)}°, expected ${expected}° while the project is ${open ? "open" : "closed"}`;
  }
  const eased = reading.durations.map(longestMs);
  if (reducedMotion && eased.some((ms) => ms > 0))
    return `eases its fan (${reading.durations.join(", ")}) with reduced motion on`;
  if (!reducedMotion && eased.some((ms) => ms <= 0))
    return "fans without easing";
  return null;
}
