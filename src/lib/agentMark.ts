import type { BotStatus } from "./projectBots";
import type { CrewStatus } from "./crewView";
import { crewMemberTone, type MarkTone } from "./markTones";

/**
 * Every agent's mark, Bot: a little screen of dots with a face lit on it,
 * in the agent's colour, that changes with what it's doing.
 *
 * - `still`: its `>_` prompt, not moving (a mark used as a label: a post's
 *   author, a picker, a header), as it looks at rest.
 * - `resting`: a `>_` prompt in grey, its cursor blinking.
 * - `watching`: two square eyes looking about, blinking now and then.
 * - `working`: narrow eyes scanning side to side while a light runs round
 *   the screen's edge in its colour.
 * - `needs`: a `>` nudging you, in a breathing amber frame.
 * - `ready`: its eyes in a green frame, winking now and then: its work is
 *   ready for you.
 */
export type AgentState =
  "still" | "resting" | "watching" | "working" | "needs" | "ready";

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
 * Bot's drawing: a little screen of dots, its face lit on a faint grid, a
 * face for each state (`AGENT_STATE_FACES`), 13 by 9 dots at every size:
 * a small mark draws the same dots bigger, so it reads as the big one.
 * `#` is a lit dot, `u` its cursor (it blinks), `.` unlit.
 */
export type AgentFace =
  | "prompt"
  | "squares"
  | "narrow"
  | "chevron"
  | "happy"
  | "cross"
  | "code"
  | "check"
  | "diamond"
  | "question"
  | "star"
  | "shield"
  | "wrench";

export type AgentGrid = "large";

export const AGENT_FACES: Readonly<
  Record<AgentGrid, Readonly<Record<AgentFace, readonly string[]>>>
> = {
  large: {
    prompt: [
      ".............",
      ".............",
      "..##.........",
      "...##........",
      "....##.......",
      "...##........",
      "..##..uuuuu..",
      ".............",
      ".............",
    ],
    squares: [
      ".............",
      ".............",
      "..####.####..",
      "..####.####..",
      "..####.####..",
      "..####.####..",
      "..####.####..",
      ".............",
      ".............",
    ],
    narrow: [
      ".............",
      ".............",
      "....##.##....",
      "....##.##....",
      "....##.##....",
      "....##.##....",
      "....##.##....",
      ".............",
      ".............",
    ],
    chevron: [
      ".............",
      ".............",
      "....##.......",
      ".....##......",
      "......##.....",
      ".....##......",
      "....##.......",
      ".............",
      ".............",
    ],
    happy: [
      ".............",
      ".............",
      ".............",
      "...#.....#...",
      "..#.#...#.#..",
      ".#...#.#...#.",
      ".............",
      ".............",
      ".............",
    ],
    cross: [
      ".............",
      ".............",
      ".#...#.#...#.",
      "..#.#...#.#..",
      "...#.....#...",
      "..#.#...#.#..",
      ".#...#.#...#.",
      ".............",
      ".............",
    ],
    // A role's own face, at rest or watching (`AGENT_ROLE_FACES`).
    code: [
      ".............",
      ".............",
      "....#...#....",
      "...#.....#...",
      "..#.......#..",
      "...#.....#...",
      "....#...#....",
      ".............",
      ".............",
    ],
    check: [
      ".............",
      ".............",
      ".........#...",
      "........#....",
      "...#...#.....",
      "....#.#......",
      ".....#.......",
      ".............",
      ".............",
    ],
    diamond: [
      ".............",
      ".............",
      "......#......",
      ".....#.#.....",
      "....#...#....",
      ".....#.#.....",
      "......#......",
      ".............",
      ".............",
    ],
    question: [
      ".............",
      ".....###.....",
      "....#...#....",
      "........#....",
      ".......#.....",
      "......#......",
      ".............",
      "......#......",
      ".............",
    ],
    star: [
      ".............",
      ".............",
      "......#......",
      ".....###.....",
      "...#######...",
      ".....###.....",
      "......#......",
      ".............",
      ".............",
    ],
    shield: [
      ".............",
      "....#####....",
      "....#...#....",
      "....#...#....",
      "....#...#....",
      ".....#.#.....",
      "......#......",
      ".............",
      ".............",
    ],
    wrench: [
      ".............",
      ".......#...#.",
      ".......#####.",
      "......###....",
      ".....###.....",
      "....###......",
      "...###.......",
      "..##.........",
      ".............",
    ],
  },
};

/** Where each grid's dots sit in the mark's 100-unit square, and how big. */
export const AGENT_GRIDS: Readonly<
  Record<AgentGrid, { cols: number; rows: number; pitch: number; dot: number }>
> = {
  large: { cols: 13, rows: 9, pitch: 6.6, dot: 4.4 },
};

/** The face each state shows; a reaction's face shows over it a moment. */
export const AGENT_STATE_FACES: Readonly<Record<AgentState, AgentFace>> = {
  still: "prompt",
  resting: "prompt",
  watching: "squares",
  working: "narrow",
  needs: "chevron",
  ready: "squares",
};

/**
 * Each role's own face, shown at rest, as a label and while watching, so a
 * Builder reads as a Builder: Avos its square eyes (blinking now and then
 * at rest), the Builder `< >`, the
 * Checker a tick, the Scout a diamond, the Researcher a question, the
 * Designer a star, Security a shield, the project's bot (the Fixer) a
 * wrench. Working,
 * needing you and ready show the state's face instead, the same for all.
 */
export const AGENT_ROLE_FACES: Readonly<Record<AgentOutfit, AgentFace>> = {
  headset: "squares",
  hat: "code",
  tick: "check",
  diamond: "diamond",
  glasses: "question",
  beret: "star",
  shield: "shield",
  plus: "wrench",
};

/** Roles that check others' work: at work they keep their own face. */
const REVIEWERS: ReadonlySet<AgentOutfit> = new Set(["tick", "shield"]);

/**
 * The face an agent shows: its role's while calm, else its state's. The
 * Checker and Security keep their tick and shield while they work, so a
 * job being checked reads apart from one being built.
 */
export function agentFace(
  state: AgentState,
  outfit: AgentOutfit | undefined,
): AgentFace {
  const calm = state === "still" || state === "resting" || state === "watching";
  if (state === "working" && outfit && REVIEWERS.has(outfit))
    return AGENT_ROLE_FACES[outfit];
  return calm && outfit ? AGENT_ROLE_FACES[outfit] : AGENT_STATE_FACES[state];
}

/** The states the desktop bar and agent pointer show an agent in. */
export type AgentDesktopState = "still" | "watching" | "working" | "needs";
export type AgentDesktopFaces = Record<AgentDesktopState, readonly string[]>;

/**
 * An agent's faces for the desktop bar and pointer, drawn natively there:
 * `AGENT_FACES` rows of `agentFace` for each state they show, so an agent
 * looks there as it does in Aven. Sent once a turn with its name and colour.
 */
export function agentDesktopFaces(
  outfit: AgentOutfit | undefined,
): AgentDesktopFaces {
  const rows = (state: AgentDesktopState) =>
    AGENT_FACES.large[agentFace(state, outfit)];
  return {
    still: rows("still"),
    watching: rows("watching"),
    working: rows("working"),
    needs: rows("needs"),
  };
}

/** A cell's centre in the 100-unit square: [x, y]. */
export function agentCellCentre(
  grid: AgentGrid,
  row: number,
  col: number,
): [number, number] {
  const { cols, rows, pitch } = AGENT_GRIDS[grid];
  const n = (value: number) => Math.round(value * 1000) / 1000;
  return [
    n(50 + (col - (cols - 1) / 2) * pitch),
    n(50 + (row - (rows - 1) / 2) * pitch),
  ];
}

/** One face's lit dots (and its cursor's, apart), as zero-length paths. */
export function agentFacePaths(
  grid: AgentGrid,
  face: AgentFace,
): { lit: string; cursor: string } {
  const lit: string[] = [];
  const cursor: string[] = [];
  AGENT_FACES[grid][face].forEach((row, y) =>
    [...row].forEach((kind, x) => {
      if (kind === ".") return;
      const [cx, cy] = agentCellCentre(grid, y, x);
      (kind === "u" ? cursor : lit).push(`M${cx} ${cy}h0.01`);
    }),
  );
  return { lit: lit.join(""), cursor: cursor.join("") };
}

/**
 * The screen's glass at the large size: a faint honeycomb of dots across
 * all of it, offset every other row.
 */
export const AGENT_GLASS = (() => {
  const dots: string[] = [];
  const step = 4.4;
  for (let y = 4, row = 0; y < 98; y += step * 0.87, row++)
    for (let x = row % 2 ? 4 + step / 2 : 4; x < 98; x += step)
      dots.push(
        `M${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}h0.01`,
      );
  return dots.join("");
})();

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
  if (status === "ready") return "ready";
  if (status === "watching") return "watching";
  // Switched off, it doesn't bob.
  if (status === "paused") return "still";
  return rest;
}

/** A project bot's mark state from its word. */
export function botAgentState(status: BotStatus | undefined): AgentState {
  if (status === "needs-you") return "needs";
  if (status === "working") return "working";
  if (status === "fix-ready") return "ready";
  if (status === "watching") return "watching";
  // Paused, it doesn't move.
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
