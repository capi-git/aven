/**
 * The names projects, bots and chats are known by: twelve critters, from
 * when Aven drew them as pixel characters. Storage still saves a project's
 * pick by critter name (`monocode:tab-group:mascots`), and a bot without a
 * name of its own is called by its project's critter ("Jelly"), so the
 * names stay. Each is drawn now as one of the project sigils in
 * `dotSigils` (`CRITTER_SIGILS`).
 */

export type ProjectMascot = {
  /** Saved and compared by this. */
  name: string;
  /** What people call it: "Owl", "Jellyfish". */
  label: string;
};

/** In the order their hash picks them, which must not change. */
export const PROJECT_MASCOTS: readonly ProjectMascot[] = [
  { name: "owl", label: "Owl" },
  { name: "axolotl", label: "Axolotl" },
  { name: "moth", label: "Moth" },
  { name: "snail", label: "Snail" },
  { name: "jelly", label: "Jellyfish" },
  { name: "cactus", label: "Cactus" },
  { name: "sprout", label: "Sprout" },
  { name: "puffin", label: "Puffin" },
  { name: "fox", label: "Fox" },
  { name: "whale", label: "Whale" },
  { name: "beetle", label: "Beetle" },
  { name: "hedgehog", label: "Hedgehog" },
];

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

const BY_NAME = new Map(PROJECT_MASCOTS.map((mascot) => [mascot.name, mascot]));

/** Whether `name` is a critter's (or an older sprite's) name. */
export function isMascotName(name: string): boolean {
  return BY_NAME.has(currentMascotName(name));
}

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

/**
 * Merges each row's runs of `cells` into one rect so the path stays short:
 * a grid drawing as SVG path data (Aven's own mark uses it). `dx`/`dy`
 * place the drawing on its grid.
 */
export function mascotCellsPath(
  rows: readonly string[],
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
export function mascotPath(rows: readonly string[], dx = 0, dy = 0): string {
  return mascotCellsPath(rows, "#", dx, dy);
}
