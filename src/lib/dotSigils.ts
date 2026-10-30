/**
 * Aven's marks: a 5×5 grid of round dots with some of them lit. Each agent
 * role and each project wears its own pattern, a sigil; a tick and a cross
 * stand in for any sigil when a turn ends well or badly. Patterns are five
 * rows of five cells, top to bottom: `1` lit, `0` unlit.
 *
 * Projects, bots and chats outside a project still save the critter they
 * picked before marks ("owl", "fox"; `projectMascots`), so nothing stored
 * changes: each critter reads as one project sigil here, one to one, and a
 * crew member's critter reads as its role's sigil.
 */
import type { ProjectAppearance } from "./projectAppearance";
import { currentMascotName, projectMascot } from "./projectMascots";

export const DOT_GRID = 5;

/** A sigil: what it is called, and which of its 25 dots are lit. */
export type DotSigil = {
  key: string;
  /** What the mark picker calls it: "Builder", "Spiral". */
  label: string;
  /** Five rows of five cells, `1` lit. */
  rows: readonly string[];
};

const sigil = (key: string, label: string, rows: readonly string[]) =>
  ({ key, label, rows }) as const satisfies DotSigil;

/**
 * Crew roles and ready-made members, keyed by role or preset. Every sigil
 * lights 7 to 13 of the 25 dots: a strong outline with open space around
 * it, so it still reads as its own shape at 15px.
 */
// prettier-ignore
export const ROLE_SIGILS = [
  // Two blocks, one set on from the other.
  sigil("builder", "Builder", ["11000", "11000", "00000", "00011", "00011"]),
  // A ring.
  sigil("checker", "Checker", ["01110", "10001", "10001", "10001", "01110"]),
  // A shield.
  sigil("security", "Security", ["11111", "10001", "10001", "01010", "00100"]),
  // A diamond, looking out on every side.
  sigil("scout", "Scout", ["00100", "01010", "10001", "01010", "00100"]),
  // A brush: its head, then its stroke.
  sigil("designer", "Designer", ["00011", "00011", "00100", "01000", "10000"]),
  // A test card's checkerboard.
  sigil("tester", "Tester", ["10101", "01010", "10101", "01010", "10101"]),
  // Lines of text, the last one short.
  sigil("scribe", "Scribe", ["11111", "00000", "11111", "00000", "11100"]),
  // A plus: the Fixer adds what was missing.
  sigil("fixer", "Fixer", ["00100", "00100", "11111", "00100", "00100"]),
  // A small ring around an open middle, for a member you describe.
  sigil("custom", "Custom", ["00000", "01110", "01010", "01110", "00000"]),
] as const;

/** Projects and chats: twelve, one for each critter they may have saved. */
// prettier-ignore
export const PROJECT_SIGILS = [
  sigil("frame", "Frame", ["11011", "10001", "00000", "10001", "11011"]),
  sigil("spark", "Spark", ["10001", "00100", "01010", "00100", "10001"]),
  sigil("hourglass", "Hourglass", ["01110", "01010", "00100", "01010", "01110"]),
  sigil("spiral", "Spiral", ["01111", "10000", "10110", "10010", "01110"]),
  sigil("pillars", "Pillars", ["10001", "10001", "10001", "10001", "10001"]),
  sigil("corner", "Corner", ["10000", "10000", "10000", "10000", "11111"]),
  sigil("peak", "Peak", ["00000", "00100", "01110", "11111", "00000"]),
  sigil("flag", "Flag", ["11100", "11110", "11100", "10000", "10000"]),
  sigil("moon", "Moon", ["00110", "01000", "01000", "01000", "00110"]),
  sigil("eye", "Eye", ["00000", "01110", "10101", "01110", "00000"]),
  sigil("pin", "Pin", ["01110", "10001", "01110", "00100", "00100"]),
  sigil("anchor", "Anchor", ["00100", "01110", "00100", "10101", "01110"]),
] as const;

export type RoleSigilKey = (typeof ROLE_SIGILS)[number]["key"];
export type ProjectSigilKey = (typeof PROJECT_SIGILS)[number]["key"];
export type SigilKey = RoleSigilKey | ProjectSigilKey;

export const ALL_SIGILS: readonly DotSigil[] = [
  ...ROLE_SIGILS,
  ...PROJECT_SIGILS,
];

/** A turn that ended well: the dots reshape into a tick. */
export const TICK_ROWS = ["00000", "00001", "00010", "10100", "01000"];
/** A turn that failed, or an agent that is stuck: a cross. */
export const CROSS_ROWS = ["10001", "01010", "00100", "01010", "10001"];

const BY_KEY = new Map<string, DotSigil>(
  ALL_SIGILS.map((item) => [item.key, item]),
);

export function isSigilKey(key: string | null | undefined): key is SigilKey {
  return !!key && BY_KEY.has(key);
}

export function sigilByKey(key: string): DotSigil | undefined {
  return BY_KEY.get(key);
}

/**
 * Each critter a project, a bot or a chat saved before marks, as the project
 * sigil it reads as now. One to one, so two projects that looked different
 * still do.
 */
export const CRITTER_SIGILS: Readonly<Record<string, ProjectSigilKey>> = {
  owl: "eye",
  axolotl: "spark",
  moth: "hourglass",
  snail: "spiral",
  jelly: "pillars",
  cactus: "corner",
  sprout: "pin",
  puffin: "peak",
  fox: "flag",
  whale: "anchor",
  beetle: "frame",
  hedgehog: "moon",
};

/** The critter a project sigil stands for in storage: "target" is "owl". */
export const SIGIL_CRITTERS: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(CRITTER_SIGILS).map(([critter, key]) => [key, critter]),
  );

/**
 * A project's (or a chat's) sigil from what it saved: a sigil key, a
 * critter's name (an older sprite's read as today's critter), or nothing,
 * which picks the critter `seed` (the project's folder name) hashes to, as
 * the project's appearance does.
 */
export function projectSigil(
  saved: string | null | undefined,
  seed = "",
): DotSigil {
  const direct = saved ? BY_KEY.get(saved) : undefined;
  if (direct) return direct;
  return BY_KEY.get(CRITTER_SIGILS[projectMascot(seed, saved).name])!;
}

/**
 * The sigil a project shows. One it picked is its own. One it never picked
 * was told apart before by its critter and its colour, both worked out from
 * its name; marks have no colour, so the colour moves its critter's sigil
 * along the twelve instead, and two projects with the same automatic critter
 * in different colours still look different.
 */
export function appearanceSigil(
  appearance: Pick<
    ProjectAppearance,
    "key" | "mascot" | "mascotOverride" | "colorIndex" | "automaticColorIndex"
  >,
): DotSigil {
  if (appearance.mascotOverride)
    return projectSigil(appearance.mascotOverride, appearance.key);
  const at = PROJECT_SIGILS.findIndex(
    (item) => item.key === CRITTER_SIGILS[appearance.mascot],
  );
  if (at < 0) return projectSigil(appearance.mascot, appearance.key);
  const colour = appearance.colorIndex ?? appearance.automaticColorIndex;
  const count = PROJECT_SIGILS.length;
  // 5 is prime to 12, so each of the palette's colours lands on its own sigil.
  return PROJECT_SIGILS[(((at + 5 * colour) % count) + count) % count];
}

/**
 * Crew members saved before marks were drawn as critters. A critter a role
 * or a ready-made member wore by default reads as that member's sigil, but
 * only on a member of that role, so a Builder that wore the hedgehog never
 * shows Security's shield; any other critter reads as its project sigil.
 */
const MEMBER_CRITTER_SIGILS: Readonly<
  Record<string, { role: string; sigil: RoleSigilKey }>
> = {
  beetle: { role: "builder", sigil: "builder" },
  owl: { role: "checker", sigil: "checker" },
  hedgehog: { role: "security", sigil: "security" },
  fox: { role: "scout", sigil: "scout" },
  moth: { role: "builder", sigil: "designer" },
  snail: { role: "builder", sigil: "tester" },
  puffin: { role: "builder", sigil: "scribe" },
};

/**
 * A crew member's sigil: the Fixer's own; the mark it was given (a sigil
 * key, or a critter from before marks); else its role's.
 */
export function crewMemberSigil(role: string, mark?: string | null): DotSigil {
  if (role === "fixer") return BY_KEY.get("fixer")!;
  if (mark) {
    const direct = BY_KEY.get(mark);
    if (direct) return direct;
    const name = currentMascotName(mark);
    const member = MEMBER_CRITTER_SIGILS[name];
    if (member?.role === role) return BY_KEY.get(member.sigil)!;
    if (CRITTER_SIGILS[name]) return projectSigil(name);
  }
  return BY_KEY.get(role) ?? BY_KEY.get("custom")!;
}

/** The marks a crew member can wear, roles first. The Fixer's is its own. */
export const MEMBER_SIGIL_CHOICES: readonly DotSigil[] = ALL_SIGILS.filter(
  (item) => item.key !== "fixer",
);

/** Every lit cell of `rows`, as [row, column]. */
export function litCells(rows: readonly string[]): [number, number][] {
  const cells: [number, number][] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "1") cells.push([y, x]);
  });
  return cells;
}

/*
 * Geometry over a 100-unit square: five cells of 20, each dot centred in its
 * cell, so at 15, 20 or 25px (or any multiple of 5) every centre lands on a
 * whole device pixel at 2× (and at 1× for multiples of 10). Each dot is a
 * zero-length stroke with round caps, so its size is the stroke's width,
 * which DotMark.css sets for the mark's size: bigger dots when it is small.
 */
const VIEW = 100;
const PITCH = 20;

export const DOT_VIEW_BOX = `0 0 ${VIEW} ${VIEW}`;

function dotPath(y: number, x: number): string {
  // A hair of length, so every engine draws the round caps.
  return `M${PITCH / 2 + x * PITCH} ${PITCH / 2 + y * PITCH}h0.01`;
}

/** One path of the dots at `cells`. */
export function dotsPath(cells: readonly [number, number][]): string {
  return cells.map(([y, x]) => dotPath(y, x)).join("");
}

const EVERY_CELL: [number, number][] = Array.from(
  { length: DOT_GRID * DOT_GRID },
  (_, index) => [Math.floor(index / DOT_GRID), index % DOT_GRID],
);

/** All 25 dots: the grid's faint texture under the lit ones. */
export const GRID_PATH = dotsPath(EVERY_CELL);

/** The diagonals a working light sweeps along: row + column, 0 to 8. */
export const DIAGONALS = DOT_GRID * 2 - 1;

/** Each diagonal's dots of `cells`, as a path ("" when it has none). */
export function diagonalPaths(
  cells: readonly [number, number][],
): readonly string[] {
  const out = Array.from({ length: DIAGONALS }, () => "");
  for (const [y, x] of cells) out[y + x] += dotPath(y, x);
  return out;
}

/** The grid's dots by diagonal, for the faint sweep under a working mark. */
export const GRID_DIAGONAL_PATHS = diagonalPaths(EVERY_CELL);

const paths = new Map<string, string>();

/** The lit dots of `rows` as one path, worked out once per pattern. */
export function litPath(rows: readonly string[]): string {
  const key = rows.join("");
  let path = paths.get(key);
  if (path === undefined) {
    path = dotsPath(litCells(rows));
    paths.set(key, path);
  }
  return path;
}

/**
 * Round dots for the `cells` of `rows`, one per grid cell, `size` cells
 * across: dot art where Aven once drew pixel art (an empty state, Home's
 * streak flame). `dx`/`dy` place it on its grid.
 */
export function dotArtPath(
  rows: readonly string[],
  cells = "#",
  {
    dx = 0,
    dy = 0,
    size = 0.8,
  }: { dx?: number; dy?: number; size?: number } = {},
): string {
  const r = size / 2;
  let path = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!cells.includes(row[x])) continue;
      const cx = x + dx + 0.5;
      const cy = y + dy + 0.5;
      path += `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${size} 0a${r} ${r} 0 1 0 ${-size} 0z`;
    }
  });
  return path;
}
