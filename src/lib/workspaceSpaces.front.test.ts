import { describe, expect, it } from "vitest";
import { leaf, type LayoutNode } from "./layout";
import {
  addStripPane,
  applyStripView,
  combineStripTabs,
  detachStripTab,
  entryFocus,
  entryKey,
  frontEntry,
  insertStripPane,
  joinStripSplit,
  stripView,
  type StripEntry,
  type WorkspaceStrip,
} from "./workspaceSpaces";
import { closeWorkspaceViews, type WorkspaceView } from "./workspaceViews";

const columns = (...ids: string[]): LayoutNode => ({
  type: "split",
  id: `cols-${ids.join("-")}`,
  dir: "right",
  sizes: ids.map(() => 1 / ids.length),
  children: ids.map(leaf),
});
const item = (id: string): StripEntry => ({ kind: "item", id });
const pair = (a: string, b: string): WorkspaceView => ({
  layout: columns(a, b),
  focusedId: a,
  order: [a, b],
  groups: { [a]: [a], [b]: [b] },
});

/** one, then x | y, then two, then a | b; `front` in front. */
function strip(front: string): WorkspaceStrip {
  return {
    entries: [
      item("one"),
      { kind: "space", id: "s1", view: pair("x", "y") },
      item("two"),
      { kind: "space", id: "s2", view: pair("a", "b") },
    ],
    front,
  };
}

/** What is in front after a move, and the tab focused there. */
const shown = (next: WorkspaceStrip) => {
  const entry = frontEntry(next)!;
  return { entry: entryKey(entry), tab: entryFocus(entry) };
};

describe("after a move, what moved is in front", () => {
  // Every move made from a different entry in front.
  it.each(["one", "aven-space:s1", "two"])("with %s in front", (front) => {
    expect(shown(addStripPane(strip(front), "aven-space:s2", "two"))).toEqual({
      entry: "aven-space:s2",
      tab: "two",
    });
    expect(
      shown(insertStripPane(strip(front), "aven-space:s2", "x", "a", "after")),
    ).toEqual({ entry: "aven-space:s2", tab: "x" });
    const combined = combineStripTabs(strip(front), "one", "two");
    expect(shown(combined).tab).toBe("two");
    const joined = joinStripSplit(strip(front), "aven-space:s2", "two");
    expect(shown(joined).entry).toBe("aven-space:s2");
    expect(shown(detachStripTab(strip(front), "y", null))).toEqual({
      entry: "y",
      tab: "y",
    });
  });

  it("leaves a split that came apart, by a close, its tab in front in its place", () => {
    const before = strip("aven-space:s1");
    const after = applyStripView(
      before,
      closeWorkspaceViews(stripView(before), ["y"], "x"),
    );
    expect(after.entries.map(entryKey)).toEqual([
      "one",
      "x",
      "two",
      "aven-space:s2",
    ]);
    expect(shown(after)).toEqual({ entry: "x", tab: "x" });
  });
});
