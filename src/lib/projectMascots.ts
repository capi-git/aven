/**
 * Aven's critters: twelve original 12×12 pixel characters that stand in for a
 * project's colour dot and give each agent in a discussion, race or run a face.
 * One character per cell:
 *
 * - `#` body, painted in the mascot's colour
 * - `=` shade and `+` light, the body colour darkened or lightened
 * - `e` eye, near-black on any colour; `w` a white glint
 * - `*` Aven's summit blue, the accent of its own mark
 * - `.` empty, so the surface shows through
 *
 * Each critter has two frames: `rest`, and `talk` swapped in on a loop while
 * the project has a turn in flight. A `blink` overlay closes its eyes for the
 * one-shot reactions at a turn's end.
 */
const GRID = 12;

type MascotRows = readonly string[];

/**
 * One frame as SVG path data over the 12×12 viewBox, a few merged paths
 * drawn in this order. Any of them can be empty.
 */
export type MascotFrame = {
  /** Every filled cell except the eyes and the summit, in the mascot colour. */
  body: string;
  /** `=` cells, darkened over the body. */
  shade: string;
  /** `+` cells, lightened over the body. */
  light: string;
  eyes: string;
  glint: string;
  /** `*` cells, in Aven's summit blue. */
  summit: string;
};

export type ProjectMascot = {
  /** Saved and compared by this. */
  name: string;
  /** What people call it: "Owl", "Jellyfish". */
  label: string;
  rest: MascotRows;
  talk: MascotRows;
  restFrame: MascotFrame;
  talkFrame: MascotFrame;
  /** The eye cells of `rest`, drawn over as closed lids to blink. */
  blinkPath: string;
};

const LABELS: Record<string, string> = {
  owl: "Owl",
  axolotl: "Axolotl",
  moth: "Moth",
  snail: "Snail",
  jelly: "Jellyfish",
  cactus: "Cactus",
  sprout: "Sprout",
  puffin: "Puffin",
  fox: "Fox",
  whale: "Whale",
  beetle: "Beetle",
  hedgehog: "Hedgehog",
};

const REST: Record<string, MascotRows> = {
  owl: [
    "............",
    "..#......#..",
    "..##....##..",
    ".##########.",
    ".#+++##+++#.",
    ".#+e+##+e+#.",
    ".#+++==+++#.",
    ".####==####.",
    ".##++++++##.",
    ".#++++++++#.",
    "..##++++##..",
    "...=....=...",
  ],
  axolotl: [
    "............",
    "............",
    "+..........+",
    ".+.######.+.",
    "++########++",
    "..#e####e#..",
    "++########++",
    "..#=####=#..",
    "..##====##..",
    "...######...",
    "..+#....#+..",
    "............",
  ],
  moth: [
    ".#........#.",
    "..#......#..",
    "...######...",
    "++.#e##e#.++",
    "+#+######+#+",
    "+##+####+##+",
    "+###=##=###+",
    ".+##=##=##+.",
    "..++=##=++..",
    "....=##=....",
    ".....##.....",
    "............",
  ],
  snail: [
    "............",
    "........e..e",
    "........#..#",
    "...====.#..#",
    "..=####=####",
    ".=#====#=###",
    ".=#=++=#=##.",
    ".=#=+==#=##.",
    ".=##===#=##.",
    "..=#####=##.",
    "++++++++++#.",
    "............",
  ],
  jelly: [
    "............",
    "...++++++...",
    "..+######+..",
    ".+##*#####+.",
    ".##########.",
    ".##e####e##.",
    ".##########.",
    ".==========.",
    "..#.#..#.#..",
    ".#..#..#..#.",
    ".#.#....#.#.",
    "..#......#..",
  ],
  cactus: [
    ".....**.....",
    "....####....",
    "...######...",
    "...#e##e#...",
    "#..######...",
    "#..##==##..#",
    "##.######..#",
    ".#########.#",
    "...########.",
    "...######...",
    "..++++++++..",
    "...======...",
  ],
  sprout: [
    ".....*......",
    ".++..=..++..",
    "+##+.=.+##+.",
    ".+##=#=##+..",
    "....=#=.....",
    "..++++++++..",
    "..#e####e#..",
    "..########..",
    "...##==##...",
    "...######...",
    "....####....",
    "............",
  ],
  puffin: [
    "............",
    "....####....",
    "...######...",
    "..##++++##..",
    "..#+e++e+#..",
    "..#++==++#..",
    ".##++++++##.",
    "#.#++++++#.#",
    "..#++++++#..",
    "..##++++##..",
    "...######...",
    "..==....==..",
  ],
  fox: [
    "............",
    "............",
    "..#......#..",
    ".#=#....#=#.",
    ".##########.",
    "############",
    "#+e######e+#",
    "++++#ee#++++",
    ".++++==++++.",
    "..++++++++..",
    "....++++....",
    "............",
  ],
  whale: [
    "............",
    "..*.*.......",
    "...*........",
    "............",
    "...######...",
    ".########..#",
    "#e#######.##",
    "##########=.",
    "#+++++####..",
    ".+++++###...",
    "..######....",
    "............",
  ],
  beetle: [
    "..#......#..",
    "...#....#...",
    "....####....",
    "...#e##e#...",
    "..=##==##=..",
    "#=###==###=#",
    ".=#*#==###=.",
    "#=###==#*#=#",
    ".=###==###=.",
    "#.=##==##=.#",
    "...======...",
    "............",
  ],
  hedgehog: [
    "............",
    "............",
    "....=.=.=...",
    "...=#=#=#=..",
    "..=#=#=#=#=.",
    ".+==#=#=#=#=",
    "+e+=#=#=#=#=",
    "++++=#=#=#=.",
    "e++++======.",
    ".+++++++++..",
    "..#..#..#...",
    "............",
  ],
};

const TALK: Record<string, MascotRows> = {
  owl: [
    "............",
    "..#......#..",
    "..##....##..",
    ".##########.",
    ".#+++##+++#.",
    ".#++e##++e#.",
    ".#+++==+++#.",
    ".####==####.",
    "###++++++###",
    ".#++++++++#.",
    "..##++++##..",
    "..=......=..",
  ],
  axolotl: [
    "............",
    "............",
    "............",
    "+..######..+",
    ".+########+.",
    "+.#e####e#.+",
    ".+########+.",
    "..#=####=#..",
    "..##=++=##..",
    "...######...",
    "...+#..#+...",
    "............",
  ],
  moth: [
    "#..........#",
    ".#........#.",
    "...######...",
    "...#e##e#...",
    "++.######.++",
    "+#+######+#+",
    "+##+=##=+##+",
    "+###=##=###+",
    ".+##=##=##+.",
    "..++=##=++..",
    ".....##.....",
    "............",
  ],
  snail: [
    "............",
    ".........e.e",
    ".........#.#",
    "...====..#.#",
    "..=####=####",
    ".=#====#=###",
    ".=#=++=#=##.",
    ".=#=+==#=##.",
    ".=##===#=##.",
    "..=#####=##.",
    ".++++++++++.",
    "............",
  ],
  jelly: [
    "............",
    "...++++++...",
    "..+######+..",
    ".+##*#####+.",
    ".##########.",
    ".##e####e##.",
    ".##########.",
    ".==========.",
    "..#.#..#.#..",
    "..#.#..#.#..",
    ".#..#..#..#.",
    ".#.#....#.#.",
  ],
  cactus: [
    "......**....",
    "....####....",
    "...######..#",
    "...#e##e#..#",
    "...######..#",
    "#..##==#####",
    "#..######...",
    "##.######...",
    ".#########..",
    "...######...",
    "..++++++++..",
    "...======...",
  ],
  sprout: [
    ".++..*..++..",
    "+##+.=.+##+.",
    ".+##=#=##+..",
    "....=#=.....",
    "....=#=.....",
    "..++++++++..",
    "..#e####e#..",
    "..########..",
    "...##==##...",
    "...######...",
    "....####....",
    "............",
  ],
  puffin: [
    "............",
    "....####....",
    "...######...",
    "..##++++##..",
    "..#+e++e+#..",
    "..#++==++#..",
    "#.#++++++#.#",
    ".##++++++##.",
    "..#++++++#..",
    "..##++++##..",
    "...######...",
    "...==..==...",
  ],
  fox: [
    "............",
    "............",
    ".#.......#..",
    "#=#.....#=#.",
    ".##########.",
    "############",
    "#+e######e+#",
    "++++#ee#++++",
    ".++++ee++++.",
    "..++++++++..",
    "....++++....",
    "............",
  ],
  whale: [
    ".*...*......",
    "..*.*.......",
    "...*........",
    "............",
    "...######...",
    ".########.#.",
    "#e#######.#.",
    "#########=..",
    "#+++++####..",
    ".+++++###...",
    "..######....",
    "............",
  ],
  beetle: [
    ".#........#.",
    "..#......#..",
    "....####....",
    "...#e##e#...",
    "..=##==##=..",
    ".=###==###=.",
    "#=#*#==###=#",
    ".=###==#*#=.",
    "#=###==###=#",
    "..=##==##=..",
    "...======...",
    "............",
  ],
  hedgehog: [
    "............",
    "............",
    "....=.=.=...",
    "...=#=#=#=..",
    "..=#=#=#=#=.",
    ".+==#=#=#=#=",
    "+e+=#=#=#=#=",
    "e+++=#=#=#=.",
    ".++++======.",
    ".+++++++++..",
    "...#..#..#..",
    "............",
  ],
};

/**
 * Projects saved a mascot by name before the critters arrived. Each old
 * sprite reads as the critter closest to it, so nobody's pick turns into a
 * random one; storage keeps the old name.
 */
const LEGACY_NAMES = new Map<string, string>([
  ["invader", "moth"],
  ["ghost", "jelly"],
  ["robot", "owl"],
  ["cat", "fox"],
  ["skull", "snail"],
  ["crab", "beetle"],
  ["mushroom", "sprout"],
  ["rocket", "whale"],
  ["dino", "hedgehog"],
  ["frog", "axolotl"],
]);

/** A saved mascot name as today's cast knows it. */
export function currentMascotName(name: string): string {
  return LEGACY_NAMES.get(name) ?? name;
}

/**
 * Merges each row's runs of `cells` into one rect so the path stays short.
 * `dx`/`dy` place the sprite on the mascot's grid, so overlays can sit beside
 * or above it.
 */
export function mascotCellsPath(
  rows: MascotRows,
  cells: string,
  dx = 0,
  dy = 0,
): string {
  let path = "";
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!cells.includes(row[x])) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < row.length && cells.includes(row[x + run])) run += 1;
      path += `M${x + dx} ${y + dy}h${run}v1h-${run}z`;
      x += run;
    }
  });
  return path;
}

/** Path data for the `#` cells of `rows`. */
export function mascotPath(rows: MascotRows, dx = 0, dy = 0): string {
  return mascotCellsPath(rows, "#", dx, dy);
}

/** Every cell the critter's colour paints: all but eyes, summit and gaps. */
const BODY_CELLS = "#=+w";

/** One frame's paths, worked out once when this module loads. */
export function mascotFrame(rows: MascotRows): MascotFrame {
  return {
    body: mascotCellsPath(rows, BODY_CELLS),
    shade: mascotCellsPath(rows, "="),
    light: mascotCellsPath(rows, "+"),
    eyes: mascotCellsPath(rows, "e"),
    glint: mascotCellsPath(rows, "w"),
    summit: mascotCellsPath(rows, "*"),
  };
}

/**
 * Only the eyes of `rows`, as a frame: the `e` cells of the highest row that
 * has any. A nose or an open mouth lower down (the fox's, the hedgehog's)
 * stays open while the eyes close.
 */
export function blinkRows(rows: MascotRows): string[] {
  const eyes = rows.findIndex((row) => row.includes("e"));
  return rows.map((row, y) =>
    y === eyes
      ? row.replace(/[^e]/g, ".").replace(/e/g, "#")
      : ".".repeat(row.length),
  );
}

export const PROJECT_MASCOTS: readonly ProjectMascot[] = Object.entries(
  REST,
).map(([name, rest]) => ({
  name,
  label: LABELS[name],
  rest,
  talk: TALK[name],
  restFrame: mascotFrame(rest),
  talkFrame: mascotFrame(TALK[name]),
  blinkPath: mascotPath(blinkRows(rest)),
}));

const BY_NAME = new Map(PROJECT_MASCOTS.map((mascot) => [mascot.name, mascot]));

export const MASCOT_GRID = GRID;

/*
 * Overlay sprites for the reactions, on the mascot's own grid so they scale
 * with it and stay crisp. They sit just outside the 12×12 box; the mascot's
 * SVG lets them overflow.
 */

/** A four-point sparkle above the mascot's right shoulder. */
export const MASCOT_SPARKLE_PATH = mascotPath(
  ["..#..", "..#..", "##.##", "..#..", "..#.."],
  10,
  -4,
);
/** A small twinkle on the other side. */
export const MASCOT_TWINKLE_PATH = mascotPath([".#.", "###", ".#."], -4, 0);
/** A drop of sweat beside the mascot's head. */
export const MASCOT_SWEAT_PATH = mascotPath([".#", "##", "##"], 12, 2);

/** "zzz" for a resting project: three pixel z's growing as they rise. */
export const RESTING_ZZZ_GRID = { width: 13, height: 12 } as const;
export const RESTING_ZZZ_PATHS: readonly string[] = [
  mascotPath(["###", "..#", ".#.", "###"], 0, 8),
  mascotPath(["####", "..#.", ".#..", "####"], 4, 4),
  mascotPath(["####", "...#", "..#.", ".#..", "####"], 9, 0),
];

/** Stable per-project pick — a different mix than the color hash so a project's
 *  mascot and color vary independently. An explicit `name` wins, read through
 *  the old names; an unknown one falls back to the hash. */
export function projectMascot(
  project: string,
  name?: string | null,
): ProjectMascot {
  const chosen = name ? BY_NAME.get(currentMascotName(name)) : undefined;
  if (chosen) return chosen;

  let hash = 0;
  for (let i = 0; i < project.length; i++) {
    hash = (hash * 131 + project.charCodeAt(i)) >>> 0;
  }
  return PROJECT_MASCOTS[hash % PROJECT_MASCOTS.length];
}

type Hsl = { h: number; s: number; l: number };

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === r
      ? ((g - b) / d + 6) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/** Hex, `rgb()` and `hsl()` colours as HSL; null for anything else. */
export function parseHsl(color: string): Hsl | null {
  const text = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1];
  if (hex) {
    const full =
      hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
    const [r, g, b] = [0, 2, 4].map(
      (at) => parseInt(full.slice(at, at + 2), 16) / 255,
    );
    return rgbToHsl(r, g, b);
  }
  const fn = /^(rgb|hsl)a?\(([^)]*)\)$/.exec(text);
  if (!fn) return null;
  const parts = fn[2]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .slice(0, 3);
  if (parts.length < 3) return null;
  const numbers = parts.map((part) => parseFloat(part));
  if (numbers.some((value) => Number.isNaN(value))) return null;
  if (fn[1] === "hsl")
    return {
      h: ((numbers[0] % 360) + 360) % 360,
      s: numbers[1] / 100,
      l: numbers[2] / 100,
    };
  const [r, g, b] = parts.map((part, index) =>
    part.endsWith("%") ? numbers[index] / 100 : numbers[index] / 255,
  );
  return rgbToHsl(r, g, b);
}

const parsed = new Map<string, Hsl | null>();

/** `parseHsl`, remembered: mascots ask on every render with a few colours. */
function readColor(color: string): Hsl | null {
  let hsl = parsed.get(color);
  if (hsl === undefined) {
    if (parsed.size > 256) parsed.clear();
    hsl = parseHsl(color);
    parsed.set(color, hsl);
  }
  return hsl;
}

/**
 * Whether Aven's summit blue would vanish on a mascot of `color`: both are
 * saturated, close in hue and in lightness, as on Codex's blue or a blue
 * project. Such a mascot draws its summit pale instead. A colour that can't
 * be read here (a CSS variable, a mix) keeps the blue.
 */
export function summitBlendsIn(
  color: string | null | undefined,
  summit: string,
): boolean {
  const body = color ? readColor(color) : null;
  const blue = readColor(summit);
  if (!body || !blue) return false;
  const hue = Math.abs(body.h - blue.h);
  return (
    body.s >= 0.3 &&
    blue.s >= 0.3 &&
    Math.min(hue, 360 - hue) <= 30 &&
    Math.abs(body.l - blue.l) <= 0.25
  );
}

/**
 * What the eyes need to show on a mascot of `color`: near-black on most
 * colours, pale on a dark one, and "theme" for a colour read from the theme
 * (the text colour, or a mix of it), which is light in the dark theme and
 * dark in the light one.
 */
export function mascotEyeInk(
  color: string | null | undefined,
): "dark" | "light" | "theme" {
  const body = color ? readColor(color) : null;
  if (!body) return "theme";
  return body.l < 0.32 ? "light" : "dark";
}

/** The streak's pixel flame: an amber body around a pale core. */
export const STREAK_FLAME_PATHS = {
  body: mascotPath([
    "...#....",
    "...##...",
    "..###.#.",
    ".######.",
    ".##..##.",
    ".#....#.",
    ".##..##.",
    "..####..",
  ]),
  core: mascotPath(["...##...", "..####..", "...##..."], 0, 4),
} as const;
