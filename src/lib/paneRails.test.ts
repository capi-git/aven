import { describe, expect, it } from "vitest";
import {
  leaf,
  movePane,
  removePane,
  replaceLeafId,
  type LayoutNode,
} from "./layout";
import {
  evenSplit,
  healRails,
  nearestOpenLeaf,
  openLeafIds,
  railSide,
  railedLeafIds,
  restoreRail,
  unrailLeaf,
} from "./paneRails";
import {
  closeWorkspaceViews,
  pruneViewLayout,
  resolveWorkspaceView,
  selectWorkspaceView,
  splitWorkspaceView,
  swapWorkspacePanes,
  withOpenFocus,
  type WorkspaceView,
} from "./workspaceViews";

type Split = Extract<LayoutNode, { type: "split" }>;
const split = (
  id: string,
  dir: "right" | "down",
  children: LayoutNode[],
  sizes: number[],
  rail?: number,
): Split => ({
  type: "split",
  id,
  dir,
  children,
  sizes,
  ...(rail !== undefined ? { rail } : {}),
});
const railed = (id: string, rail: number): LayoutNode => ({
  ...leaf(id),
  rail,
});

describe("which panes are on rails", () => {
  it("names leaves on a rail, alone or collapsed together", () => {
    const layout = split(
      "row",
      "right",
      [
        railed("a", 0.3),
        leaf("b"),
        split("column", "down", [leaf("c"), leaf("d")], [0.5, 0.5], 0.2),
      ],
      [0.03, 0.94, 0.03],
    );
    expect(railedLeafIds(layout)).toEqual(["a", "c", "d"]);
    expect(openLeafIds(layout)).toEqual(["b"]);
    // A lone pane is never on a rail.
    expect(railedLeafIds(railed("a", 0.3))).toEqual([]);
    expect(openLeafIds(railed("a", 0.3))).toEqual(["a"]);
  });
});

describe("healing collapsed panes", () => {
  it("keeps one pane of every split open and the arrangement itself open", () => {
    const healed = healRails({
      ...split(
        "row",
        "right",
        [railed("a", 0.3), railed("b", 0.6)],
        [0.5, 0.5],
      ),
      rail: 0.4,
    }) as Split;
    expect(healed.rail).toBeUndefined();
    // The pane that had the most room opens.
    expect(healed.children[0].rail).toBe(0.3);
    expect(healed.children[1].rail).toBeUndefined();
  });

  it("gives a stored rail with no real share one", () => {
    const healed = healRails(
      split("row", "right", [leaf("a"), railed("b", 7)], [0.97, 0.03]),
    ) as Split;
    expect(healed.children[1].rail).toBe(0.5);
  });

  it("is kept through storage, and healed there", () => {
    const stored = JSON.parse(
      JSON.stringify(
        split("row", "right", [railed("a", 0.3), railed("b", 0.4)], [0.5, 0.5]),
      ),
    );
    const pruned = pruneViewLayout(stored, new Set(["a", "b"])) as Split;
    expect(pruned.children[0].rail).toBe(0.3);
    expect(pruned.children[1].rail).toBeUndefined();
  });
});

describe("opening a rail", () => {
  it("gives back its share, taken from the pane across its divider", () => {
    const layout = split(
      "row",
      "right",
      [railed("a", 0.33), leaf("b"), leaf("c")],
      [0.02, 0.65, 0.33],
    );
    const opened = restoreRail(layout, "a") as Split;
    expect(opened.children[0].rail).toBeUndefined();
    expect(opened.sizes[0]).toBeCloseTo(0.33);
    expect(opened.sizes[1]).toBeCloseTo(0.34);
    expect(opened.sizes[2]).toBeCloseTo(0.33);
  });

  it("takes from every open pane when its neighbours have too little", () => {
    const layout = split(
      "row",
      "right",
      [railed("a", 0.5), leaf("b"), leaf("c")],
      [0.02, 0.1, 0.88],
    );
    const opened = restoreRail(layout, "a") as Split;
    expect(opened.sizes[0]).toBeCloseTo(0.5);
    expect(opened.sizes[1]).toBeCloseTo(0.08);
    expect(opened.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("opens every rail on the way to a selected tab", () => {
    const layout = split(
      "row",
      "right",
      [
        leaf("main"),
        split(
          "column",
          "down",
          [leaf("c"), railed("d", 0.5)],
          [0.97, 0.03],
          0.4,
        ),
      ],
      [0.97, 0.03],
    );
    const opened = unrailLeaf(layout, "d") as Split;
    expect(railedLeafIds(opened)).toEqual([]);
    expect(opened.sizes[1]).toBeCloseTo(0.4);
    expect((opened.children[1] as Split).sizes[1]).toBeCloseTo(0.5);
  });
});

describe("collapsing from a pane's menu", () => {
  it("gives the room to the pane across the divider and keeps the share", () => {
    const layout = split(
      "row",
      "right",
      [leaf("a"), leaf("b"), leaf("c")],
      [0.3, 0.3, 0.4],
    );
    const next = railSide(layout, "row", 1, "after") as Split;
    expect(next.children[2].rail).toBeCloseTo(0.4);
    expect(next.sizes[0]).toBeCloseTo(0.3);
    expect(next.sizes[1]).toBeCloseTo(0.68);
    expect(next.sizes[2]).toBeCloseTo(0.02);
    // Collapsing the last open pane does nothing.
    const two = railSide(
      split("row", "right", [leaf("a"), railed("b", 0.4)], [0.98, 0.02]),
      "row",
      0,
      "before",
    );
    expect(railedLeafIds(two)).toEqual(["b"]);
  });

  it("evens out a split, opening its rails", () => {
    const even = evenSplit(
      split(
        "row",
        "right",
        [railed("a", 0.3), leaf("b"), leaf("c")],
        [0.02, 0.6, 0.38],
      ),
      "row",
    ) as Split;
    expect(even.sizes).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(railedLeafIds(even)).toEqual([]);
  });
});

describe("rails through the arrangement's other changes", () => {
  const view = (): WorkspaceView =>
    resolveWorkspaceView(
      {
        layout: split(
          "row",
          "right",
          [railed("a", 0.4), leaf("b")],
          [0.03, 0.97],
        ),
        focusedId: "b",
        order: ["a", "a2", "b"],
        groups: { a: ["a", "a2"], b: ["b"] },
      },
      ["a", "a2", "b"],
      "b",
    );

  it("stays collapsed when the tab in front of it changes", () => {
    const layout = replaceLeafId(view().layout!, "a", "a2") as Split;
    expect(layout.children[0]).toEqual(railed("a2", 0.4));
  });

  it("opens when one of its tabs is selected", () => {
    const next = selectWorkspaceView(view(), "a2");
    expect(next.focusedId).toBe("a2");
    expect(railedLeafIds(next.layout)).toEqual([]);
    expect((next.layout as Split).sizes[0]).toBeCloseTo(0.4);
  });

  it("moves focus off a collapsed pane to the open one nearest", () => {
    expect(withOpenFocus({ ...view(), focusedId: "a" }).focusedId).toBe("b");
    expect(nearestOpenLeaf(view().layout, "a")).toBe("b");
  });

  it("travels with its pane in a Move", () => {
    const swapped = swapWorkspacePanes(view(), "a", "b").layout as Split;
    expect(swapped.children[0]).toEqual(leaf("b"));
    expect(swapped.children[1]).toEqual(railed("a", 0.4));
  });

  it("opens a pane moved beside it, and the moved pane is never collapsed", () => {
    const three = split(
      "row",
      "right",
      [railed("a", 0.4), leaf("b"), leaf("c")],
      [0.03, 0.5, 0.47],
    );
    const moved = movePane(three, "c", "a", "bottom");
    expect(railedLeafIds(moved)).toEqual([]);
  });

  it("passes a split's rail to the pane left when the other closes", () => {
    const layout = split(
      "row",
      "right",
      [
        leaf("main"),
        split(
          "column",
          "down",
          [leaf("c"), railed("d", 0.5)],
          [0.97, 0.03],
          0.4,
        ),
      ],
      [0.97, 0.03],
    );
    const next = removePane(layout, "d") as Split;
    // The column's rail (along the row) is c's now; d's own is gone with it.
    expect(next.children[1]).toEqual(railed("c", 0.4));
    const opened = removePane(layout, "c") as Split;
    expect(opened.children[1]).toEqual(railed("d", 0.4));
  });
});

describe("a split never stands with every pane collapsed", () => {
  // One open pane beside two rails, as a person might leave it.
  const view = (): WorkspaceView => ({
    layout: split(
      "row",
      "right",
      [leaf("A"), railed("B", 0.3), railed("C", 0.3)],
      [0.9, 0.05, 0.05],
    ),
    focusedId: "A",
    order: ["A", "B", "C"],
    groups: { A: ["A"], B: ["B"], C: ["C"] },
  });

  it("opens a rail when the open pane's tab is gone, read back or closed", () => {
    // Its tab gone from the tabs open (closed elsewhere, or across a restart).
    for (const next of [
      resolveWorkspaceView(view(), ["B", "C"], "A"),
      resolveWorkspaceView(JSON.parse(JSON.stringify(view())), ["B", "C"], "A"),
      closeWorkspaceViews(view(), ["A"], "A"),
    ]) {
      expect(openLeafIds(next.layout)).toHaveLength(1);
      expect(railedLeafIds(next.layout)).toHaveLength(1);
      // Focus is on the pane that opened.
      expect(openLeafIds(next.layout)).toContain(next.focusedId);
    }
  });

  it("opens a rail when the open pane is removed or moved away", () => {
    const layout = view().layout!;
    const removed = removePane(layout, "A")!;
    expect(openLeafIds(removed)).toHaveLength(1);
    // The open pane moved into a column beside a rail: the rails left
    // behind in its split keep one open.
    const nested = split(
      "row",
      "right",
      [
        split("column", "down", [leaf("A"), railed("B", 0.4)], [0.95, 0.05]),
        leaf("D"),
      ],
      [0.5, 0.5],
    );
    const moved = movePane(nested, "A", "D", "right");
    for (const node of [moved]) {
      const column = (node as Split).children.find(
        (child) => child.type === "split" && child.id === "column",
      );
      if (column) expect(railedLeafIds(column)).toEqual([]);
    }
    expect(openLeafIds(moved)).toEqual(expect.arrayContaining(["A", "D"]));
  });

  it("moves focus off a pane that is now collapsed when a tab leaves its split", () => {
    const next = splitWorkspaceView(
      {
        ...view(),
        groups: { A: ["A", "x"], B: ["B"], C: ["C"] },
        order: ["A", "x", "B", "C"],
      },
      "A",
      "right",
      "x",
    );
    expect(openLeafIds(next.layout)).toContain(next.focusedId);
  });
});
