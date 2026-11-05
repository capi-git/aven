import { describe, expect, it } from "vitest";
import {
  HOPPER_GEOMETRY,
  HOPPER_WATCH,
  botHopperState,
  crewHopperState,
  hopperMemberTone,
  hopperSpot,
  hopperStepDots,
  hopperWatchLoop,
  hopperWatchOffset,
} from "./hopper";

describe("Hopper's steps", () => {
  it("are the logo's staircase, climbing to the top-left", () => {
    const { big, small } = HOPPER_GEOMETRY;
    expect(hopperStepDots(big)).toHaveLength(15);
    expect(hopperStepDots(small)).toHaveLength(6);
    // The top step is one dot at the top-left; the bottom row is the widest.
    const dots = hopperStepDots(big);
    expect(dots[0]).toEqual({ x: big.x0, y: big.y0 });
    expect(Math.max(...dots.map((dot) => dot.x))).toBe(
      big.x0 + (big.steps - 1) * big.cell,
    );
  });

  it("stand the dot above a step, inside the box, on the diagonal", () => {
    for (const geometry of Object.values(HOPPER_GEOMETRY)) {
      const top = hopperSpot(geometry, 0);
      const bottom = hopperSpot(geometry, geometry.steps - 1);
      // Above its step's dot, clear of it.
      expect(geometry.y0 - top.y).toBeGreaterThan(
        geometry.dotRadius + geometry.stepRadius,
      );
      // In the box, even at the top of a hop.
      expect(top.y - geometry.jump - geometry.dotRadius).toBeGreaterThan(-2);
      expect(bottom.x + geometry.dotRadius).toBeLessThanOrEqual(64);
      // Every spot on one 45° line, so a hop is the same move each time.
      expect(bottom.x - top.x).toBeCloseTo(bottom.y - top.y);
    }
  });
});

describe("watching", () => {
  it("visits every dot of the steps once, hopping only to a neighbour", () => {
    for (const size of ["big", "small"] as const) {
      const { steps } = HOPPER_GEOMETRY[size];
      const path = HOPPER_WATCH.path[size];
      const cells = new Set(path.map(([column, row]) => `${column},${row}`));
      expect(cells.size).toBe((steps * (steps + 1)) / 2);
      for (const [column, row] of path) {
        // Inside the steps: row r has dots in columns 0 to r.
        expect(column).toBeGreaterThanOrEqual(0);
        expect(column).toBeLessThanOrEqual(row);
        expect(row).toBeLessThan(steps);
      }
      path.forEach(([column, row], index) => {
        const [nextColumn, nextRow] = path[(index + 1) % path.length];
        expect(Math.abs(nextColumn - column)).toBeLessThanOrEqual(1);
        expect(Math.abs(nextRow - row)).toBeLessThanOrEqual(1);
      });
      // It starts, and rests with reduced motion, on the bottom-left dot.
      expect(path[0]).toEqual([0, steps - 1]);
    }
    expect(HOPPER_WATCH.pauses.length).toBe(HOPPER_WATCH.path.big.length);
    expect(hopperWatchLoop("big")).toBe(18.7);
    expect(hopperWatchLoop("small")).toBe(7.72);
  });

  it("starts each helper somewhere else in the loop, Avos at the start", () => {
    expect(hopperWatchOffset("lead")).toBe(0);
    const offsets = [
      "builder",
      "checker",
      "researcher",
      "designer",
      "security",
      "scout",
      "fixer",
    ].map(hopperWatchOffset);
    expect(new Set([0, ...offsets]).size).toBe(offsets.length + 1);
    expect(hopperWatchOffset(undefined)).toBe(0);
  });
});

describe("a member's state", () => {
  it("needs you over working, working over watching, then rests", () => {
    expect(crewHopperState("needs-you", true)).toBe("needs");
    expect(crewHopperState("working", false)).toBe("working");
    expect(crewHopperState(undefined, true)).toBe("working");
    expect(crewHopperState("watching", false)).toBe("watching");
    expect(crewHopperState("ready", false)).toBe("resting");
    expect(crewHopperState(undefined, false, "still")).toBe("still");
  });

  it("holds still while switched off", () => {
    expect(crewHopperState("paused", false)).toBe("still");
  });
});

describe("a bot's state", () => {
  it("follows its word", () => {
    expect(botHopperState("watching")).toBe("watching");
    expect(botHopperState("working")).toBe("working");
    expect(botHopperState("needs-you")).toBe("needs");
    expect(botHopperState("fix-ready")).toBe("resting");
    expect(botHopperState("paused")).toBe("still");
    expect(botHopperState(undefined)).toBe("resting");
  });
});

describe("a member's colour", () => {
  it("is the project's for Avos and the Fixer, the role's for the rest", () => {
    expect(hopperMemberTone("lead", null, "green")).toBe("green");
    expect(hopperMemberTone("fixer", null, "teal")).toBe("teal");
    expect(hopperMemberTone("builder", null, "green")).toBe("blue");
    expect(hopperMemberTone("checker", null, "green")).toBe("purple");
    // A Tester chosen before Hopper keeps its job's colour.
    expect(hopperMemberTone("builder", "tester", "green")).toBe("orange");
  });

  it("never says what's happening", () => {
    for (const role of ["builder", "checker", "security", "scout", "designer"])
      expect(["yellow", "green", "red"]).not.toContain(
        hopperMemberTone(role, null, "grey"),
      );
  });
});
