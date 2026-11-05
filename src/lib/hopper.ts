import type { BotStatus } from "./projectBots";
import type { CrewStatus } from "./crewView";
import { crewMemberTone, type MarkTone } from "./markTones";

/**
 * Hopper, every agent's mark: the logo's staircase (Rise, `AVEN_MARK_ROWS`)
 * in grey dots, with one bright dot living on it in the agent's colour.
 *
 * - `still`: on the bottom step, not moving (a mark used as a label: a
 *   post's author, a picker, a header).
 * - `resting`: on the bottom step, a little dim, breathing slowly.
 * - `watching`: hopping from one grey dot to the next inside its steps,
 *   pausing on each (`HOPPER_WATCH`).
 * - `working`: hopping from the bottom step to the top, one step about
 *   every 0.6 s, then starting again.
 * - `needs`: on the top step, bouncing, in amber.
 */
export type HopperState =
  "still" | "resting" | "watching" | "working" | "needs";

/** The mark's box: one 64-unit square, as the mock-ups drew it. */
export const HOPPER_BOX = 64;

/** How long the dot takes over one step while it works. */
export const HOPPER_HOP_MS = 600;

/**
 * A staircase's shape in the 64-unit box. Row r (from the top) has r + 1
 * dots, climbing to the top-left; the bright dot stands `above` units over
 * the last dot of a row. Below 24 px a mark draws `small`: three bigger
 * steps and a bigger dot, so it stays clear in lists, rails and tabs.
 */
export type HopperGeometry = {
  /** Rows of steps. */
  steps: number;
  /** Distance between two steps' dots, across and down. */
  cell: number;
  /** The top step's dot. */
  x0: number;
  y0: number;
  /** A step's dot. */
  stepRadius: number;
  /** How far above a step the bright dot's centre stands. */
  above: number;
  /** The bright dot. */
  dotRadius: number;
  /** How high a hop or a bounce lifts it. */
  jump: number;
};

export const HOPPER_GEOMETRY: Readonly<
  Record<"big" | "small", HopperGeometry>
> = {
  big: {
    steps: 5,
    cell: 9.5,
    x0: 13,
    y0: 21,
    stepRadius: 3.2,
    above: 8.4,
    dotRadius: 5,
    jump: 9,
  },
  small: {
    steps: 3,
    cell: 16,
    x0: 16,
    y0: 27,
    stepRadius: 5,
    above: 13,
    dotRadius: 7.4,
    jump: 6,
  },
};

/** Every step's dot centre, top row first. */
export function hopperStepDots(
  geometry: HopperGeometry,
): { x: number; y: number }[] {
  const dots: { x: number; y: number }[] = [];
  for (let row = 0; row < geometry.steps; row++)
    for (let col = 0; col <= row; col++)
      dots.push({
        x: geometry.x0 + col * geometry.cell,
        y: geometry.y0 + row * geometry.cell,
      });
  return dots;
}

/**
 * The steps as one path: each dot a zero-length round-capped stroke, so a
 * dot's size is the stroke's width (`2 × stepRadius`, set in CSS).
 */
export function hopperStepsPath(geometry: HopperGeometry): string {
  return hopperStepDots(geometry)
    .map(({ x, y }) => `M${x} ${y}h0`)
    .join("");
}

/**
 * Watching: a loop of neighbouring dots that visits every dot of the steps
 * once, as [column, row] (row 0 is the top step). The bright dot lands on
 * each one's centre, covering it, waits there `pauses[i]` seconds, then
 * hops to the next in `hop` seconds, eased in and out, with an arc of `arc`
 * units. A small mark walks its three rows with the first six pauses.
 * HopperMark.watch.css holds the keyframes these make.
 */
export const HOPPER_WATCH = {
  path: {
    big: [
      [0, 4],
      [1, 4],
      [1, 3],
      [2, 3],
      [2, 4],
      [3, 4],
      [4, 4],
      [3, 3],
      [2, 2],
      [1, 2],
      [1, 1],
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ],
    small: [
      [0, 2],
      [1, 2],
      [2, 2],
      [1, 1],
      [0, 0],
      [0, 1],
    ],
  },
  pauses: [
    0.9, 0.5, 1.3, 0.6, 0.8, 1.1, 0.5, 1.0, 0.7, 1.2, 0.6, 0.9, 0.5, 1.0, 0.8,
  ],
  hop: 0.42,
  arc: { big: 6, small: 7 },
} as const;

/** How long one watching loop takes, in seconds (to the hundredth). */
export function hopperWatchLoop(size: "big" | "small"): number {
  const path = HOPPER_WATCH.path[size];
  const seconds =
    path.reduce((sum, _, index) => sum + HOPPER_WATCH.pauses[index], 0) +
    path.length * HOPPER_WATCH.hop;
  return Math.round(seconds * 100) / 100;
}

/**
 * How far into its watching loop each agent starts, in seconds, so helpers
 * side by side never hop together. Avos starts at the beginning.
 */
const WATCH_OFFSETS: Readonly<Record<string, number>> = {
  lead: 0,
  builder: 2.3,
  checker: 5.9,
  researcher: 8.6,
  designer: 11.2,
  security: 13.9,
  scout: 16.2,
  helper: 3.7,
  fixer: 9.8,
};

/** An agent's head start in its watching loop, by its role. */
export function hopperWatchOffset(role: string | undefined): number {
  return (role && WATCH_OFFSETS[role]) || 0;
}

/** Where the bright dot's centre stands on a step (0 is the top one). */
export function hopperSpot(
  geometry: HopperGeometry,
  step: number,
): { x: number; y: number } {
  return {
    x: geometry.x0 + step * geometry.cell,
    y: geometry.y0 + step * geometry.cell - geometry.above,
  };
}

/** A team member's mark state from its word and whether it works now. */
export function crewHopperState(
  status: CrewStatus | undefined,
  active: boolean,
  rest: HopperState = "resting",
): HopperState {
  if (status === "needs-you") return "needs";
  if (active || status === "working") return "working";
  if (status === "watching") return "watching";
  // Switched off, it doesn't breathe.
  if (status === "paused") return "still";
  return rest;
}

/** A project bot's mark state from its word. */
export function botHopperState(status: BotStatus | undefined): HopperState {
  if (status === "needs-you") return "needs";
  if (status === "working") return "working";
  if (status === "watching") return "watching";
  // Paused, it doesn't breathe; a fix ready for you rests on its steps.
  if (status === "paused") return "still";
  return "resting";
}

/**
 * A team member's colour: the Lead (Avos) and the Fixer (its project's
 * bot) wear their project's; every other role its own (`crewMemberTone`).
 */
export function hopperMemberTone(
  role: string,
  mark: string | null | undefined,
  projectTone: MarkTone | null | undefined,
): MarkTone | null {
  if (role === "lead" || role === "fixer") return projectTone ?? null;
  return crewMemberTone(role, mark) ?? projectTone ?? null;
}
