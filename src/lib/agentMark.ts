import type { BotStatus } from "./projectBots";
import type { CrewStatus } from "./crewView";
import { crewMemberTone, type MarkTone } from "./markTones";

/**
 * Every agent's mark, Bot: a little robot in the agent's colour, with a
 * dark face plate, two glowing eyes and a light on its antenna.
 *
 * - `still`: eyes open, not moving (a mark used as a label: a post's
 *   author, a picker, a header).
 * - `resting`: eyes closed, its light dim, a slow bob (and a small "z" at
 *   28 px and up).
 * - `watching`: eyes drifting side to side, blinking now and then.
 * - `working`: eyes squinting down at three keys that light in turn, its
 *   light pulsing white, a quick small bob.
 * - `needs`: bouncing, eyes amber and wide, its light pulsing amber.
 */
export type AgentState = "still" | "resting" | "watching" | "working" | "needs";

/**
 * What an agent wears at 28 px and up, by its role: Avos a headset, the
 * Builder a hard hat whose lamp is its light, the Researcher glasses, the
 * Designer a beret whose nub is its light; the Checker, Security, the
 * Scout and the project's bot a small badge with a glyph of their job.
 */
export type AgentOutfit =
  | "headset"
  | "hat"
  | "glasses"
  | "beret"
  | "tick"
  | "shield"
  | "diamond"
  | "plus";

const ROLE_OUTFITS: Readonly<Record<string, AgentOutfit>> = {
  lead: "headset",
  builder: "hat",
  researcher: "glasses",
  designer: "beret",
  checker: "tick",
  security: "shield",
  scout: "diamond",
  fixer: "plus",
};

/** What a role wears; a helper or a plain chat wears nothing. */
export function agentOutfit(role: string | undefined): AgentOutfit | undefined {
  return role ? ROLE_OUTFITS[role] : undefined;
}

/** The mark's box: one 64-unit square, as the mock-ups drew it. */
export const AGENT_BOX = 64;

/**
 * Below 24 px (lists, rails, tabs) eyes, the antenna and strokes are this
 * much bigger, and the bolts and outfits go, so it stays clear.
 */
export const AGENT_SMALL_SCALE = 1.3;

const n = (value: number) => Math.round(value * 1000) / 1000;

/** An ellipse as a path. */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number) {
  return `M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0Z`;
}

/** A circle as a path. */
export function circlePath(cx: number, cy: number, r: number) {
  return ellipsePath(cx, cy, r, r);
}

/** A rounded rectangle as a path. */
export function roundRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const q = Math.min(r, w / 2, h / 2);
  return `M${n(x + q)} ${n(y)}h${n(w - 2 * q)}a${n(q)} ${n(q)} 0 0 1 ${n(q)} ${n(q)}v${n(h - 2 * q)}a${n(q)} ${n(q)} 0 0 1 ${n(-q)} ${n(q)}h${n(-(w - 2 * q))}a${n(q)} ${n(q)} 0 0 1 ${n(-q)} ${n(-q)}v${n(-(h - 2 * q))}a${n(q)} ${n(q)} 0 0 1 ${n(q)} ${n(-q)}Z`;
}

/** Where things sit in the 64-unit box. */
export const AGENT_GEOMETRY = {
  head: { x: 12, y: 21, w: 40, h: 33, r: 11 },
  bolts: [
    { x: 8, y: 32, w: 5, h: 11, r: 2.5 },
    { x: 51, y: 32, w: 5, h: 11, r: 2.5 },
  ],
  plate: { x: 17, y: 27, w: 30, h: 21, r: 7.5 },
  eyes: { xs: [25, 39] as const, y: 37, r: 3.6 },
  /** Its antenna's stalk, from the head up, and the ball on top. */
  stalk: { x: 32, from: 21, to: 13, width: 2.6 },
  light: { x: 32, y: 10, r: 4 },
  /** The three keys under its eyes while it works. */
  keys: { xs: [28, 32, 36] as const, y: 44.2, r: 1.25 },
  /** The hard hat's lamp and the beret's nub, which become its light. */
  lamp: { x: 32, y: 18.5, r: 2.8 },
  nub: { x: 33, y: 10.5, r: 2.4 },
} as const;

/** One pair of eyes, as one path, for a mood and a size. */
export function eyesPath(
  mood: "open" | "wide" | "squint" | "closed",
  small = false,
): string {
  const k = small ? AGENT_SMALL_SCALE : 1;
  const { xs, y, r: base } = AGENT_GEOMETRY.eyes;
  const r = base * k;
  return xs
    .map((x) => {
      if (mood === "closed")
        return `M${n(x - r)} ${n(y)}q${n(r)} ${n(r * 0.75)} ${n(2 * r)} 0`;
      if (mood === "wide") return circlePath(x, y, r * 1.15);
      // Squinting, it looks down at its keys.
      if (mood === "squint") return ellipsePath(x, y + 1.3, r, r * 0.62);
      return circlePath(x, y, r);
    })
    .join("");
}

/** The drawing's still parts, as paths. */
export const AGENT_PATHS = {
  bolts: AGENT_GEOMETRY.bolts
    .map((b) => roundRectPath(b.x, b.y, b.w, b.h, b.r))
    .join(""),
  head: roundRectPath(
    AGENT_GEOMETRY.head.x,
    AGENT_GEOMETRY.head.y,
    AGENT_GEOMETRY.head.w,
    AGENT_GEOMETRY.head.h,
    AGENT_GEOMETRY.head.r,
  ),
  plate: roundRectPath(
    AGENT_GEOMETRY.plate.x,
    AGENT_GEOMETRY.plate.y,
    AGENT_GEOMETRY.plate.w,
    AGENT_GEOMETRY.plate.h,
    AGENT_GEOMETRY.plate.r,
  ),
  stalk: `M${AGENT_GEOMETRY.stalk.x} ${AGENT_GEOMETRY.stalk.from}V${AGENT_GEOMETRY.stalk.to}`,
  keys: AGENT_GEOMETRY.keys.xs
    .map((x) => circlePath(x, AGENT_GEOMETRY.keys.y, AGENT_GEOMETRY.keys.r))
    .join(""),
  z: "M46 6h4.5l-4.5 4.5h4.5",
} as const;

/** What each outfit draws, at 28 px and up, in the 64-unit box. */
export const OUTFIT_PATHS: Readonly<
  Record<AgentOutfit, readonly { d: string; kind: string }[]>
> = {
  // A grey headset: the band over its head, two ear cups and a mic.
  headset: [
    { d: "M11 39Q11 14 32 14Q53 14 53 39", kind: "band" },
    {
      d: roundRectPath(7, 33, 7, 12, 3) + roundRectPath(50, 33, 7, 12, 3),
      kind: "cup",
    },
    { d: "M10 44Q12 51 21 51", kind: "boom" },
    { d: circlePath(22, 51, 2.2), kind: "cup" },
  ],
  // A yellow hard hat with a brim; its lamp is the light.
  hat: [
    { d: "M16 27Q16 10 32 10Q48 10 48 27Z", kind: "hat" },
    { d: roundRectPath(11, 24.5, 42, 4.5, 2.25), kind: "hat" },
  ],
  // Light glasses rings around its eyes.
  glasses: [
    {
      d: circlePath(25, 37, 6.2) + circlePath(39, 37, 6.2) + "M31.2 37H32.8",
      kind: "frame",
    },
  ],
  // A darker-pink beret; its nub is the light.
  beret: [{ d: "M15 24Q17 11 33 12Q47 13 50 22Q33 27 15 24Z", kind: "beret" }],
  // A small dark badge, bottom-right, with its job's glyph.
  tick: [...badge(), { d: "M46.4 50.4l2.6 2.6 5-5.2", kind: "glyph-line" }],
  shield: [
    ...badge(),
    {
      d: "M50 45.2l4 1.5v3c0 2.5-1.8 4.2-4 5c-2.2-0.8-4-2.5-4-5v-3Z",
      kind: "glyph",
    },
  ],
  diamond: [
    ...badge(),
    { d: "M50 45.4L54.6 50L50 54.6L45.4 50Z", kind: "glyph" },
  ],
  plus: [...badge(), { d: "M50 46.2V53.8M46.2 50H53.8", kind: "glyph-line" }],
};

function badge() {
  return [{ d: circlePath(50, 50, 7.4), kind: "badge" }];
}

/** Outfits whose hat replaces the antenna, its lamp or nub the light. */
export const HATS: ReadonlySet<AgentOutfit> = new Set(["hat", "beret"]);

/**
 * How far into its loops each agent starts, in seconds, so helpers side
 * by side never bob or blink together. Avos starts at the beginning.
 */
const PHASES: Readonly<Record<string, number>> = {
  lead: 0,
  builder: 1.7,
  checker: 3.1,
  researcher: 4.6,
  designer: 6.2,
  security: 2.4,
  scout: 5.3,
  helper: 0.9,
  fixer: 3.9,
};

/** An agent's head start in its loops, by its role. */
export function agentPhase(role: string | undefined): number {
  return (role && PHASES[role]) || 0;
}

/** A team member's mark state from its word and whether it works now. */
export function crewAgentState(
  status: CrewStatus | undefined,
  active: boolean,
  rest: AgentState = "resting",
): AgentState {
  if (status === "needs-you") return "needs";
  if (active || status === "working") return "working";
  if (status === "watching") return "watching";
  // Switched off, it doesn't bob.
  if (status === "paused") return "still";
  return rest;
}

/** A project bot's mark state from its word. */
export function botAgentState(status: BotStatus | undefined): AgentState {
  if (status === "needs-you") return "needs";
  if (status === "working") return "working";
  if (status === "watching") return "watching";
  // Paused, it doesn't bob; a fix ready for you rests.
  if (status === "paused") return "still";
  return "resting";
}

/**
 * A team member's colour: the Lead (Avos) and the Fixer (its project's
 * bot) wear their project's; every other role its own (`crewMemberTone`).
 */
export function agentMemberTone(
  role: string,
  mark: string | null | undefined,
  projectTone: MarkTone | null | undefined,
): MarkTone | null {
  if (role === "lead" || role === "fixer") return projectTone ?? null;
  return crewMemberTone(role, mark) ?? projectTone ?? null;
}
