import { describe, expect, it } from "vitest";
import type { LayoutNode } from "./layout";
import {
  paneMinimizeControls,
  paneMinimizeKey,
  paneMinimizeLabel,
} from "./paneMinimize";

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
