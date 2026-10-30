import { describe, expect, it } from "vitest";
import {
  PROJECT_MASCOTS,
  currentMascotName,
  isMascotName,
  mascotCellsPath,
  mascotPath,
  projectMascot,
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

describe("projectMascots", () => {
  it("keeps the twelve names in the order their hash picks them", () => {
    expect(PROJECT_MASCOTS.map((mascot) => mascot.name)).toEqual(CAST);
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

  it("knows a critter's name, an older sprite's included", () => {
    expect(isMascotName("owl")).toBe(true);
    expect(isMascotName("robot")).toBe(true);
    expect(isMascotName("builder")).toBe(false);
    expect(isMascotName("")).toBe(false);
  });

  it("merges filled runs into one rect each", () => {
    expect(mascotPath([".##.", "#..#"])).toBe(
      "M1 0h2v1h-2zM0 1h1v1h-1zM3 1h1v1h-1z",
    );
    expect(mascotCellsPath(["#=+"], "=+", 2, 3)).toBe("M3 3h2v1h-2z");
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
