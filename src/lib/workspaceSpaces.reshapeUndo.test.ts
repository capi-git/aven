import { describe, expect, it } from "vitest";
import { leaf, leafIds, type LayoutNode } from "./layout";
import {
  applyWorkspaceIntent,
  workspaceIntentIds,
  type WorkspaceIntent,
} from "./workspaceIntents";
import {
  applyStripView,
  restoreStripSnapshot,
  stripView,
  stripViewReshapes,
  stripViewWith,
  type StripEntry,
  type WorkspaceStrip,
} from "./workspaceSpaces";

const columns = (...ids: string[]): LayoutNode => ({
  type: "split",
  id: `cols-${ids.join("-")}`,
  dir: "right",
  sizes: ids.map(() => 1 / ids.length),
  children: ids.map(leaf),
});
const space = (
  id: string,
  panes: string[],
  groups: Record<string, string[]> = {},
): StripEntry => ({
  kind: "space",
  id,
  view: {
    layout: columns(...panes),
    focusedId: panes[0],
    order: [...new Set([...panes, ...Object.values(groups).flat()])],
    groups: Object.fromEntries(
      panes.map((pane) => [pane, groups[pane] ?? [pane]]),
    ),
  },
});
const item = (id: string): StripEntry => ({ kind: "item", id });
/** Single tabs by id; a split as its panes, each pane's stack joined by +. */
const described = (strip: WorkspaceStrip) =>
  strip.entries.map((entry) =>
    entry.kind === "item"
      ? entry.id
      : `split(${leafIds(entry.view.layout!)
          .map((pane) => entry.view.groups[pane].join("+"))
          .join("|")})`,
  );

/** An intent on the stage, as App applies it to the view in front. */
function apply(strip: WorkspaceStrip, intent: WorkspaceIntent) {
  const { view } = applyWorkspaceIntent(
    stripViewWith(strip, workspaceIntentIds(intent)),
    intent,
  );
  return { view, after: applyStripView(strip, view) };
}

describe("undoing a change on the stage that reshapes the strip", () => {
  it("puts back the split a tab was paired out of", () => {
    const before: WorkspaceStrip = {
      entries: [space("s1", ["a", "b"]), space("s2", ["c", "d"])],
      front: "aven-space:s2",
    };
    const { view, after } = apply(before, {
      type: "pair",
      id: "a",
      target: "c",
    });
    expect(described(after)).toEqual(["b", "split(c|a|d)"]);
    expect(stripViewReshapes(before, view)).toBe(true);
    expect(described(restoreStripSnapshot(after, before))).toEqual([
      "split(a|b)",
      "split(c|d)",
    ]);
  });

  it("puts a single tab dropped on a pane's edge back on the strip", () => {
    const before: WorkspaceStrip = {
      entries: [item("x"), space("s2", ["c", "d"])],
      front: "aven-space:s2",
    };
    const { view, after } = apply(before, {
      type: "drop",
      id: "x",
      target: { id: "d", edge: "right" },
    });
    expect(described(after)).toEqual(["split(c|d|x)"]);
    expect(stripViewReshapes(before, view)).toBe(true);
    const undone = restoreStripSnapshot(after, before);
    expect(described(undone)).toEqual(["x", "split(c|d)"]);
    expect(undone.front).toBe("aven-space:s2");
  });

  it("puts a split back together where it was, its panes' stacks kept", () => {
    const before: WorkspaceStrip = {
      entries: [
        item("y"),
        space("s", ["a", "b"], { a: ["a", "x"] }),
        item("z"),
      ],
      front: "aven-space:s",
    };
    const { view, after } = apply(before, { type: "unsplit", group: "b" });
    expect(described(after)).toEqual(["y", "b", "a", "x", "z"]);
    expect(stripViewReshapes(before, view)).toBe(true);
    const undone = restoreStripSnapshot(after, before);
    expect(described(undone)).toEqual(["y", "split(a+x|b)", "z"]);
    expect(undone.front).toBe("aven-space:s");
  });

  it("leaves a change inside the split in front to the view's own undo", () => {
    const before: WorkspaceStrip = {
      entries: [item("y"), space("s", ["a", "b"], { a: ["a", "x"] })],
      front: "aven-space:s",
    };
    // A tab split off its pane within the same split.
    const { view } = apply(before, {
      type: "split",
      id: "x",
      edge: "down",
      beside: "a",
    });
    expect(stripViewReshapes(before, view)).toBe(false);
    expect(stripViewReshapes(before, stripView(before))).toBe(false);
  });
});
