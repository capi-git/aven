import { describe, expect, it } from "vitest";
import { leaf, type LayoutNode } from "./layout";
import {
  PANE_MIN_PX,
  PANE_RAIL_PX,
  collapseThreshold,
  distributeLengths,
  fitLayout,
  fitShares,
  innerSashBoundary,
  minAlong,
  resizeSash,
  stepSash,
  workspaceTabPaneKind,
  type FitSash,
} from "./paneFit";

type Split = Extract<LayoutNode, { type: "split" }>;
const columns = (
  sizes: number[],
  children: LayoutNode[] = sizes.map((_, i) => leaf(`p${i}`)),
): Split => ({ type: "split", id: "cols", dir: "right", children, sizes });
const minimum = (id: string) => (id.startsWith("chat") ? 240 : 200);
const sash = (layout: LayoutNode, width = 1000, height = 600, index = 0) =>
  fitLayout(layout, width, height, minimum).sashes.find(
    (entry) => entry.index === index,
  )!;
const widths = (layout: LayoutNode, width = 1000) =>
  fitLayout(layout, width, 600, minimum).leaves.map((entry) =>
    Math.round(entry.rect.w),
  );

describe("minimum pane sizes", () => {
  it("gives a chat 240px, a page or file 200px and a terminal 160px", () => {
    expect(PANE_MIN_PX).toEqual({
      chat: 240,
      page: 200,
      file: 200,
      terminal: 160,
    });
  });

  it("shares room by weight while every pane has its minimum", () => {
    expect(
      distributeLengths(1000, [0.5, 0.5], [240, 200], [false, false]),
    ).toEqual({ lengths: [500, 500], adjusted: false });
  });

  it("raises a squeezed pane to its minimum and takes the room from the rest", () => {
    const { lengths, adjusted } = distributeLengths(
      1000,
      [0.1, 0.45, 0.45],
      [240, 200, 200],
      [false, false, false],
    );
    expect(adjusted).toBe(true);
    expect(lengths[0]).toBe(240);
    expect(lengths[1]).toBeCloseTo(380);
    expect(lengths[2]).toBeCloseTo(380);
  });

  it("never squeezes a pane to nothing, even in a window too small for every minimum", () => {
    const { lengths } = distributeLengths(
      300,
      [0.98, 0.01, 0.01],
      [240, 240, 200],
      [false, false, false],
    );
    // Shared by their minimums: each keeps a readable share.
    expect(lengths.map(Math.round)).toEqual([106, 106, 88]);
    expect(lengths.reduce((a, b) => a + b, 0)).toBeCloseTo(300);
  });

  it("holds the minimums as the window narrows", () => {
    const three = columns(
      [0.5, 0.25, 0.25],
      [leaf("chat-a"), leaf("chat-b"), leaf("page")],
    );
    expect(widths(three, 1440)).toEqual([720, 360, 360]);
    // The middle chat would get 225px: it keeps 240, the rest share 660.
    expect(widths(three, 900)).toEqual([440, 240, 220]);
    expect(widths(three, 700)).toEqual([260, 240, 200]);
  });

  it("measures a nested split's minimum by its own panes", () => {
    const column: Split = {
      type: "split",
      id: "column",
      dir: "down",
      children: [leaf("chat-a"), leaf("page")],
      sizes: [0.5, 0.5],
    };
    const row = columns([0.5, 0.5], [leaf("chat-b"), column]);
    // Across: the widest of the column's panes; down: the two stacked.
    expect(minAlong(column, "x", minimum)).toBe(240);
    expect(minAlong(column, "y", minimum)).toBe(440);
    expect(minAlong(row, "x", minimum)).toBe(480);
  });
});

describe("rails", () => {
  it("draws a collapsed pane as a rail of fixed width at any window size", () => {
    const layout = columns(
      [0.03, 0.97],
      [{ ...leaf("chat"), rail: 0.4 }, leaf("page")],
    );
    for (const width of [700, 1000, 2400]) {
      const fit = fitLayout(layout, width, 600, minimum);
      expect(fit.adjusted).toBe(true);
      expect(fit.leaves[0]).toMatchObject({
        id: "chat",
        rail: { owner: "chat", axis: "x" },
      });
      expect(fit.leaves[0].rect.w).toBe(PANE_RAIL_PX);
      expect(fit.leaves[1].rect.w).toBeCloseTo(width - PANE_RAIL_PX);
    }
  });

  it("draws panes collapsed together on one rail, with no dividers inside it", () => {
    const column: Split = {
      type: "split",
      id: "column",
      dir: "down",
      children: [leaf("a"), leaf("b")],
      sizes: [0.5, 0.5],
      rail: 0.5,
    };
    const fit = fitLayout(
      columns([0.97, 0.03], [leaf("main"), column]),
      1000,
      600,
      minimum,
    );
    expect(fit.leaves.slice(1).map((entry) => entry.rail)).toEqual([
      { owner: "column", axis: "x" },
      { owner: "column", axis: "x" },
    ]);
    expect(fit.leaves.slice(1).map((entry) => entry.rect.w)).toEqual([
      PANE_RAIL_PX,
      PANE_RAIL_PX,
    ]);
    expect(fit.sashes.map((entry) => entry.splitId)).toEqual(["cols"]);
  });

  it("gives the stage's shares to a fitted layout, rounded", () => {
    const shares = fitShares(
      fitLayout(
        columns([0.03, 0.97], [{ ...leaf("chat"), rail: 0.4 }, leaf("page")]),
        1000,
        500,
        minimum,
      ),
    );
    expect(shares.get("chat")).toEqual({ x: 0, y: 0, w: 0.028, h: 1 });
    expect(shares.get("page")).toEqual({ x: 0.028, y: 0, w: 0.972, h: 1 });
  });
});

describe("dragging a divider", () => {
  const two = () => columns([0.5, 0.5], [leaf("chat"), leaf("page")]);

  it("moves freely between the minimums", () => {
    const { layout, railed } = resizeSash(two(), sash(two()), 400);
    expect((layout as Split).sizes).toEqual([0.4, 0.6]);
    expect(railed).toEqual({ before: false, after: false });
  });

  it("stops at a pane's minimum until dragged past half of it", () => {
    const stopped = resizeSash(two(), sash(two()), 130);
    expect((stopped.layout as Split).sizes).toEqual([0.24, 0.76]);
    expect(collapseThreshold(240)).toBe(120);
    expect(resizeSash(two(), sash(two()), 121).railed.before).toBe(false);
  });

  it("folds a pane dragged past half its minimum to a rail that keeps its share", () => {
    const { layout, railed } = resizeSash(two(), sash(two()), 119);
    expect(railed).toEqual({ before: true, after: false });
    const split = layout as Split;
    expect(split.children[0]).toEqual({ ...leaf("chat"), rail: 0.5 });
    expect(split.sizes).toEqual([0.028, 0.972]);
    const after = resizeSash(two(), sash(two()), 950);
    expect((after.layout as Split).children[1]).toEqual({
      ...leaf("page"),
      rail: 0.5,
    });
  });

  it("opens a rail dragged back out, at its minimum, and never to 0px", () => {
    const folded = resizeSash(two(), sash(two()), 0).layout;
    const rail = sash(folded);
    expect(rail.railed).toEqual([true, false]);
    // Out past half its minimum: open, held at its 240px.
    const opened = resizeSash(folded, rail, 150).layout as Split;
    expect(opened.children[0].rail).toBeUndefined();
    expect(opened.sizes).toEqual([0.24, 0.76]);
    // Back towards the edge it stays a 28px rail, whatever the pointer.
    const still = resizeSash(folded, rail, -500).layout as Split;
    expect(still.sizes[0]).toBe(0.028);
  });

  it("keeps a rail's share from before the drag when it was folded already", () => {
    const folded = resizeSash(two(), sash(two()), 0).layout;
    const again = resizeSash(folded, sash(folded), 10).layout as Split;
    expect(again.children[0].rail).toBe(0.5);
  });

  it("opens the pane across the divider when the other side folds", () => {
    const layout = columns(
      [0.028, 0.972],
      [leaf("chat"), { ...leaf("page"), rail: 0.3 }],
    );
    const fitted = sash(layout);
    // Both sides as laid out: the page's rail is 28px on the right.
    const next = resizeSash(layout, fitted, 0).layout as Split;
    expect(next.children[0].rail).toBeCloseTo(fitted.lengths[0] / 1000);
    expect(next.children[1].rail).toBeUndefined();
  });
});

describe("the keyboard on a divider", () => {
  const two = () => columns([0.3, 0.7], [leaf("chat"), leaf("page")]);
  const fitted = (layout: LayoutNode): FitSash => sash(layout);

  it("steps, stops at a minimum, then folds on the next press", () => {
    const step = stepSash(two(), fitted(two()), -40).layout as Split;
    expect(step.sizes).toEqual([0.26, 0.74]);
    const atMin = stepSash(step, fitted(step), -40).layout as Split;
    expect(atMin.sizes).toEqual([0.24, 0.76]);
    const folded = stepSash(atMin, fitted(atMin), -40).layout as Split;
    expect(folded.children[0].rail).toBeCloseTo(0.24);
    // Away from the rail it opens at its minimum.
    const opened = stepSash(folded, fitted(folded), 20).layout as Split;
    expect(opened.children[0].rail).toBeUndefined();
    expect(opened.sizes).toEqual([0.24, 0.76]);
  });
});

describe("what a tab's pane needs", () => {
  it("knows a chat, a file and a terminal", () => {
    const chat = {
      layout: leaf("session"),
      editorPanes: [],
      terminalPanes: [],
    };
    const file = {
      layout: leaf("files"),
      editorPanes: [{ id: "files", files: [], activeFileId: "" }],
      terminalPanes: [],
    };
    const terminal = {
      layout: leaf("shell"),
      editorPanes: [],
      terminalPanes: [{ id: "shell", files: [], activeFileId: "" }],
    };
    expect(workspaceTabPaneKind(chat)).toBe("chat");
    expect(workspaceTabPaneKind(file)).toBe("file");
    expect(workspaceTabPaneKind(terminal)).toBe("terminal");
  });
});

describe("a divider inside a tab's own split", () => {
  const at = (pointer: number, zoom = 1) =>
    innerSashBoundary({
      pointer,
      origin: 100,
      span: 1000,
      zoom,
      before: 0,
      after: 1,
      min: 160,
    });

  it("follows the pointer between the panes' minimums", () => {
    expect(at(600)).toBeCloseTo(0.5);
    expect(at(150)).toBeCloseTo(0.16);
    expect(at(1090)).toBeCloseTo(0.84);
  });

  it("keeps the minimum in the tree's own pixels, so it grows with CSS zoom", () => {
    // At 2x, 1000 viewport pixels are 500 of the tree's: 160 is 32%.
    expect(at(150, 2)).toBeCloseTo(0.32);
    expect(at(1090, 2)).toBeCloseTo(0.68);
  });

  it("shares a pair too small for two minimums", () => {
    expect(
      innerSashBoundary({
        pointer: 0,
        origin: 0,
        span: 200,
        before: 0,
        after: 1,
        min: 160,
      }),
    ).toBeCloseTo(0.5);
  });
});
