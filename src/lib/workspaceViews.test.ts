import { describe, expect, it } from "vitest";
import { leaf, leafIds, layoutLeaves, type LayoutNode } from "./layout";
import {
  resolveWorkspaceView,
  revealBesideWorkspaceView,
  selectWorkspaceView,
  splitWorkspaceView,
  closeWorkspaceViews,
  collapseWorkspaceView,
  combineWorkspaceGroups,
  moveWorkspaceTab,
  reorderWorkspaceGroup,
  workspaceGroupOwner,
  toggleWorkspaceExpansion,
  minimizeWorkspaceSide,
  restoreWorkspaceSplit,
  type WorkspaceView,
} from "./workspaceViews";

const ids = ["chat-a", "browser-a", "chat-b", "browser-b", "chat-c"];
const columns: LayoutNode = {
  type: "split",
  id: "columns",
  dir: "right",
  sizes: [0.4, 0.6],
  children: [leaf("chat-a"), leaf("chat-b")],
};
function grouped() {
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
function expectPartition(view: WorkspaceView, expectedIds = view.order) {
  const leaves = view.layout ? leafIds(view.layout) : [];
  expect(Object.keys(view.groups).sort()).toEqual([...leaves].sort());
  const hidden = view.hiddenGroups ?? {};
  const members = [
    ...Object.values(view.groups),
    ...Object.values(hidden),
  ].flat();
  expect([...members].sort()).toEqual([...expectedIds].sort());
  expect(new Set(members).size).toBe(members.length);
  for (const owner of leaves) expect(view.groups[owner]).toContain(owner);
  for (const [owner, members] of Object.entries(hidden)) {
    expect(leaves).not.toContain(owner);
    expect(members).toContain(owner);
  }
  if (leaves.length) expect(leaves).toContain(view.focusedId);
  else expect(view.focusedId).toBe("");
}

describe("pane-local workspace tab groups", () => {
  it("migrates visible leaves into separate groups and assigns legacy hidden tabs to the focused pane", () => {
    const view = resolveWorkspaceView(
      { layout: columns, focusedId: "chat-b", order: ids },
      ids,
      "chat-a",
    );
    expect(view.groups["chat-a"]).toEqual(["chat-a"]);
    expect(view.groups["chat-b"]).toEqual([
      "chat-b",
      "browser-a",
      "browser-b",
      "chat-c",
    ]);
    expect(view.layout).toEqual(columns);
    expect(view.order).toEqual(ids);
    expectPartition(view);
  });

  it("selects a tab in its own group without replacing a different focused pane", () => {
    const view = grouped();
    const next = selectWorkspaceView(view, "browser-b");
    expect(next.layout).toEqual({
      ...columns,
      children: [leaf("chat-a"), leaf("browser-b")],
    });
    expect(next.groups["browser-b"]).toEqual(["chat-b", "browser-b", "chat-c"]);
    expect(next.groups["chat-b"]).toBeUndefined();
    expect(next.groups["chat-a"]).toBe(view.groups["chat-a"]);
    expect(next.focusedId).toBe("browser-b");
    expect(selectWorkspaceView(next, "chat-a").layout).toBe(next.layout);
    expectPartition(next);
  });

  it("inserts new tabs after the focused group's active tab without stealing existing tabs from other groups", () => {
    const next = resolveWorkspaceView(
      grouped(),
      [...ids, "new-one", "new-two"],
      "chat-a",
    );
    expect(next.groups["chat-a"]).toEqual([
      "chat-a",
      "new-one",
      "new-two",
      "browser-a",
    ]);
    expect(next.groups["chat-b"]).toEqual(["chat-b", "browser-b", "chat-c"]);
    expect(next.order).toEqual([
      "chat-a",
      "new-one",
      "new-two",
      ...ids.slice(1),
    ]);
    expectPartition(next);
  });

  it("splits a hidden tab into a new view while preserving both existing active tabs", () => {
    const next = splitWorkspaceView(grouped(), "browser-a", "down", "chat-b");
    expect(leafIds(next.layout!)).toEqual(["chat-a", "chat-b", "browser-a"]);
    expect(next.groups["chat-a"]).toEqual(["chat-a"]);
    expect(next.groups["browser-a"]).toEqual(["browser-a"]);
    expect(next.focusedId).toBe("browser-a");
    expect(layoutLeaves(next.layout!).map(({ rect }) => rect)).toEqual([
      { x: 0, y: 0, w: 0.4, h: 1 },
      { x: 0.4, y: 0, w: 0.6, h: 0.5 },
      { x: 0.4, y: 0.5, w: 0.6, h: 0.5 },
    ]);
    expectPartition(next);
  });

  it("promotes the active tab's sibling before opening that tab in a new view beside its own pane", () => {
    const next = splitWorkspaceView(grouped(), "chat-a", "right", "chat-a");
    expect(leafIds(next.layout!)).toEqual(["browser-a", "chat-a", "chat-b"]);
    expect(next.groups["browser-a"]).toEqual(["browser-a"]);
    expect(next.groups["chat-a"]).toEqual(["chat-a"]);
    expect(next.focusedId).toBe("chat-a");
    expectPartition(next);
  });

  it("moves a singleton pane using the existing split geometry without duplicating its tab", () => {
    const isolated = splitWorkspaceView(
      grouped(),
      "browser-a",
      "right",
      "chat-a",
    );
    const next = splitWorkspaceView(isolated, "browser-a", "left", "chat-a");
    expect(leafIds(next.layout!)).toEqual(["browser-a", "chat-a", "chat-b"]);
    expectPartition(next);
  });

  it("moves an active tab into another header, promoting the source neighbor and keeping the destination tab selected", () => {
    const next = moveWorkspaceTab(grouped(), "chat-a", "chat-b");
    expect(next.layout).toEqual({
      ...columns,
      children: [leaf("browser-a"), leaf("chat-b")],
    });
    expect(next.groups["browser-a"]).toEqual(["browser-a"]);
    expect(next.groups["chat-b"]).toEqual([
      "chat-b",
      "browser-b",
      "chat-c",
      "chat-a",
    ]);
    expect(next.focusedId).toBe("chat-b");
    expect(next.order).toEqual(ids);
    expectPartition(next);
  });

  it("inserts an inactive tab at a destination header index without replacing either selected tab", () => {
    const next = moveWorkspaceTab(grouped(), "browser-a", "browser-b", 1);
    expect(next.layout).toEqual(columns);
    expect(next.groups["chat-a"]).toEqual(["chat-a"]);
    expect(next.groups["chat-b"]).toEqual([
      "chat-b",
      "browser-a",
      "browser-b",
      "chat-c",
    ]);
    expectPartition(next);
  });

  it("removes an empty source pane when its sole tab joins another header", () => {
    const isolated = splitWorkspaceView(
      grouped(),
      "browser-a",
      "right",
      "chat-a",
    );
    const next = moveWorkspaceTab(isolated, "browser-a", "chat-b");
    expect(leafIds(next.layout!)).toEqual(["chat-a", "chat-b"]);
    expect(next.groups["browser-a"]).toBeUndefined();
    expect(next.groups["chat-b"].at(-1)).toBe("browser-a");
    expectPartition(next);
  });

  it("reorders only the intended group's members and their occupied global slots", () => {
    const view = grouped();
    const next = reorderWorkspaceGroup(view, "browser-b", [
      "chat-c",
      "chat-c",
      "unknown",
      "browser-b",
    ]);
    expect(next.groups["chat-b"]).toEqual(["chat-c", "browser-b", "chat-b"]);
    expect(next.groups["chat-a"]).toBe(view.groups["chat-a"]);
    expect(next.order).toEqual([
      "chat-a",
      "browser-a",
      "chat-c",
      "browser-b",
      "chat-b",
    ]);
    expect(next.layout).toBe(view.layout);
    expect(next.focusedId).toBe(view.focusedId);
    expectPartition(next);
  });

  it("combines a whole pane into its destination without selecting or closing any moved tab", () => {
    const view = grouped();
    const next = combineWorkspaceGroups(view, "browser-a", "browser-b");
    expect(next.layout).toEqual(leaf("chat-b"));
    expect(next.focusedId).toBe("chat-b");
    expect(next.groups).toEqual({
      "chat-b": ["chat-b", "browser-b", "chat-c", "chat-a", "browser-a"],
    });
    expect(next.order).toBe(view.order);
    expectPartition(next, ids);
    const restored = resolveWorkspaceView(
      JSON.parse(JSON.stringify(next)),
      ids,
      "chat-a",
    );
    expect(restored).toEqual(next);
    expect(
      selectWorkspaceView(restored, "browser-a").groups["browser-a"],
    ).toEqual(next.groups["chat-b"]);
  });

  it("keeps the unrelated pane's tab group and the surviving split proportions when combining", () => {
    const view = splitWorkspaceView(grouped(), "browser-b", "down", "chat-b");
    const next = combineWorkspaceGroups(view, "chat-a", "chat-b");
    expect(view.layout?.type).toBe("split");
    if (view.layout?.type !== "split") throw new Error("Expected split");
    expect(next.layout).toEqual(view.layout.children[1]);
    expect(next.groups["browser-b"]).toBe(view.groups["browser-b"]);
    expect(next.groups["chat-b"]).toEqual([
      "chat-b",
      "chat-c",
      "chat-a",
      "browser-a",
    ]);
    expect(next.focusedId).toBe("chat-b");
    expectPartition(next);
  });

  it("treats combining as permanent while ignoring requests within the same pane or for missing tabs", () => {
    const view = { ...grouped(), restoreView: grouped() };
    expect(combineWorkspaceGroups(view, "chat-a", "browser-a")).toBe(view);
    expect(combineWorkspaceGroups(view, "missing", "chat-b")).toBe(view);
    expect(combineWorkspaceGroups(view, "chat-a", "missing")).toBe(view);
    const next = combineWorkspaceGroups(view, "chat-a", "chat-b");
    expect(next.restoreView).toBeUndefined();
    expectPartition(next);
  });

  it("reorders a drop within the same group without duplicating or activating an inactive tab", () => {
    const view = grouped();
    const next = moveWorkspaceTab(view, "browser-a", "chat-a", 0);
    expect(next.groups["chat-a"]).toEqual(["browser-a", "chat-a"]);
    expect(next.layout).toBe(view.layout);
    expect(next.focusedId).toBe("chat-a");
    expectPartition(next);
  });

  it("closing the active tab promotes the next local neighbor, then the previous one", () => {
    const view = selectWorkspaceView(grouped(), "browser-b");
    const next = closeWorkspaceViews(view, ["browser-b"], "browser-a");
    expect(leafIds(next.layout!)).toEqual(["chat-a", "chat-c"]);
    expect(next.groups["chat-c"]).toEqual(["chat-b", "chat-c"]);
    expect(next.focusedId).toBe("chat-c");
    const previous = closeWorkspaceViews(
      view,
      ["browser-b", "chat-c"],
      "browser-a",
    );
    expect(previous.groups["chat-b"]).toEqual(["chat-b"]);
    expect(previous.focusedId).toBe("chat-b");
    expectPartition(next);
    expectPartition(previous);
  });

  it("closing an inactive tab preserves pane geometry and selection", () => {
    const view = grouped();
    const next = closeWorkspaceViews(view, ["browser-b"], "browser-a");
    expect(next.layout).toEqual(view.layout);
    expect(next.focusedId).toBe("chat-a");
    expect(next.groups["chat-b"]).toEqual(["chat-b", "chat-c"]);
    expectPartition(next);
  });

  it("closing the final tab in a pane preserves the other pane rather than opening a hidden fallback there", () => {
    const next = closeWorkspaceViews(
      grouped(),
      ["chat-a", "browser-a"],
      "browser-b",
    );
    expect(next.layout).toEqual(leaf("chat-b"));
    expect(next.focusedId).toBe("chat-b");
    expect(next.groups["chat-b"]).toEqual(["chat-b", "browser-b", "chat-c"]);
    expectPartition(next);
    expect(closeWorkspaceViews(next, next.order, "")).toEqual({
      layout: null,
      focusedId: "",
      order: [],
      groups: {},
    });
  });

  it("collapses all groups into the selected pane without losing tab order or identities", () => {
    const next = collapseWorkspaceView(grouped(), "browser-b");
    expect(next.layout).toEqual(leaf("browser-b"));
    expect(next.focusedId).toBe("browser-b");
    expect(next.groups["browser-b"]).toEqual([
      "chat-b",
      "browser-b",
      "chat-c",
      "chat-a",
      "browser-a",
    ]);
    expect(next.order).toEqual(next.groups["browser-b"]);
    expectPartition(next, ids);
  });

  it("restores grouped selection, header ordering and geometry from serialized data", () => {
    const view = selectWorkspaceView(
      moveWorkspaceTab(grouped(), "browser-a", "chat-b", 1),
      "browser-b",
    );
    const restored = resolveWorkspaceView(
      JSON.parse(JSON.stringify(view)),
      ids,
      "chat-a",
    );
    expect(restored).toEqual(view);
    expect(workspaceGroupOwner(restored, "browser-a")).toBe("browser-b");
    expectPartition(restored);
  });

  it("prunes malformed group membership, duplicate leaves and stale owners while preserving each valid tab exactly once", () => {
    const malformed = {
      layout: {
        type: "split",
        id: "x",
        dir: "right",
        children: [leaf("gone"), leaf("chat-b"), leaf("chat-b")],
        sizes: [NaN, 0, Infinity],
      },
      focusedId: "gone",
      order: ["browser-a", "chat-a", "chat-b", "unknown"],
      groups: {
        gone: ["gone", "chat-b", "browser-a", "browser-a", null],
        "chat-b": ["browser-a", "chat-b", "browser-b"],
        orphan: ["chat-c"],
      },
    };
    const restored = resolveWorkspaceView(malformed as never, ids, "chat-a");
    expect(leafIds(restored.layout!)).toEqual(["browser-a", "chat-b"]);
    expect(restored.focusedId).toBe("browser-a");
    expect(restored.groups["chat-b"]).toEqual(["chat-b", "browser-b"]);
    expect(
      layoutLeaves(restored.layout!).every(({ rect }) =>
        Number.isFinite(rect.w),
      ),
    ).toBe(true);
    expectPartition(restored, ids);
  });

  it("rejects invalid group containers and requests without affecting existing tabs", () => {
    const view = resolveWorkspaceView(
      { layout: columns, groups: "broken" as never, focusedId: "chat-a" },
      ids,
      "chat-a",
    );
    expectPartition(view, ids);
    expect(moveWorkspaceTab(view, "missing", "chat-b")).toBe(view);
    expect(splitWorkspaceView(view, "missing", "right")).toBe(view);
    expect(selectWorkspaceView(view, "missing")).toBe(view);
    expect(reorderWorkspaceGroup(view, "missing", [])).toBe(view);
    expect(collapseWorkspaceView(view, "missing")).toBe(view);
  });
});

describe("temporary workspace expansion", () => {
  const original = () =>
    resolveWorkspaceView(
      {
        layout: {
          type: "split",
          id: "outer",
          dir: "right",
          sizes: [0.32, 0.68],
          children: [
            leaf("chat-a"),
            {
              type: "split",
              id: "right-rows",
              dir: "down",
              sizes: [0.27, 0.73],
              children: [leaf("chat-b"), leaf("browser-a")],
            },
          ],
        },
        focusedId: "browser-a",
        order: ids,
        groups: {
          "chat-a": ["chat-c", "chat-a"],
          "chat-b": ["chat-b", "browser-b"],
          "browser-a": ["browser-a"],
        },
      },
      ids,
      "browser-a",
    );

  it("restores three panes with their exact proportions, group membership, local order and focus", () => {
    const before = original();
    const expanded = toggleWorkspaceExpansion(before, "browser-a", "chat-a");
    expect(expanded.layout).toEqual(leaf("browser-a"));
    expect(expanded.restoreView).toEqual(before);
    expect(expanded.restoreView).not.toHaveProperty("restoreView");
    expect(expanded.groups).toEqual({ "browser-a": ["browser-a"] });
    expect(expanded.hiddenGroups).toEqual({
      "chat-a": ["chat-c", "chat-a"],
      "chat-b": ["chat-b", "browser-b"],
    });
    expectPartition(expanded, ids);
    const restored = toggleWorkspaceExpansion(expanded, "browser-a", "chat-a");
    expect(restored).toEqual(before);
    expect(restored).not.toHaveProperty("restoreView");
  });

  it("prunes closed hidden tabs and puts newly created tabs in the expanded pane's original group before restoring", () => {
    const before = original();
    const expanded = toggleWorkspaceExpansion(before, "browser-a");
    const closed = closeWorkspaceViews(expanded, ["browser-b"], "chat-a");
    const liveIds = [...ids.filter((id) => id !== "browser-b"), "new-browser"];
    const withNew = selectWorkspaceView(
      resolveWorkspaceView(closed, liveIds, "browser-a"),
      "new-browser",
    );
    const restored = toggleWorkspaceExpansion(withNew, "new-browser", "chat-a");
    expect(restored.focusedId).toBe("new-browser");
    expect(leafIds(restored.layout!)).toEqual([
      "chat-a",
      "chat-b",
      "new-browser",
    ]);
    expect(layoutLeaves(restored.layout!).map((leaf) => leaf.rect)).toEqual(
      layoutLeaves(before.layout!).map((leaf) => leaf.rect),
    );
    expect(restored.groups["chat-b"]).toEqual(["chat-b"]);
    expect(restored.groups["new-browser"]).toEqual([
      "browser-a",
      "new-browser",
    ]);
    expect(restored.groups["chat-a"]).toEqual(before.groups["chat-a"]);
    expect(restored.order).toEqual([
      "chat-a",
      "browser-a",
      "new-browser",
      "chat-b",
      "chat-c",
    ]);
    expectPartition(restored, liveIds);
  });

  it("restores the split when an explicitly selected browser belongs to a tucked pane", () => {
    const expanded = toggleWorkspaceExpansion(original(), "browser-a");
    const restored = selectWorkspaceView(expanded, "browser-b");
    expect(restored.focusedId).toBe("browser-b");
    expect(leafIds(restored.layout!)).toEqual([
      "chat-a",
      "browser-b",
      "browser-a",
    ]);
    expect(restored.groups["browser-b"]).toEqual(["chat-b", "browser-b"]);
    expect(restored.hiddenGroups).toBeUndefined();
    expect(restored.restoreView).toBeUndefined();
    expectPartition(restored, ids);
  });

  it("reveals surviving panes when the last expanded tab closes and never resurrects it", () => {
    const before = original();
    const closed = closeWorkspaceViews(
      toggleWorkspaceExpansion(before, "browser-a"),
      ["browser-a"],
      "chat-a",
    );
    expect(closed.restoreView).toBeUndefined();
    expect(closed.hiddenGroups).toBeUndefined();
    expect(closed.layout).toEqual({
      type: "split",
      id: "outer",
      dir: "right",
      sizes: [0.32, 0.68],
      children: [leaf("chat-a"), leaf("chat-b")],
    });
    expectPartition(
      closed,
      ids.filter((id) => id !== "browser-a"),
    );
    expect(closed.order).not.toContain("browser-a");
    expect(Object.values(closed.groups).flat()).not.toContain("browser-a");
  });

  it("survives serialization while ignoring nested restore snapshots", () => {
    const before = original();
    const expanded = toggleWorkspaceExpansion(before, "browser-a");
    const stored = JSON.parse(JSON.stringify(expanded));
    stored.restoreView.restoreView = {
      restoreView: { layout: { type: "leaf", id: "invented" } },
    };
    const resumed = resolveWorkspaceView(stored, ids, "chat-a");
    expect(resumed.restoreView).toEqual(before);
    expect(resumed.restoreView).not.toHaveProperty("restoreView");
    expect(toggleWorkspaceExpansion(resumed, "browser-a")).toEqual(before);
  });

  it("clears expansion history when the user explicitly requests a permanent single view", () => {
    const expanded = toggleWorkspaceExpansion(original(), "browser-a");
    const collapsed = collapseWorkspaceView(expanded, "chat-b");
    expect(collapsed.layout).toEqual(leaf("chat-b"));
    expect(collapsed).not.toHaveProperty("restoreView");
    expectPartition(collapsed, ids);
  });

  it("falls back to placing the session beside a single browser when there is no previous split", () => {
    const single = resolveWorkspaceView(
      undefined,
      ["chat-a", "browser-a"],
      "browser-a",
    );
    const next = toggleWorkspaceExpansion(single, "browser-a", "chat-a");
    expect(leafIds(next.layout!)).toEqual(["chat-a", "browser-a"]);
    expect(next.groups).toEqual({
      "chat-a": ["chat-a"],
      "browser-a": ["browser-a"],
    });
    expect(next).not.toHaveProperty("restoreView");
    expect(toggleWorkspaceExpansion(single, "browser-a", "missing")).toEqual(
      single,
    );
  });

  it("drops malformed backup trees and empty restore data", () => {
    const single = resolveWorkspaceView(undefined, ["browser-a"], "browser-a");
    const malformed = {
      ...single,
      restoreView: { layout: { type: "split", children: "broken" } },
    };
    expect(
      resolveWorkspaceView(malformed as never, single.order, "browser-a"),
    ).toEqual(single);
    expect(
      resolveWorkspaceView(
        { ...single, restoreView: [] as never },
        single.order,
        "browser-a",
      ),
    ).toEqual(single);
    const expanded = toggleWorkspaceExpansion(original(), "browser-a");
    expect(closeWorkspaceViews(expanded, ids, "")).toEqual({
      layout: null,
      focusedId: "",
      order: [],
      groups: {},
    });
  });
});

describe("temporary workspace minimization", () => {
  const liveIds = [
    "left-a",
    "left-b",
    "top-a",
    "top-b",
    "bottom-a",
    "bottom-b",
    "right",
  ];
  const original = (): WorkspaceView =>
    resolveWorkspaceView(
      {
        layout: {
          type: "split",
          id: "columns",
          dir: "right",
          sizes: [0.2, 0.5, 0.3],
          children: [
            leaf("left-a"),
            {
              type: "split",
              id: "middle-rows",
              dir: "down",
              sizes: [0.4, 0.6],
              children: [leaf("top-a"), leaf("bottom-a")],
            },
            leaf("right"),
          ],
        },
        focusedId: "left-a",
        order: liveIds,
        groups: {
          "left-a": ["left-a", "left-b"],
          "top-a": ["top-a", "top-b"],
          "bottom-a": ["bottom-a", "bottom-b"],
          right: ["right"],
        },
      },
      liveIds,
      "left-a",
    );

  it("tucks a left pane and its tab strip while retaining unrelated pane sizes", () => {
    const before = original();
    const next = minimizeWorkspaceSide(before, "columns", 0, "before");
    expect(leafIds(next.layout!)).toEqual(["top-a", "bottom-a", "right"]);
    expect(next.layout).toMatchObject({ id: "columns", sizes: [0.7, 0.3] });
    expect(next.groups["top-a"]).toEqual(["top-a", "top-b"]);
    expect(next.hiddenGroups).toEqual({ "left-a": ["left-a", "left-b"] });
    expect(workspaceGroupOwner(next, "left-b")).toBeUndefined();
    expect(next.groups["bottom-a"]).toEqual(before.groups["bottom-a"]);
    expect(next.groups.right).toEqual(before.groups.right);
    expect(next.focusedId).toBe("top-a");
    expect(next.order).toEqual(before.order);
    expect(next.minimizedEdge).toBe("left");
    expect(next.restoreView).toEqual(before);
    expectPartition(next, liveIds);
    expect(restoreWorkspaceSplit(next)).toEqual({
      ...before,
      focusedId: "top-a",
    });
  });

  it.each([
    {
      index: 0,
      side: "after" as const,
      owner: "left-a",
      sizes: [0.7, 0.3],
      members: ["left-a", "left-b"],
      edge: "right",
    },
    {
      index: 1,
      side: "before" as const,
      owner: "right",
      sizes: [0.2, 0.8],
      members: ["right"],
      edge: "left",
    },
  ])(
    "minimizes an entire nested subtree $side a sash without losing any group",
    ({ index, side, owner, sizes, members, edge }) => {
      const before = original();
      const next = minimizeWorkspaceSide(before, "columns", index, side);
      expect(leafIds(next.layout!)).toEqual(["left-a", "right"]);
      expect(next.layout).toMatchObject({ sizes });
      expect(next.groups[owner]).toEqual(members);
      expect(next.hiddenGroups).toEqual({
        "top-a": ["top-a", "top-b"],
        "bottom-a": ["bottom-a", "bottom-b"],
      });
      expect(next.focusedId).toBe("left-a");
      expect(next.minimizedEdge).toBe(edge);
      expect(next.order).toEqual(before.order);
      expectPartition(next, liveIds);
      expect(restoreWorkspaceSplit(next)).toEqual(before);
    },
  );

  it("tucks a right pane without changing the neighboring tab strips", () => {
    const next = minimizeWorkspaceSide(original(), "columns", 1, "after");
    expect(next.layout).toMatchObject({ sizes: [0.2, 0.8] });
    expect(next.groups["bottom-a"]).toEqual(["bottom-a", "bottom-b"]);
    expect(next.groups["top-a"]).toEqual(["top-a", "top-b"]);
    expect(next.hiddenGroups).toEqual({ right: ["right"] });
    expect(next.minimizedEdge).toBe("right");
    expectPartition(next, liveIds);
  });

  it.each([
    {
      side: "before" as const,
      owner: "bottom-a",
      edge: "up",
      members: ["bottom-a", "bottom-b"],
      hidden: { "top-a": ["top-a", "top-b"] },
    },
    {
      side: "after" as const,
      owner: "top-a",
      edge: "down",
      members: ["top-a", "top-b"],
      hidden: { "bottom-a": ["bottom-a", "bottom-b"] },
    },
  ])(
    "minimizes the $side side of a nested vertical split",
    ({ side, owner, edge, members, hidden }) => {
      const before = original();
      const next = minimizeWorkspaceSide(before, "middle-rows", 0, side);
      expect(next.layout).toEqual({
        type: "split",
        id: "columns",
        dir: "right",
        sizes: [0.2, 0.5, 0.3],
        children: [leaf("left-a"), leaf(owner), leaf("right")],
      });
      expect(next.groups[owner]).toEqual(members);
      expect(next.hiddenGroups).toEqual(hidden);
      expect(next.minimizedEdge).toBe(edge);
      expectPartition(next, liveIds);
      expect(restoreWorkspaceSplit(next)).toEqual(before);
    },
  );

  it("keeps the oldest full split through successive minimizations down to a single pane", () => {
    const before = original();
    const left = minimizeWorkspaceSide(before, "columns", 0, "before");
    const right = minimizeWorkspaceSide(left, "columns", 0, "after");
    const single = minimizeWorkspaceSide(right, "middle-rows", 0, "after");
    expect(single.layout).toEqual(leaf("top-a"));
    expect(single.restoreView).toEqual(before);
    expect(single.restoreView).not.toHaveProperty("restoreView");
    expect(single.restoreView).not.toHaveProperty("minimizedEdge");
    expect(single.order).toEqual(before.order);
    expect(single.groups).toEqual({ "top-a": ["top-a", "top-b"] });
    expect(single.hiddenGroups).toEqual({
      "left-a": ["left-a", "left-b"],
      right: ["right"],
      "bottom-a": ["bottom-a", "bottom-b"],
    });
    expectPartition(single, liveIds);
    const restored = restoreWorkspaceSplit(single);
    expect(restored).toEqual({ ...before, focusedId: "top-a" });
    expect(restored).not.toHaveProperty("minimizedEdge");
    expect(restored).not.toHaveProperty("hiddenGroups");
    expect(toggleWorkspaceExpansion(single, "top-a")).toEqual(restored);
  });

  it("keeps the oldest restore snapshot when expanding after partial minimization", () => {
    const before = original();
    const minimized = minimizeWorkspaceSide(before, "columns", 0, "before");
    const expanded = toggleWorkspaceExpansion(minimized, "bottom-a");
    expect(expanded.layout).toEqual(leaf("bottom-a"));
    expect(expanded.restoreView).toEqual(before);
    expect(expanded.minimizedEdge).toBe("left");
    expect(expanded.groups).toEqual({ "bottom-a": ["bottom-a", "bottom-b"] });
    expect(Object.keys(expanded.hiddenGroups!).sort()).toEqual([
      "left-a",
      "right",
      "top-a",
    ]);
    expect(toggleWorkspaceExpansion(expanded, "bottom-a")).toEqual({
      ...before,
      focusedId: "bottom-a",
    });
  });

  it("restores surviving groups after tabs close and keeps a newly opened selected tab visible", () => {
    const minimized = minimizeWorkspaceSide(original(), "columns", 0, "before");
    const closed = closeWorkspaceViews(minimized, ["left-a", "top-a"], "right");
    const remaining = [
      ...liveIds.filter((id) => !["left-a", "top-a"].includes(id)),
      "new-tab",
    ];
    const updated = selectWorkspaceView(
      resolveWorkspaceView(closed, remaining, closed.focusedId),
      "new-tab",
    );
    expect(updated.groups["new-tab"]).toEqual(["top-b", "new-tab"]);
    expect(updated.hiddenGroups).toEqual({ "left-b": ["left-b"] });
    const restored = restoreWorkspaceSplit(updated);
    expect(restored.focusedId).toBe("new-tab");
    expect(leafIds(restored.layout!)).toContain("new-tab");
    expect(restored.layout).toMatchObject({ sizes: [0.2, 0.5, 0.3] });
    expect(restored.order).not.toContain("left-a");
    expect(restored.order).not.toContain("top-a");
    expect(restored.groups["bottom-a"]).toEqual(["bottom-a", "bottom-b"]);
    expect(restored.groups["new-tab"]).toEqual(["top-b", "new-tab"]);
    expect(restored.groups["left-b"]).toEqual(["left-b"]);
    expectPartition(restored, remaining);
    expect(restored).not.toHaveProperty("restoreView");
    expect(restored).not.toHaveProperty("minimizedEdge");
  });

  it("validates a serialized minimized edge only alongside a surviving restore snapshot", () => {
    const before = original();
    const minimized = minimizeWorkspaceSide(before, "columns", 0, "before");
    expect(
      resolveWorkspaceView(
        JSON.parse(JSON.stringify(minimized)),
        liveIds,
        "right",
      ),
    ).toEqual(minimized);
    expect(
      resolveWorkspaceView(
        { ...before, minimizedEdge: "left" },
        liveIds,
        "right",
      ),
    ).toEqual(before);
    expect(
      resolveWorkspaceView(
        { ...minimized, minimizedEdge: "invalid" as never },
        liveIds,
        "right",
      ),
    ).not.toHaveProperty("minimizedEdge");
    const invalid = { ...minimized, restoreView: { layout: null } as never };
    expect(resolveWorkspaceView(invalid, liveIds, "right")).not.toHaveProperty(
      "minimizedEdge",
    );
    expect(restoreWorkspaceSplit(invalid)).not.toHaveProperty("restoreView");
    expect(closeWorkspaceViews(minimized, liveIds, "")).toEqual({
      layout: null,
      focusedId: "",
      order: [],
      groups: {},
    });
    expect(collapseWorkspaceView(minimized, "top-a")).not.toHaveProperty(
      "minimizedEdge",
    );
  });

  it("keeps tucked groups separate through serialization and stale focus hints", () => {
    const minimized = minimizeWorkspaceSide(original(), "columns", 0, "before");
    const resumed = resolveWorkspaceView(
      JSON.parse(JSON.stringify(minimized)),
      liveIds,
      "left-a",
    );
    expect(resumed.groups).toEqual(minimized.groups);
    expect(resumed.hiddenGroups).toEqual({ "left-a": ["left-a", "left-b"] });
    expect(resumed.focusedId).toBe("top-a");
    const selected = selectWorkspaceView(resumed, "left-b");
    expect(selected.focusedId).toBe("left-b");
    expect(selected.groups["left-b"]).toEqual(["left-a", "left-b"]);
    expect(selected.layout).toMatchObject({ sizes: [0.2, 0.5, 0.3] });
    expect(selected.hiddenGroups).toBeUndefined();
    expectPartition(selected, liveIds);
  });

  it("closing tucked tabs promotes inside the hidden group and removes an exhausted restore affordance", () => {
    const minimized = minimizeWorkspaceSide(original(), "columns", 0, "before");
    const oneClosed = closeWorkspaceViews(minimized, ["left-a"], "left-b");
    expect(oneClosed.hiddenGroups).toEqual({ "left-b": ["left-b"] });
    expect(oneClosed.groups).toEqual(minimized.groups);
    const allClosed = closeWorkspaceViews(oneClosed, ["left-b"], "top-a");
    expect(allClosed.layout).toEqual(minimized.layout);
    expect(allClosed.groups).toEqual(minimized.groups);
    expect(allClosed.restoreView).toBeUndefined();
    expect(allClosed.hiddenGroups).toBeUndefined();
    expect(allClosed.minimizedEdge).toBeUndefined();
    expectPartition(
      allClosed,
      liveIds.filter((id) => !id.startsWith("left")),
    );
  });

  it("rejects malformed or duplicate hidden membership without hiding visible tabs or losing live IDs", () => {
    const minimized = minimizeWorkspaceSide(original(), "columns", 0, "before");
    const malformed = resolveWorkspaceView(
      {
        ...minimized,
        hiddenGroups: {
          "left-a": ["left-a", "top-a", "left-b", "left-b", "gone"],
          duplicate: ["left-b", "right"],
          broken: null as never,
        },
      },
      liveIds,
      "left-a",
    );
    expect(malformed.groups).toEqual(minimized.groups);
    expect(malformed.hiddenGroups).toEqual({ "left-a": ["left-a", "left-b"] });
    expectPartition(malformed, liveIds);
    for (const hiddenGroups of ["broken", []]) {
      const resolved = resolveWorkspaceView(
        { ...minimized, hiddenGroups: hiddenGroups as never },
        liveIds,
        "top-a",
      );
      expect(resolved.hiddenGroups).toBeUndefined();
      expectPartition(resolved, liveIds);
    }
    const invalidBackup = resolveWorkspaceView(
      { ...minimized, restoreView: undefined },
      liveIds,
      "top-a",
    );
    expect(invalidBackup.hiddenGroups).toBeUndefined();
    expectPartition(invalidBackup, liveIds);
  });

  it.each([
    [
      "split a tucked tab",
      (view: WorkspaceView) =>
        splitWorkspaceView(view, "left-b", "down", "right"),
    ],
    [
      "move a tucked tab",
      (view: WorkspaceView) => moveWorkspaceTab(view, "left-b", "right"),
    ],
    [
      "move into a tucked group",
      (view: WorkspaceView) => moveWorkspaceTab(view, "top-b", "left-a"),
    ],
    [
      "reveal a tucked surface",
      (view: WorkspaceView) =>
        revealBesideWorkspaceView(view, "left-b", "right"),
    ],
    [
      "reveal beside a tucked requester",
      (view: WorkspaceView) =>
        revealBesideWorkspaceView(view, "top-b", "left-a"),
    ],
    [
      "combine a tucked group",
      (view: WorkspaceView) => combineWorkspaceGroups(view, "left-a", "top-a"),
    ],
    [
      "combine visible groups while another is tucked",
      (view: WorkspaceView) => combineWorkspaceGroups(view, "top-a", "right"),
    ],
    [
      "reorder a tucked group",
      (view: WorkspaceView) =>
        reorderWorkspaceGroup(view, "left-a", ["left-b", "left-a"]),
    ],
    [
      "permanently collapse into a tucked group",
      (view: WorkspaceView) => collapseWorkspaceView(view, "left-b"),
    ],
  ])("can %s without losing any hidden tab", (_name, update) => {
    const minimized = minimizeWorkspaceSide(original(), "columns", 0, "before");
    const next = update(minimized);
    expect(next.hiddenGroups).toBeUndefined();
    expect(next.restoreView).toBeUndefined();
    expectPartition(next, liveIds);
    expectPartition(
      resolveWorkspaceView(next, liveIds, next.focusedId),
      liveIds,
    );
  });

  it("keeps tucked groups unchanged when a permanent combine request is invalid or stays within one group", () => {
    const minimized = minimizeWorkspaceSide(original(), "columns", 0, "before");
    expect(combineWorkspaceGroups(minimized, "missing", "right")).toBe(
      minimized,
    );
    expect(combineWorkspaceGroups(minimized, "top-a", "missing")).toBe(
      minimized,
    );
    expect(combineWorkspaceGroups(minimized, "left-a", "left-b")).toBe(
      minimized,
    );
    expect(combineWorkspaceGroups(minimized, "top-a", "top-b")).toBe(minimized);
  });

  it("ignores missing splits, invalid sashes, invalid sides and single-pane requests", () => {
    const before = original();
    expect(minimizeWorkspaceSide(before, "missing", 0, "before")).toBe(before);
    for (const index of [-1, 2, 0.5, NaN, Infinity])
      expect(minimizeWorkspaceSide(before, "columns", index, "before")).toBe(
        before,
      );
    expect(
      minimizeWorkspaceSide(before, "columns", 0, "invalid" as never),
    ).toBe(before);
    expect(restoreWorkspaceSplit(before)).toBe(before);
    const single = collapseWorkspaceView(before, "right");
    expect(minimizeWorkspaceSide(single, "columns", 0, "before")).toBe(single);
    const empty = resolveWorkspaceView(undefined, [], "");
    expect(minimizeWorkspaceSide(empty, "columns", 0, "before")).toBe(empty);
  });
});

describe("agent-opened surfaces", () => {
  const single = (): WorkspaceView =>
    resolveWorkspaceView(
      {
        layout: leaf("chat-a"),
        focusedId: "chat-a",
        order: ["chat-a", "page"],
        groups: { "chat-a": ["chat-a", "page"] },
      },
      ["chat-a", "page"],
      "chat-a",
    );

  it("opens beside the requesting chat instead of behind it", () => {
    const next = revealBesideWorkspaceView(single(), "page", "chat-a");
    expect(next.layout && leafIds(next.layout)).toEqual(["chat-a", "page"]);
    expect(next.focusedId).toBe("page");
    expect(next.groups["chat-a"]).toEqual(["chat-a"]);
    expectPartition(next);
    // Focusing the chat afterwards keeps the page visible in its own pane.
    const refocused = selectWorkspaceView(next, "chat-a");
    expect(refocused.layout && leafIds(refocused.layout)).toContain("page");
  });

  it("moves a page that already covers the chat into its own pane and shows the chat again", () => {
    const three = ["chat-a", "other", "page"];
    const covered = selectWorkspaceView(
      resolveWorkspaceView(
        {
          layout: leaf("chat-a"),
          focusedId: "chat-a",
          order: three,
          groups: { "chat-a": three },
        },
        three,
        "chat-a",
      ),
      "page",
    );
    expect(covered.layout && leafIds(covered.layout)).toEqual(["page"]);
    const next = revealBesideWorkspaceView(covered, "page", "chat-a");
    expect(next.layout && leafIds(next.layout)).toEqual(["chat-a", "page"]);
    expect(next.focusedId).toBe("page");
    expectPartition(next, three);
  });

  it("uses another existing pane rather than adding a third", () => {
    const view = resolveWorkspaceView(
      {
        layout: columns,
        focusedId: "chat-a",
        order: [...ids, "page"],
        groups: {
          "chat-a": ["chat-a", "browser-a", "page"],
          "chat-b": ["chat-b", "browser-b", "chat-c"],
        },
      },
      [...ids, "page"],
      "chat-a",
    );
    const next = revealBesideWorkspaceView(view, "page", "chat-a");
    expect(next.layout && leafIds(next.layout)).toEqual(["chat-a", "page"]);
    expect(next.groups["page"]).toContain("chat-b");
    expect(next.groups["chat-a"]).not.toContain("page");
    expect(next.focusedId).toBe("page");
    expectPartition(next);
  });

  it("selects the page in place when it is already outside the chat's pane or the chat is unknown", () => {
    const view = grouped();
    const elsewhere = revealBesideWorkspaceView(view, "browser-b", "chat-a");
    expect(elsewhere.layout && leafIds(elsewhere.layout)).toEqual([
      "chat-a",
      "browser-b",
    ]);
    const unknown = revealBesideWorkspaceView(single(), "page", "missing");
    expect(unknown.layout && leafIds(unknown.layout)).toEqual(["page"]);
    expect(revealBesideWorkspaceView(view, "missing", "chat-a")).toBe(view);
  });
});
