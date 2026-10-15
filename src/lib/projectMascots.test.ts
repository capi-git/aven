import { describe, expect, it } from "vitest";
import {
  MASCOT_GRID,
  MASCOT_SPARKLE_PATH,
  MASCOT_SWEAT_PATH,
  PROJECT_MASCOTS,
  blinkRows,
  mascotPath,
  projectMascot,
} from "./projectMascots";

describe("projectMascots", () => {
  it("keeps every sprite on the shared grid", () => {
    expect(PROJECT_MASCOTS).toHaveLength(10);
    for (const mascot of PROJECT_MASCOTS) {
      for (const frame of [mascot.rest, mascot.talk]) {
        expect(frame).toHaveLength(MASCOT_GRID);
        for (const row of frame) {
          expect(row).toMatch(new RegExp(`^[#.]{${MASCOT_GRID}}$`));
        }
      }
      expect(mascot.restPath).not.toBe("");
      expect(mascot.talkPath).not.toBe("");
      expect(mascot.talkPath).not.toBe(mascot.restPath);
    }
  });

  it("merges filled runs into one rect each", () => {
    expect(mascotPath(["##..###."])).toBe("M0 0h2v1h-2zM4 0h3v1h-3z");
    expect(mascotPath(["........"])).toBe("");
  });

  it("places overlay sprites on the mascot's grid", () => {
    expect(mascotPath(["#"], 8, -2)).toBe("M8 -2h1v1h-1z");
    // The sparkle sits above the box and the drop beside it, never on the sprite.
    expect(MASCOT_SPARKLE_PATH).toContain("M8 -3");
    expect(MASCOT_SWEAT_PATH).toBe("M8 1h1v1h-1zM8 2h1v1h-1z");
  });

  it("closes only the holes between filled pixels of the eye row", () => {
    expect(blinkRows(["..#..#..", ".#.##.#."], 1)).toEqual([
      "........",
      "..#..#..",
    ]);
    expect(blinkRows(["..#..#.."], 0)).toEqual(["...##..."]);
  });

  it("gives every mascot a blink that closes its eyes", () => {
    for (const mascot of PROJECT_MASCOTS) {
      expect(mascot.blinkPath, mascot.name).not.toBe("");
      expect(mascot.blinkPath).not.toBe(mascot.restPath);
      // Closed eyes fill holes; they never repaint a filled pixel.
      const rest = new Set(rectsOf(mascot.restPath));
      for (const rect of rectsOf(mascot.blinkPath))
        expect(rest.has(rect), `${mascot.name} ${rect}`).toBe(false);
    }
  });

  it("picks the same mascot for the same project", () => {
    expect(projectMascot("~/code/aven")).toBe(projectMascot("~/code/aven"));
  });

  it("honors an explicit pick and ignores unknown names", () => {
    expect(projectMascot("alpha", "ghost").name).toBe("ghost");
    expect(projectMascot("alpha", "nope").name).toBe(
      projectMascot("alpha").name,
    );
    expect(projectMascot("alpha", null).name).toBe(projectMascot("alpha").name);
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

/** Every filled cell of a path from `mascotPath`, as "x,y". */
function rectsOf(path: string): string[] {
  const cells: string[] = [];
  for (const match of path.matchAll(/M(-?\d+) (-?\d+)h(\d+)/g)) {
    const [x, y, run] = [Number(match[1]), Number(match[2]), Number(match[3])];
    for (let i = 0; i < run; i++) cells.push(`${x + i},${y}`);
  }
  return cells;
}
