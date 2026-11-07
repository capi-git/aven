import type { BotStatus } from "./projectBots";
import type { CrewStatus } from "./crewView";
import { dotsPath } from "./dotSigils";
import { crewMemberTone, type MarkTone } from "./markTones";

/**
 * Every agent's mark, Bot: a little robot drawn in dots, the work dots'
 * 5×5 grid, in the agent's colour, with two glowing eyes and a light on its
 * antenna.
 *
 * - `still`: eyes open, not moving (a mark used as a label: a post's
 *   author, a picker, a header).
 * - `resting`: eyes dimmed shut, its light dim, a slow bob.
 * - `watching`: eyes drifting side to side, blinking now and then.
 * - `working`: a light stepping from one foot to the other, as it walks,
 *   its light pulsing white, a quick small bob.
 * - `needs`: bouncing, eyes amber and wide, its light pulsing amber.
 */
export type AgentState = "still" | "resting" | "watching" | "working" | "needs";

/**
 * Its role's outfit, by name: Avos a headset, the Builder a hard hat, the
 * Researcher glasses, the Designer a beret; the Checker, Security, the
 * Scout and the project's bot a badge. The dotted Bot wears none of them:
 * the mark says it as `data-outfit` only, so styles and checks can tell
 * roles apart.
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

/**
 * Bot's drawing: the work dots' own 5×5 grid (`dotSigils`), row by row from
 * the top: the light on its antenna, its head, two eyes in its head, its
 * head again, and two feet. The rest of the grid shows faintly, so it reads
 * as a square of dots with a robot lit in it.
 */
export const AGENT_ROWS = [
  "..l..",
  "hhhhh",
  "heheh",
  "hhhhh",
  ".h.h.",
] as const;

/** The cells of one part of the drawing, as [row, column]. */
export function agentCells(part: "." | "l" | "h" | "e"): [number, number][] {
  const cells: [number, number][] = [];
  AGENT_ROWS.forEach((row, y) =>
    [...row].forEach((kind, x) => {
      if (kind === part) cells.push([y, x]);
    }),
  );
  return cells;
}

/** The drawing's parts, as paths over the dots' 100-unit square. */
export const AGENT_DOTS = {
  grid: dotsPath(agentCells(".")),
  head: dotsPath(agentCells("h")),
  eyes: dotsPath(agentCells("e")),
} as const;

/**
 * Each dot's size in the 100-unit square, as the other dot marks draw
 * theirs (DotMark.css): bigger below 24 px, so a small mark stays clear.
 */
export const AGENT_DOT = 13;
export const AGENT_DOT_SMALL = 14.6;

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
 * The colours a helper may take instead of its own when its own is its
 * project's (so it isn't mistaken for Avos): never yellow, green or red,
 * which say what's happening, nor grey, the plain mark. The ones most roles
 * don't wear come first.
 */
const STAND_IN_TONES: readonly MarkTone[] = [
  "teal",
  "orange",
  "pink",
  "purple",
  "blue",
];

/**
 * A team member's colour: Avos (the Lead) and the Fixer (its project's
 * bot) wear their project's; every other role its own (`crewMemberTone`),
 * unless that is the project's too: then the next free colour, so no helper
 * looks like Avos. Worked out as it's drawn; nothing stored changes.
 */
export function agentMemberTone(
  role: string,
  mark: string | null | undefined,
  projectTone: MarkTone | null | undefined,
  /** Colours the other helpers on screen wear: a stand-in avoids them. */
  taken?: ReadonlySet<MarkTone>,
): MarkTone | null {
  if (role === "lead" || role === "fixer") return projectTone ?? null;
  const own = crewMemberTone(role, mark);
  if (!own) return projectTone ?? null;
  if (!projectTone || own !== projectTone) return own;
  return (
    STAND_IN_TONES.find((tone) => tone !== projectTone && !taken?.has(tone)) ??
    STAND_IN_TONES.find((tone) => tone !== projectTone) ??
    own
  );
}

/**
 * The colours a team's helpers wear by their roles, its Avos and Fixer
 * aside: what a helper standing in for its project's colour avoids.
 */
export function helperTones(
  members: readonly { role: string; critter?: string | undefined }[],
): Set<MarkTone> {
  const tones = new Set<MarkTone>();
  for (const member of members) {
    if (member.role === "lead" || member.role === "fixer") continue;
    const tone = crewMemberTone(member.role, member.critter);
    if (tone) tones.add(tone);
  }
  return tones;
}
