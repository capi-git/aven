/**
 * 8×8 pixel mascots used in place of a project's color dot.
 * '#' paints the project color, '.' stays transparent so the surface shows
 * through — eyes and gaps are holes, like the arcade sprites they borrow from.
 *
 * Each mascot has two frames: `rest`, and `talk` swapped in on a loop while the
 * project has a turn in flight — mouths chew, legs shuffle, flames flicker.
 * A `blink` overlay closes its eyes for the one-shot reactions at a turn's end.
 */
const GRID = 8;

type MascotRows = readonly string[];

export type ProjectMascot = {
  name: string;
  rest: MascotRows;
  talk: MascotRows;
  /** SVG path data over an 8×8 viewBox, one per frame. */
  restPath: string;
  talkPath: string;
  /** Fills the eye holes of `rest`, drawn over it to blink. */
  blinkPath: string;
};

const REST: Record<string, MascotRows> = {
  invader: [
    "..#..#..",
    ".######.",
    "##.##.##",
    "########",
    ".######.",
    ".#.##.#.",
    "#.#..#.#",
    "........",
  ],
  ghost: [
    "..####..",
    ".######.",
    "##.##.##",
    "########",
    "########",
    "########",
    "########",
    "#.##.##.",
  ],
  robot: [
    "...#....",
    ".######.",
    ".#.##.#.",
    ".######.",
    ".#....#.",
    ".######.",
    "..#..#..",
    "........",
  ],
  cat: [
    ".#....#.",
    ".##..##.",
    "########",
    "#.####.#",
    "########",
    "###..###",
    ".######.",
    "..#..#..",
  ],
  skull: [
    ".######.",
    "########",
    "##.##.##",
    "########",
    ".##..##.",
    ".######.",
    ".#.##.#.",
    "........",
  ],
  crab: [
    "#......#",
    ".#....#.",
    ".######.",
    "##.##.##",
    "########",
    "#.####.#",
    "#......#",
    "........",
  ],
  mushroom: [
    "..####..",
    ".######.",
    "########",
    "##.##.##",
    "########",
    "...##...",
    "...##...",
    "..####..",
  ],
  rocket: [
    "...##...",
    "..####..",
    "..#..#..",
    "..####..",
    ".######.",
    ".######.",
    "##....##",
    "..####..",
  ],
  dino: [
    "...#####",
    "...##.##",
    "...#####",
    ".#######",
    "########",
    "#####...",
    ".##.##..",
    "..#..#..",
  ],
  frog: [
    "........",
    "##....##",
    "#.####.#",
    "########",
    "########",
    ".######.",
    "##....##",
    "........",
  ],
};

const TALK: Record<string, MascotRows> = {
  invader: [
    "..#..#..",
    ".######.",
    "##.##.##",
    "########",
    ".######.",
    "#.####.#",
    ".#....#.",
    "#......#",
  ],
  ghost: [
    "..####..",
    ".######.",
    "#.##.###",
    "########",
    "########",
    "########",
    "########",
    ".##.##.#",
  ],
  robot: [
    "....#...",
    ".######.",
    ".#.##.#.",
    ".######.",
    ".##..##.",
    ".######.",
    ".#....#.",
    "........",
  ],
  cat: [
    ".#....#.",
    ".##..##.",
    "########",
    "#.####.#",
    "########",
    "########",
    ".######.",
    ".#....#.",
  ],
  skull: [
    ".######.",
    "########",
    "##.##.##",
    "########",
    ".##..##.",
    ".######.",
    ".#....#.",
    "..####..",
  ],
  crab: [
    "#......#",
    "##....##",
    ".######.",
    "##.##.##",
    "########",
    ".######.",
    "#.#..#.#",
    "........",
  ],
  mushroom: [
    "........",
    "..####..",
    ".######.",
    "########",
    "##.##.##",
    "...##...",
    "...##...",
    "..####..",
  ],
  rocket: [
    "...##...",
    "..####..",
    "..#..#..",
    "..####..",
    ".######.",
    ".######.",
    "##....##",
    "...##...",
  ],
  dino: [
    "...#####",
    "...##.##",
    "...#####",
    ".#######",
    "########",
    "#####...",
    "..##.##.",
    "..#...#.",
  ],
  frog: [
    "##....##",
    "#.####.#",
    "########",
    "########",
    ".######.",
    "##....##",
    "#......#",
    "........",
  ],
};

/** The row holding each mascot's eyes (or the rocket's window, the mushroom's spots). */
const EYES: Record<string, number> = {
  invader: 2,
  ghost: 2,
  robot: 2,
  cat: 3,
  skull: 2,
  crab: 3,
  mushroom: 3,
  rocket: 2,
  dino: 1,
  frog: 2,
};

/**
 * Merges each row's filled runs into one rect so the path stays short.
 * `dx`/`dy` place the sprite on the mascot's grid, so overlays can sit beside
 * or above it.
 */
export function mascotPath(rows: MascotRows, dx = 0, dy = 0): string {
  let path = "";
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== "#") {
        x += 1;
        continue;
      }
      let run = 1;
      while (row[x + run] === "#") run += 1;
      path += `M${x + dx} ${y + dy}h${run}v1h-${run}z`;
      x += run;
    }
  });
  return path;
}

/** Only the holes between filled pixels of row `eyes`: closed eyes, as a frame. */
export function blinkRows(rows: MascotRows, eyes: number): string[] {
  return rows.map((row, y) => {
    if (y !== eyes) return ".".repeat(row.length);
    const first = row.indexOf("#");
    const last = row.lastIndexOf("#");
    return [...row]
      .map((cell, x) => (cell === "." && x > first && x < last ? "#" : "."))
      .join("");
  });
}

export const PROJECT_MASCOTS: readonly ProjectMascot[] = Object.entries(
  REST,
).map(([name, rest]) => ({
  name,
  rest,
  talk: TALK[name],
  restPath: mascotPath(rest),
  talkPath: mascotPath(TALK[name]),
  blinkPath: mascotPath(blinkRows(rest, EYES[name])),
}));

export const MASCOT_GRID = GRID;

/*
 * Overlay sprites for the reactions, on the mascot's own grid so they scale
 * with it and stay crisp. They sit just outside the 8×8 box; the mascot's SVG
 * lets them overflow.
 */

/** A four-point sparkle above the mascot's right shoulder. */
export const MASCOT_SPARKLE_PATH = mascotPath([".#.", "###", ".#."], 7, -3);
/** A single twinkling pixel on the other side. */
export const MASCOT_TWINKLE_PATH = mascotPath(["#"], -2, 0);
/** A two-pixel drop of sweat beside the mascot's head. */
export const MASCOT_SWEAT_PATH = mascotPath(["#", "#"], 8, 1);

/** "zzz" for a resting project: three pixel z's rising to the right. */
export const RESTING_ZZZ_GRID = { width: 11, height: 10 } as const;
export const RESTING_ZZZ_PATHS: readonly string[] = [
  mascotPath(["###", ".#.", "###"], 0, 7),
  mascotPath(["###", ".#.", "###"], 3, 4),
  mascotPath(["####", "..#.", ".#..", "####"], 7, 0),
];

/** Stable per-project pick — a different mix than the color hash so a project's
 *  mascot and color vary independently. An explicit `name` wins; an unknown one
 *  falls back to the hash. */
export function projectMascot(
  project: string,
  name?: string | null,
): ProjectMascot {
  const chosen = name
    ? PROJECT_MASCOTS.find((mascot) => mascot.name === name)
    : undefined;
  if (chosen) return chosen;

  let hash = 0;
  for (let i = 0; i < project.length; i++) {
    hash = (hash * 131 + project.charCodeAt(i)) >>> 0;
  }
  return PROJECT_MASCOTS[hash % PROJECT_MASCOTS.length];
}
