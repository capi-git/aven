import { describe, expect, it } from "vitest";
import { leaf, leafIds, type LayoutNode } from "./layout";
import {
  applyWorkspaceIntent,
  hiddenSplitStatus,
  neighborCombineTargets,
  pageShortcutOutcome,
} from "./workspaceIntents";
import { resolveWorkspaceView, type WorkspaceView } from "./workspaceViews";

const ids = ["chat-a", "browser-a", "chat-b", "browser-b", "chat-c"];
const columns: LayoutNode = {
  type: "split",
  id: "columns",
  dir: "right",
  sizes: [0.4, 0.6],
  children: [leaf("chat-a"), leaf("chat-b")],
};
function grouped(): WorkspaceView {
  return resolveWorkspaceView(
    {
      layout: columns,
      focusedId: "chat-a",
      order: ids,
      groups: {
        "chat-a": ["chat-a", "browser-a"],
        "chat-b": ["chat-b", "browser-b", "chat-c"],
      },
    },
    ids,
    "chat-a",
  );
}

describe("applyWorkspaceIntent", () => {
  it("moves a tab dropped on a strip into that pane and keeps its page", () => {
    const { view, keep } = applyWorkspaceIntent(grouped(), {
      type: "drop",
      id: "browser-a",
      target: { id: "chat-b", edge: "tab", index: 1 },
    });
    expect(view.groups["chat-a"]).toEqual(["chat-a"]);
    expect(view.groups["chat-b"]).toEqual([
      "chat-b",
      "browser-a",
      "browser-b",
      "chat-c",
    ]);
    expect(view.focusedId).toBe("chat-b");
    expect(keep).toEqual(["browser-a"]);
  });

  it("places a strip drop by full group position when hidden tabs precede the slot", () => {
    const { view } = applyWorkspaceIntent(grouped(), {
      type: "drop",
      id: "browser-a",
      target: { id: "chat-b", edge: "tab", index: 1, orderIndex: 3 },
    });
    expect(view.groups["chat-b"]).toEqual([
      "chat-b",
      "browser-b",
      "chat-c",
      "browser-a",
    ]);
  });

  it("splits a tab dropped on a pane edge beside that pane and keeps its page", () => {
    const { view, keep } = applyWorkspaceIntent(grouped(), {
      type: "drop",
      id: "browser-b",
      target: { id: "chat-a", edge: "down" },
    });
    expect(leafIds(view.layout!)).toEqual(["chat-a", "browser-b", "chat-b"]);
    expect(view.groups["browser-b"]).toEqual(["browser-b"]);
    expect(view.groups["chat-b"]).toEqual(["chat-b", "chat-c"]);
    expect(view.focusedId).toBe("browser-b");
    expect(keep).toEqual(["browser-b"]);
  });

  it("splits from a menu the same way without keeping the page", () => {
    const dropped = applyWorkspaceIntent(grouped(), {
      type: "drop",
      id: "browser-b",
      target: { id: "chat-a", edge: "down" },
    });
    const split = applyWorkspaceIntent(grouped(), {
      type: "split",
      id: "browser-b",
      edge: "down",
      beside: "chat-a",
    });
    // New splits get fresh ids; everything else must match.
    expect(leafIds(split.view.layout!)).toEqual(leafIds(dropped.view.layout!));
    expect({ ...split.view, layout: null }).toEqual({
      ...dropped.view,
      layout: null,
    });
    expect(split.keep).toEqual([]);
  });

  it("splits beside the focused pane when no pane is named", () => {
    const { view } = applyWorkspaceIntent(grouped(), {
      type: "split",
      id: "browser-b",
      edge: "right",
    });
    expect(leafIds(view.layout!)).toEqual(["chat-a", "browser-b", "chat-b"]);
  });

  it("reorders one pane's tabs and the matching slots of the global order", () => {
    const { view, keep } = applyWorkspaceIntent(grouped(), {
      type: "reorder",
      group: "chat-b",
      ids: ["chat-c", "chat-b", "browser-b"],
    });
    expect(view.groups["chat-b"]).toEqual(["chat-c", "chat-b", "browser-b"]);
    expect(view.order).toEqual([
      "chat-a",
      "browser-a",
      "chat-c",
      "chat-b",
      "browser-b",
    ]);
    expect(keep).toEqual([]);
  });

  it("combines two panes and keeps both selected pages", () => {
    const { view, keep } = applyWorkspaceIntent(grouped(), {
      type: "combine",
      group: "chat-a",
      into: "chat-b",
    });
    expect(view.layout).toEqual(leaf("chat-b"));
    expect(view.groups).toEqual({
      "chat-b": ["chat-b", "browser-b", "chat-c", "chat-a", "browser-a"],
    });
    expect(keep).toEqual(["chat-a", "chat-b"]);
  });

  it("returns to one pane and keeps every page that was showing", () => {
    const { view, keep } = applyWorkspaceIntent(grouped(), {
      type: "unsplit",
      group: "chat-b",
    });
    expect(view.layout).toEqual(leaf("chat-b"));
    expect(view.groups["chat-b"]).toHaveLength(ids.length);
    expect(keep).toEqual(["chat-a", "chat-b"]);
  });

  it("collapses a side to a rail beside the others, and opens it again", () => {
    const before = grouped();
    const collapsed = applyWorkspaceIntent(before, {
      type: "minimize",
      split: "columns",
      index: 0,
      side: "after",
    });
    // Both panes stay in the arrangement; the right one is on a rail that
    // remembers its share, and the left takes its room.
    expect(leafIds(collapsed.view.layout!)).toEqual(["chat-a", "chat-b"]);
    expect(collapsed.view.hiddenGroups).toBeUndefined();
    const layout = collapsed.view.layout as Extract<
      LayoutNode,
      { type: "split" }
    >;
    expect(layout.children[1].rail).toBeCloseTo(0.6);
    expect(layout.sizes[0]).toBeGreaterThan(0.95);
    expect(collapsed.view.groups).toEqual(before.groups);
    expect(collapsed.keep).toEqual([]);
    // Focus was on the open pane and stays there.
    expect(collapsed.view.focusedId).toBe("chat-a");
    const opened = applyWorkspaceIntent(collapsed.view, {
      type: "unrail",
      id: "browser-b",
    });
    const reopened = opened.view.layout as Extract<
      LayoutNode,
      { type: "split" }
    >;
    expect(reopened.children[1].rail).toBeUndefined();
    expect(reopened.sizes[0]).toBeCloseTo(0.4);
    expect(reopened.sizes[1]).toBeCloseTo(0.6);
    // Opening it by a tab behind its front shows that tab, focused.
    expect(opened.view.focusedId).toBe("browser-b");
    expect(opened.view.groups["browser-b"]).toEqual([
      "chat-b",
      "browser-b",
      "chat-c",
    ]);
  });

  it("moves focus off a pane a divider folds to a rail", () => {
    const before = { ...grouped(), focusedId: "chat-b" };
    const layout: LayoutNode = {
      ...columns,
      sizes: [0.97, 0.03],
      children: [leaf("chat-a"), { ...leaf("chat-b"), rail: 0.6 }],
    };
    const { view } = applyWorkspaceIntent(before, { type: "resize", layout });
    expect(view.layout).toEqual(layout);
    expect(view.focusedId).toBe("chat-a");
  });

  it("replaces only the layout when panes are resized", () => {
    const before = grouped();
    const layout = { ...columns, sizes: [0.7, 0.3] };
    const { view, keep } = applyWorkspaceIntent(before, {
      type: "resize",
      layout,
    });
    expect(view).toEqual({ ...before, layout });
    expect(keep).toEqual([]);
  });
});

describe("neighborCombineTargets", () => {
  it("lists adjacent panes by direction", () => {
    expect(neighborCombineTargets(grouped(), "chat-a")).toEqual([
      { id: "chat-b", label: "right pane" },
    ]);
    const rows = resolveWorkspaceView(
      {
        layout: {
          type: "split",
          id: "rows",
          dir: "down",
          sizes: [0.5, 0.5],
          children: [columns, leaf("chat-c")],
        },
        focusedId: "chat-c",
        order: ["chat-a", "chat-b", "chat-c"],
        groups: {
          "chat-a": ["chat-a"],
          "chat-b": ["chat-b"],
          "chat-c": ["chat-c"],
        },
      },
      ["chat-a", "chat-b", "chat-c"],
      "chat-c",
    );
    expect(neighborCombineTargets(rows, "chat-b")).toEqual([
      { id: "chat-a", label: "left pane" },
      { id: "chat-c", label: "pane below" },
    ]);
  });

  it("offers nothing without a split", () => {
    const single = applyWorkspaceIntent(grouped(), {
      type: "unsplit",
      group: "chat-a",
    }).view;
    expect(neighborCombineTargets(single, "chat-a")).toEqual([]);
  });
});

describe("hiddenSplitStatus", () => {
  // Tucked away by an earlier Aven's minimize, restored from storage.
  const minimized = () =>
    resolveWorkspaceView(
      {
        layout: leaf("chat-a"),
        focusedId: "chat-a",
        order: ids,
        groups: { "chat-a": ["chat-a", "browser-a"] },
        hiddenGroups: { "chat-b": ["chat-b", "browser-b", "chat-c"] },
        restoreView: grouped(),
        minimizedEdge: "right",
      },
      ids,
      "chat-a",
    );
  const tab = (id: string, busy = false, needsInput = false) => ({
    id,
    needsInput,
    busyHarnesses: busy ? (["codex"] as const).slice() : [],
  });

  it("reports tucked-away tabs that need input before busy ones", () => {
    expect(
      hiddenSplitStatus(minimized(), [
        tab("chat-b", true),
        tab("chat-c", false, true),
      ]),
    ).toBe("attention");
    expect(hiddenSplitStatus(minimized(), [tab("chat-c", true)])).toBe(
      "working",
    );
  });

  it("ignores tabs that are still showing", () => {
    expect(
      hiddenSplitStatus(minimized(), [tab("chat-a", true, true)]),
    ).toBeUndefined();
    expect(
      hiddenSplitStatus(grouped(), [tab("chat-b", true, true)]),
    ).toBeUndefined();
  });
});

describe("Cydonia's pane moves", () => {
  it("swaps a pane across its seam, keeping each pane's tabs, sizes and focus", () => {
    const before = grouped();
    const { view, keep } = applyWorkspaceIntent(before, {
      type: "swap",
      group: "chat-a",
      with: "chat-b",
    });
    expect(keep).toEqual([]);
    expect(view.layout).toEqual({
      ...columns,
      children: [leaf("chat-b"), leaf("chat-a")],
    });
    expect(view.groups).toEqual(before.groups);
    expect(view.focusedId).toBe("chat-a");
  });

  it("ignores a swap with itself or a pane that is not shown", () => {
    const before = grouped();
    expect(
      applyWorkspaceIntent(before, {
        type: "swap",
        group: "chat-a",
        with: "chat-a",
      }).view,
    ).toBe(before);
    expect(
      applyWorkspaceIntent(before, {
        type: "swap",
        group: "chat-a",
        with: "browser-b",
      }).view,
    ).toBe(before);
  });

  it("zooms a pane over the others and puts it back", () => {
    const zoomed = applyWorkspaceIntent(grouped(), {
      type: "zoom",
      group: "chat-b",
    }).view;
    expect(zoomed.layout && leafIds(zoomed.layout)).toEqual(["chat-b"]);
    expect(zoomed.restoreView).toBeDefined();
    const restored = applyWorkspaceIntent(zoomed, {
      type: "zoom",
      group: "chat-b",
    }).view;
    expect(restored.layout).toEqual(columns);
    expect(restored.restoreView).toBeUndefined();
  });
});

describe("a chord a page forwards to a detached window", () => {
  it("steps the focused pane's tabs and the panes, zooms and closes there", () => {
    const view = grouped();
    expect(pageShortcutOutcome(view, "next-tab")).toEqual({
      type: "select",
      id: "browser-a",
    });
    expect(pageShortcutOutcome(view, "prev-tab")).toEqual({
      type: "select",
      id: "browser-a",
    });
    expect(pageShortcutOutcome(view, "next-pane")).toEqual({
      type: "select",
      id: "chat-b",
    });
    expect(pageShortcutOutcome(view, "prev-pane")).toEqual({
      type: "select",
      id: "chat-b",
    });
    expect(pageShortcutOutcome(view, "zoom-pane")).toEqual({
      type: "zoom",
      group: "chat-a",
    });
    expect(pageShortcutOutcome(view, "close-pane")).toEqual({
      type: "close",
      id: "chat-a",
    });
  });

  it("does nothing it cannot, and nothing it is not named", () => {
    const alone = resolveWorkspaceView(
      {
        layout: leaf("chat-a"),
        focusedId: "chat-a",
        order: ["chat-a"],
        groups: {},
      },
      ["chat-a"],
      "chat-a",
    );
    expect(pageShortcutOutcome(alone, "next-tab")).toBeNull();
    expect(pageShortcutOutcome(alone, "next-pane")).toBeNull();
    expect(pageShortcutOutcome(alone, "zoom-pane")).toBeNull();
    expect(pageShortcutOutcome(grouped(), "open_settings")).toBeNull();
  });
});
