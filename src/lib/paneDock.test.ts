import { describe, expect, it } from "vitest";
import {
  DOCK_EASE,
  DOCK_TWEEN_MS,
  dockClip,
  dockOverlap,
  dockPreview,
  dockZone,
  seamNeighbours,
  stepPane,
} from "./paneDock";

const pane = { left: 100, top: 50, width: 400, height: 200 };

describe("pane docking", () => {
  it("uses Cydonia's timing", () => {
    expect(DOCK_TWEEN_MS).toBe(150);
    expect(DOCK_EASE).toBe("cubic-bezier(0, 0, 0.58, 1)");
  });

  describe("zones", () => {
    it("splits within a quarter of an edge and stacks further in", () => {
      expect(dockZone(pane, 110, 150)).toBe("left");
      expect(dockZone(pane, 490, 150)).toBe("right");
      expect(dockZone(pane, 300, 60)).toBe("up");
      expect(dockZone(pane, 300, 240)).toBe("down");
      expect(dockZone(pane, 300, 150)).toBe("join");
      // 24% from the left splits; 26% stacks.
      expect(dockZone(pane, 196, 150)).toBe("left");
      expect(dockZone(pane, 204, 150)).toBe("join");
    });

    it("measures as a share of the pane, so a corner picks the nearer edge", () => {
      // 5% across, 10% down: the left edge is nearer.
      expect(dockZone(pane, 120, 70)).toBe("left");
      // 20% across, 5% down: the top edge is nearer.
      expect(dockZone(pane, 180, 60)).toBe("up");
    });

    it("is nothing outside the pane or for an empty one", () => {
      expect(dockZone(pane, 90, 150)).toBeNull();
      expect(dockZone(pane, 300, 260)).toBeNull();
      expect(dockZone({ ...pane, width: 0 }, 100, 150)).toBeNull();
    });

    it("holds what it shows while the pointer rests on the line", () => {
      // 26% from the left: past the line, but held from "left".
      expect(dockZone(pane, 204, 150, "left")).toBe("left");
      expect(dockZone(pane, 212, 150, "left")).toBe("join");
      // 24% from the left: inside the line, but held from "join".
      expect(dockZone(pane, 196, 150, "join")).toBe("join");
      expect(dockZone(pane, 188, 150, "join")).toBe("left");
    });
  });

  describe("preview", () => {
    it("is that half of the pane inset 4px, or all of it to stack", () => {
      expect(dockPreview(pane, "left")).toEqual({
        left: 104,
        top: 54,
        width: 192,
        height: 192,
      });
      expect(dockPreview(pane, "right")).toEqual({
        left: 304,
        top: 54,
        width: 192,
        height: 192,
      });
      expect(dockPreview(pane, "down")).toEqual({
        left: 104,
        top: 154,
        width: 392,
        height: 92,
      });
      expect(dockPreview(pane, "join")).toEqual({
        left: 104,
        top: 54,
        width: 392,
        height: 192,
      });
    });

    it("insets a tiny pane less than 4px", () => {
      expect(
        dockPreview({ left: 0, top: 0, width: 10, height: 6 }, "up"),
      ).toEqual({ left: 1.5, top: 1.5, width: 7, height: 0 });
    });
  });

  it("clips an arriving pane to the preview with its corners", () => {
    const to = { left: 300, top: 50, width: 200, height: 200 };
    expect(dockClip(dockPreview(pane, "right"), to)).toBe(
      "inset(4px 4px 4px 4px round 6px)",
    );
    // Its title row, above the preview, starts hidden.
    expect(
      dockClip(dockPreview(pane, "down"), {
        left: 100,
        top: 120,
        width: 400,
        height: 32,
      }),
    ).toBe("inset(32px 4px 0px 4px round 6px)");
  });

  it("measures how much two boxes share", () => {
    expect(dockOverlap(pane, pane)).toBe(1);
    expect(
      dockOverlap(pane, { left: 300, top: 50, width: 200, height: 200 }),
    ).toBeCloseTo(0.5);
    expect(
      dockOverlap(pane, { left: 600, top: 0, width: 10, height: 10 }),
    ).toBe(0);
  });

  describe("panes across a seam", () => {
    // a | b over c, with d in the right column below b.
    const leaves = [
      { id: "a", rect: { x: 0, y: 0, w: 0.5, h: 1 } },
      { id: "b", rect: { x: 0.5, y: 0, w: 0.5, h: 0.4 } },
      { id: "d", rect: { x: 0.5, y: 0.4, w: 0.5, h: 0.6 } },
    ];

    it("finds the pane sharing most of each seam", () => {
      expect(seamNeighbours(leaves, "a")).toEqual({ right: "d" });
      expect(seamNeighbours(leaves, "b")).toEqual({ left: "a", down: "d" });
      expect(seamNeighbours(leaves, "d")).toEqual({ left: "a", up: "b" });
      expect(seamNeighbours(leaves, "missing")).toEqual({});
    });

    it("walks panes in layout order, wrapping", () => {
      const order = ["a", "b", "d"];
      expect(stepPane(order, "a", 1)).toBe("b");
      expect(stepPane(order, "d", 1)).toBe("a");
      expect(stepPane(order, "a", -1)).toBe("d");
      expect(stepPane(order, "unknown", 1)).toBe("a");
      expect(stepPane(order, "unknown", -1)).toBe("d");
      expect(stepPane(["a"], "a", 1)).toBeNull();
    });
  });
});
