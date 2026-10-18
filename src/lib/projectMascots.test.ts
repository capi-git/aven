import { describe, expect, it } from "vitest";
import { AVEN_MARK_SUMMIT_COLOR } from "./avenMark";
import {
  MASCOT_GRID,
  MASCOT_SPARKLE_PATH,
  MASCOT_SWEAT_PATH,
  MASCOT_TWINKLE_PATH,
  PROJECT_MASCOTS,
  blinkRows,
  currentMascotName,
  mascotCellsPath,
  mascotEyeInk,
  mascotFrame,
  mascotPath,
  parseHsl,
  projectMascot,
  summitBlendsIn,
} from "./projectMascots";

const CAST = [
  "owl",
  "axolotl",
  "moth",
  "snail",
  "jelly",
  "cactus",
  "sprout",
  "puffin",
  "fox",
  "whale",
  "beetle",
  "hedgehog",
];

/** Every cell of `rows` holding one of `chars`, as "x,y". */
function cellsOf(rows: readonly string[], chars: string): string[] {
  const cells: string[] = [];
  rows.forEach((row, y) =>
    [...row].forEach((cell, x) => {
      if (chars.includes(cell)) cells.push(`${x},${y}`);
    }),
  );
  return cells;
}

/** Every filled cell of a path from `mascotPath`, as "x,y". */
function rectsOf(path: string): string[] {
  const cells: string[] = [];
  for (const match of path.matchAll(/M(-?\d+) (-?\d+)h(\d+)/g)) {
    const [x, y, run] = [Number(match[1]), Number(match[2]), Number(match[3])];
    for (let i = 0; i < run; i++) cells.push(`${x + i},${y}`);
  }
  return cells;
}

const point = (cell: string) => cell.split(",").map(Number) as [number, number];

describe("projectMascots", () => {
  it("casts twelve critters, each on the 12×12 grid in legal cells", () => {
    expect(MASCOT_GRID).toBe(12);
    expect(PROJECT_MASCOTS.map((mascot) => mascot.name)).toEqual(CAST);
    for (const mascot of PROJECT_MASCOTS) {
      for (const frame of [mascot.rest, mascot.talk]) {
        expect(frame, mascot.name).toHaveLength(MASCOT_GRID);
        for (const row of frame)
          expect(row, mascot.name).toMatch(/^[#=+ew*.]{12}$/);
        expect(cellsOf(frame, "e").length, mascot.name).toBeGreaterThan(0);
      }
      expect(mascot.talk, mascot.name).not.toEqual(mascot.rest);
    }
  });

  it("names each critter plainly", () => {
    expect(PROJECT_MASCOTS.map((mascot) => mascot.label)).toEqual([
      "Owl",
      "Axolotl",
      "Moth",
      "Snail",
      "Jellyfish",
      "Cactus",
      "Sprout",
      "Puffin",
      "Fox",
      "Whale",
      "Beetle",
      "Hedgehog",
    ]);
  });

  it("draws each frame as a body with shade, light, eyes and summit over it", () => {
    for (const mascot of PROJECT_MASCOTS) {
      for (const [rows, frame] of [
        [mascot.rest, mascot.restFrame],
        [mascot.talk, mascot.talkFrame],
      ] as const) {
        // The body is every painted cell but the eyes and the summit.
        expect(rectsOf(frame.body).sort()).toEqual(
          cellsOf(rows, "#=+w").sort(),
        );
        expect(rectsOf(frame.shade).sort()).toEqual(cellsOf(rows, "=").sort());
        expect(rectsOf(frame.light).sort()).toEqual(cellsOf(rows, "+").sort());
        expect(rectsOf(frame.eyes).sort()).toEqual(cellsOf(rows, "e").sort());
        expect(rectsOf(frame.summit).sort()).toEqual(cellsOf(rows, "*").sort());
      }
    }
    // The owl has no summit; the jellyfish wears one on its bell.
    expect(projectMascot("x", "owl").restFrame.summit).toBe("");
    expect(projectMascot("x", "jelly").restFrame.summit).toBe("M4 3h1v1h-1z");
  });

  it("merges filled runs into one rect each", () => {
    expect(mascotPath(["##..###."])).toBe("M0 0h2v1h-2zM4 0h3v1h-3z");
    expect(mascotPath(["........"])).toBe("");
    // Only `#` counts for mascotPath, which Aven's own mark relies on.
    expect(mascotPath([".#B#."])).toBe("M1 0h1v1h-1zM3 0h1v1h-1z");
    expect(mascotCellsPath(["#=+e"], "#=+")).toBe("M0 0h3v1h-3z");
    expect(mascotFrame(["#=e*"]).body).toBe("M0 0h2v1h-2z");
  });

  it("places overlay sprites just outside the critter's box", () => {
    expect(mascotPath(["#"], 12, -2)).toBe("M12 -2h1v1h-1z");
    const inside = (cell: string) => {
      const [x, y] = point(cell);
      return x >= 0 && x < MASCOT_GRID && y >= 0 && y < MASCOT_GRID;
    };
    for (const path of [
      MASCOT_SPARKLE_PATH,
      MASCOT_TWINKLE_PATH,
      MASCOT_SWEAT_PATH,
    ]) {
      expect(rectsOf(path).length).toBeGreaterThan(0);
      expect(rectsOf(path).filter(inside)).toEqual([]);
    }
    // The sparkle rises above the right shoulder, the twinkle sits left of
    // the head and the drop runs down beside it.
    for (const [x, y] of rectsOf(MASCOT_SPARKLE_PATH).map(point)) {
      expect(x).toBeGreaterThanOrEqual(10);
      expect(y).toBeLessThanOrEqual(0);
    }
    for (const [x] of rectsOf(MASCOT_TWINKLE_PATH).map(point))
      expect(x).toBeLessThan(0);
    for (const [x] of rectsOf(MASCOT_SWEAT_PATH).map(point))
      expect(x).toBeGreaterThanOrEqual(MASCOT_GRID);
  });

  it("closes only the highest row of eyes", () => {
    expect(blinkRows(["..e..e..", "...ee..."])).toEqual([
      "..#..#..",
      "........",
    ]);
    expect(blinkRows(["........", ".#e##e#."])).toEqual([
      "........",
      "..#..#..",
    ]);
  });

  it("gives every critter a blink that covers exactly its eyes", () => {
    for (const mascot of PROJECT_MASCOTS) {
      const firstEyeRow = mascot.rest.findIndex((row) => row.includes("e"));
      const eyes = cellsOf(mascot.rest, "e").filter(
        (cell) => point(cell)[1] === firstEyeRow,
      );
      expect(rectsOf(mascot.blinkPath).sort(), mascot.name).toEqual(
        eyes.sort(),
      );
    }
    // A nose below the eyes stays open while they close.
    expect(rectsOf(projectMascot("x", "fox").blinkPath).sort()).toEqual([
      "2,6",
      "9,6",
    ]);
    expect(rectsOf(projectMascot("x", "hedgehog").blinkPath)).toEqual(["1,6"]);
  });

  it("picks the same mascot for the same project", () => {
    expect(projectMascot("~/code/aven")).toBe(projectMascot("~/code/aven"));
  });

  it("honors an explicit pick and ignores unknown names", () => {
    expect(projectMascot("alpha", "whale").name).toBe("whale");
    expect(projectMascot("alpha", "nope").name).toBe(
      projectMascot("alpha").name,
    );
    expect(projectMascot("alpha", null).name).toBe(projectMascot("alpha").name);
    expect(projectMascot("alpha", "constructor").name).toBe(
      projectMascot("alpha").name,
    );
  });

  it("reads a pick saved under an old sprite's name as its critter", () => {
    const old: Record<string, string> = {
      invader: "moth",
      ghost: "jelly",
      robot: "owl",
      cat: "fox",
      skull: "snail",
      crab: "beetle",
      mushroom: "sprout",
      rocket: "whale",
      dino: "hedgehog",
      frog: "axolotl",
    };
    for (const [from, to] of Object.entries(old)) {
      expect(currentMascotName(from)).toBe(to);
      expect(projectMascot("alpha", from).name).toBe(to);
    }
    expect(new Set(Object.values(old)).size).toBe(10);
    expect(currentMascotName("owl")).toBe("owl");
    expect(currentMascotName("nope")).toBe("nope");
  });

  it("spreads projects across the roster", () => {
    const names = new Set(
      [
        "alpha",
        "beta",
        "gamma",
        "delta",
        "epsilon",
        "zeta",
        "eta",
        "theta",
      ].map((project) => projectMascot(project).name),
    );
    expect(names.size).toBeGreaterThan(3);
  });
});

describe("summit colour", () => {
  it("reads hex, rgb() and hsl() colours", () => {
    expect(parseHsl("#fff")).toEqual({ h: 0, s: 0, l: 1 });
    expect(parseHsl("#ff0000")).toEqual({ h: 0, s: 1, l: 0.5 });
    expect(parseHsl("rgb(0, 0, 255)")).toEqual({ h: 240, s: 1, l: 0.5 });
    expect(parseHsl("hsl(211 92% 62%)")).toEqual({
      h: 211,
      s: 0.92,
      l: 0.62,
    });
    expect(parseHsl("var(--color-content)")).toBeNull();
  });

  it("turns pale only on a mascot already close to Aven's blue", () => {
    const blends = (color?: string) =>
      summitBlendsIn(color, AVEN_MARK_SUMMIT_COLOR);
    // Codex's blue and the palette's blue would swallow it.
    expect(blends("#7a9dff")).toBe(true);
    expect(blends("hsl(211 92% 62%)")).toBe(true);
    // Claude's coral, a grey, a teal and an unreadable colour keep the blue.
    expect(blends("#d97757")).toBe(false);
    expect(blends("hsl(210 8% 58%)")).toBe(false);
    expect(blends("hsl(175 55% 48%)")).toBe(false);
    expect(
      blends("color-mix(in srgb, var(--color-content) 78%, transparent)"),
    ).toBe(false);
    // Inheriting the text colour keeps the blue too.
    expect(blends(undefined)).toBe(false);
  });
});

describe("eye ink", () => {
  it("keeps eyes dark on most colours and pale on a dark one", () => {
    expect(mascotEyeInk("#d97757")).toBe("dark");
    expect(mascotEyeInk("hsl(45 90% 55%)")).toBe("dark");
    expect(mascotEyeInk("hsl(210 8% 58%)")).toBe("dark");
    expect(mascotEyeInk("#2a2b35")).toBe("light");
  });

  it("follows the theme for a colour taken from its text", () => {
    expect(mascotEyeInk(undefined)).toBe("theme");
    expect(
      mascotEyeInk("color-mix(in srgb, var(--color-content) 78%, transparent)"),
    ).toBe("theme");
  });
});
