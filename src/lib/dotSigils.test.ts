import { describe, expect, it } from "vitest";
import {
  ALL_SIGILS,
  CRITTER_SIGILS,
  CROSS_ROWS,
  DIAGONALS,
  MEMBER_SIGIL_CHOICES,
  PROJECT_SIGILS,
  ROLE_SIGILS,
  SIGIL_CRITTERS,
  TICK_ROWS,
  appearanceSigil,
  crewMemberSigil,
  diagonalPaths,
  dotArtPath,
  dotsPath,
  isSigilKey,
  litCells,
  litPath,
  projectSigil,
  sigilByKey,
} from "./dotSigils";
import { PROJECT_MASCOTS, projectMascot } from "./projectMascots";

const lit = (rows: readonly string[]) => rows.join("").replace(/0/g, "").length;

/** How many of the 25 dots two patterns differ in. */
function distance(a: readonly string[], b: readonly string[]) {
  const [x, y] = [a.join(""), b.join("")];
  let count = 0;
  for (let index = 0; index < x.length; index++)
    if (x[index] !== y[index]) count += 1;
  return count;
}

/** One circle per dot: each starts with a move. */
const circles = (path: string) => (path.match(/M/g) ?? []).length;

describe("sigils", () => {
  it("draws every sigil on the 5×5 grid, never empty or full", () => {
    for (const sigil of [
      ...ALL_SIGILS,
      { key: "tick", rows: TICK_ROWS },
      { key: "cross", rows: CROSS_ROWS },
    ]) {
      expect(sigil.rows, sigil.key).toHaveLength(5);
      for (const row of sigil.rows) expect(row, sigil.key).toMatch(/^[01]{5}$/);
      // Enough dots to read at 15px, and open space around them.
      expect(lit(sigil.rows), sigil.key).toBeGreaterThanOrEqual(5);
      expect(lit(sigil.rows), sigil.key).toBeLessThanOrEqual(13);
      expect(25 - lit(sigil.rows), sigil.key).toBeGreaterThanOrEqual(8);
    }
  });

  it("keeps every sigil sparse and iconic: 7 to 13 lit dots", () => {
    for (const sigil of ALL_SIGILS) {
      expect(lit(sigil.rows), sigil.key).toBeGreaterThanOrEqual(7);
      expect(lit(sigil.rows), sigil.key).toBeLessThanOrEqual(13);
    }
  });

  it("has a sigil for every role, ready-made member and the custom one", () => {
    expect(ROLE_SIGILS.map((sigil) => sigil.key)).toEqual([
      "builder",
      "checker",
      "security",
      "scout",
      "designer",
      "tester",
      "scribe",
      "fixer",
      "custom",
    ]);
    expect(PROJECT_SIGILS).toHaveLength(12);
  });

  it("keeps every sigil, the tick and the cross apart by at least four dots", () => {
    const all = [
      ...ALL_SIGILS,
      { key: "tick", label: "", rows: TICK_ROWS },
      { key: "cross", label: "", rows: CROSS_ROWS },
    ];
    const close: string[] = [];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++)
        if (distance(all[i].rows, all[j].rows) < 4)
          close.push(`${all[i].key} and ${all[j].key}`);
    expect(close).toEqual([]);
    expect(new Set(ALL_SIGILS.map((sigil) => sigil.key)).size).toBe(
      ALL_SIGILS.length,
    );
    expect(new Set(ALL_SIGILS.map((sigil) => sigil.label)).size).toBe(
      ALL_SIGILS.length,
    );
  });

  it("looks a sigil up by its key", () => {
    expect(sigilByKey("checker")?.label).toBe("Checker");
    expect(sigilByKey("owl")).toBeUndefined();
    expect(isSigilKey("spiral")).toBe(true);
    expect(isSigilKey("snail")).toBe(false);
    expect(isSigilKey(null)).toBe(false);
  });
});

describe("old choices as sigils", () => {
  it("reads each of the twelve critters as its own project sigil", () => {
    const names = PROJECT_MASCOTS.map((mascot) => mascot.name);
    expect(Object.keys(CRITTER_SIGILS).sort()).toEqual([...names].sort());
    // One to one: projects that looked different still do.
    expect(new Set(Object.values(CRITTER_SIGILS)).size).toBe(12);
    expect(new Set(Object.values(CRITTER_SIGILS))).toEqual(
      new Set(PROJECT_SIGILS.map((sigil) => sigil.key)),
    );
    for (const name of names)
      expect(SIGIL_CRITTERS[CRITTER_SIGILS[name]]).toBe(name);
  });

  it("maps a saved pick, an old sprite's name and a sigil key alike", () => {
    expect(projectSigil("snail").key).toBe("spiral");
    expect(projectSigil("owl").key).toBe("eye");
    // "robot" was saved before the critters, and reads as the owl.
    expect(projectSigil("robot").key).toBe("eye");
    expect(projectSigil("spiral").key).toBe("spiral");
  });

  it("gives a project with no pick the sigil of the critter it hashed to", () => {
    for (const folder of ["aven-site", "notes-app", "design-tokens", "x"])
      expect(projectSigil(null, folder).key).toBe(
        CRITTER_SIGILS[projectMascot(folder).name],
      );
    // An unknown saved name falls back to the hash, as a critter's did.
    expect(projectSigil("nope", "aven-site")).toBe(
      projectSigil(null, "aven-site"),
    );
  });

  it("tells apart projects that shared a critter by their colour", () => {
    const auto = (colorIndex: number | null, automaticColorIndex = 0) =>
      appearanceSigil({
        key: "/p",
        mascot: "whale",
        mascotOverride: null,
        colorIndex,
        automaticColorIndex,
      }).key;
    // The palette's nine colours each move the whale's sigil somewhere else.
    const shown = Array.from({ length: 9 }, (_, colour) => auto(null, colour));
    expect(new Set(shown).size).toBe(9);
    expect(auto(null, 0)).toBe("anchor");
    // A colour picked by hand counts as the automatic one did.
    expect(auto(3, 0)).toBe(auto(null, 3));
    // A pick is the mark it picked, whatever the colour.
    expect(
      appearanceSigil({
        key: "/p",
        mascot: "snail",
        mascotOverride: "snail",
        colorIndex: 4,
        automaticColorIndex: 2,
      }).key,
    ).toBe("spiral");
  });

  it("spreads projects with no pick across the sigils", () => {
    const folders = Array.from(
      { length: 40 },
      (_, index) => `project-${index}`,
    );
    const shown = new Set(
      folders.map((folder) => projectSigil(null, folder).key),
    );
    expect(shown.size).toBeGreaterThanOrEqual(8);
  });

  it("draws crew members as their role, and old critters as before", () => {
    expect(crewMemberSigil("builder").key).toBe("builder");
    expect(crewMemberSigil("checker").key).toBe("checker");
    expect(crewMemberSigil("security").key).toBe("security");
    expect(crewMemberSigil("scout").key).toBe("scout");
    // The Fixer is always the Fixer, whatever it holds.
    expect(crewMemberSigil("fixer", "owl").key).toBe("fixer");
    // Critters the ready-made members and roles wore read as their roles.
    expect(crewMemberSigil("builder", "beetle").key).toBe("builder");
    expect(crewMemberSigil("builder", "moth").key).toBe("designer");
    expect(crewMemberSigil("builder", "snail").key).toBe("tester");
    expect(crewMemberSigil("builder", "puffin").key).toBe("scribe");
    // Only on a member of that role: a Builder that wore the hedgehog
    // never shows Security's shield, nor a Checker the moth's Designer.
    expect(crewMemberSigil("security", "hedgehog").key).toBe("security");
    expect(crewMemberSigil("builder", "hedgehog").key).toBe("moon");
    expect(crewMemberSigil("checker", "moth").key).toBe("hourglass");
    // Any other critter reads as its project sigil.
    expect(crewMemberSigil("builder", "whale").key).toBe("anchor");
    // A mark chosen since marks is its own.
    expect(crewMemberSigil("builder", "spiral").key).toBe("spiral");
    expect(crewMemberSigil("checker", "custom").key).toBe("custom");
    // An unknown one falls back to the role's.
    expect(crewMemberSigil("scout", "nope").key).toBe("scout");
  });

  it("offers members every mark but the Fixer's", () => {
    const keys = MEMBER_SIGIL_CHOICES.map((sigil) => sigil.key);
    expect(keys).not.toContain("fixer");
    expect(keys).toContain("custom");
    expect(keys).toContain("spiral");
    expect(keys).toHaveLength(ALL_SIGILS.length - 1);
  });
});

describe("drawing", () => {
  it("draws one round dot per lit cell", () => {
    const tick = litCells(TICK_ROWS);
    expect(tick).toEqual([
      [1, 4],
      [2, 3],
      [3, 0],
      [3, 2],
      [4, 1],
    ]);
    expect(circles(litPath(TICK_ROWS))).toBe(5);
    expect(litPath(TICK_ROWS)).toBe(dotsPath(tick));
    // Round-capped strokes centred in their cells, 20 apart: at 15px
    // (or any multiple of 5) each centre lands on a whole device pixel.
    expect(litPath(TICK_ROWS).split("M").slice(1)).toEqual([
      "90 30h0.01",
      "70 50h0.01",
      "10 70h0.01",
      "50 70h0.01",
      "30 90h0.01",
    ]);
  });

  it("splits a sigil's dots by diagonal for the working sweep", () => {
    const rows = sigilByKey("builder")!.rows;
    const paths = diagonalPaths(litCells(rows));
    expect(paths).toHaveLength(DIAGONALS);
    expect(paths.reduce((sum, path) => sum + circles(path), 0)).toBe(lit(rows));
    // The top-left dot alone starts the sweep.
    expect(circles(paths[0])).toBe(1);
  });

  it("draws dot art one dot per cell", () => {
    expect(circles(dotArtPath(["#.#", ".#."]))).toBe(3);
    expect(dotArtPath(["#"], "#", { dx: 2, dy: 1, size: 0.5 })).toBe(
      "M2.25 1.5a0.25 0.25 0 1 0 0.5 0a0.25 0.25 0 1 0 -0.5 0z",
    );
  });
});
