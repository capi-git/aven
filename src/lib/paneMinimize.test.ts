import { describe, expect, it } from "vitest";
import type { LayoutNode } from "./layout";
import {
  paneCollapseItems,
  paneMinimizeControls,
  paneMinimizeKey,
  paneMinimizeLabel,
} from "./paneMinimize";
import { railedLeafIds } from "./paneRails";
import { railWorkspaceSide } from "./workspaceViews";

const leaf = (id: string): LayoutNode => ({ type: "leaf", id });

describe("hiding a pane beside its divider", () => {
  it("is offered by each pane for its own side", () => {
    const layout: LayoutNode = {
      type: "split",
      id: "root",
      dir: "right",
      children: [leaf("left"), leaf("right")],
      sizes: [0.5, 0.5],
    };
    const controls = paneMinimizeControls(layout);
    expect(controls.get("left")?.map(paneMinimizeLabel)).toEqual([
      "Collapse left pane",
    ]);
    expect(controls.get("right")?.map(paneMinimizeLabel)).toEqual([
      "Collapse right pane",
    ]);
    expect(controls.get("left")?.map(paneMinimizeKey)).toEqual([
      "root:0:before",
    ]);
  });

  it("names upper and lower panes, and offers nothing for a single pane", () => {
    const layout: LayoutNode = {
      type: "split",
      id: "rows",
      dir: "down",
      children: [leaf("top"), leaf("bottom")],
      sizes: [0.5, 0.5],
    };
    const controls = paneMinimizeControls(layout);
    expect(controls.get("top")?.map(paneMinimizeLabel)).toEqual([
      "Collapse upper pane",
    ]);
    expect(controls.get("bottom")?.map(paneMinimizeLabel)).toEqual([
      "Collapse lower pane",
    ]);
    expect(paneMinimizeControls(leaf("only")).size).toBe(0);
    expect(paneMinimizeControls(null).size).toBe(0);
  });
});

describe("collapsing from a pane's own menu", () => {
  const split = (
    id: string,
    dir: "right" | "down",
    children: LayoutNode[],
  ): LayoutNode => ({
    type: "split",
    id,
    dir,
    children,
    sizes: children.map(() => 1 / children.length),
  });
  /** What each choice in a pane's menu collapses. */
  const outcomes = (layout: LayoutNode, owner: string) =>
    (paneCollapseItems(layout).get(owner) ?? []).map((item) => {
      const ids = (function all(node: LayoutNode): string[] {
        return node.type === "leaf" ? [node.id] : node.children.flatMap(all);
      })(layout);
      const view = railWorkspaceSide(
        {
          layout,
          focusedId: owner,
          order: ids,
          groups: Object.fromEntries(ids.map((id) => [id, [id]])),
        },
        item.split,
        item.index,
        item.side,
      );
      return `${item.label}: ${railedLeafIds(view.layout).join(",")}`;
    });

  it("offers each pane one Collapse pane, which collapses that pane", () => {
    const row = split("row", "right", [leaf("a"), leaf("b"), leaf("c")]);
    expect(outcomes(row, "a")).toEqual(["Collapse pane: a"]);
    // The middle pane: once, not "left" and "right" both folding it.
    expect(outcomes(row, "b")).toEqual(["Collapse pane: b"]);
    expect(outcomes(row, "c")).toEqual(["Collapse pane: c"]);
  });

  it("names a column or row that collapses whole", () => {
    const layout = split("row", "right", [
      leaf("a"),
      split("column", "down", [leaf("b"), leaf("c")]),
    ]);
    expect(outcomes(layout, "b")).toEqual([
      "Collapse pane: b",
      "Collapse column: b,c",
    ]);
    expect(outcomes(layout, "c")).toEqual([
      "Collapse pane: c",
      "Collapse column: b,c",
    ]);
    const rows = split("rows", "down", [
      split("top", "right", [leaf("a"), leaf("b")]),
      leaf("c"),
    ]);
    expect(outcomes(rows, "a")).toEqual([
      "Collapse pane: a",
      "Collapse row: a,b",
    ]);
  });

  it("offers nothing that would do nothing", () => {
    // Beside a collapsed pane, the only one open cannot collapse.
    const beside: LayoutNode = {
      type: "split",
      id: "row",
      dir: "right",
      children: [{ ...leaf("a"), rail: 0.5 }, leaf("b")],
      sizes: [0.04, 0.96],
    };
    expect(paneCollapseItems(beside).get("b")).toBeUndefined();
    expect(paneCollapseItems(beside).get("a")).toBeUndefined();
    expect(paneCollapseItems(leaf("alone")).size).toBe(0);
    expect(paneCollapseItems(null).size).toBe(0);
  });
});
