import { describe, expect, it } from "vitest";
import { leaf, leafIds, layoutLeaves, type LayoutNode } from "./layout";
import {
  resolveWorkspaceView,
  selectWorkspaceView,
  splitWorkspaceView,
  closeWorkspaceViews,
  collapseWorkspaceView,
  combineWorkspaceGroups,
  moveWorkspaceTab,
  reorderWorkspaceGroup,
  workspaceGroupOwner,
  toggleWorkspaceExpansion,
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
  const members = Object.values(view.groups).flat();
  expect([...members].sort()).toEqual([...expectedIds].sort());
  expect(new Set(members).size).toBe(members.length);
  for (const owner of leaves) expect(view.groups[owner]).toContain(owner);
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
    expect(leafIds(restored.layout!)).toEqual(["chat-a", "chat-b", "new-browser"]);
    expect(layoutLeaves(restored.layout!).map((leaf) => leaf.rect)).toEqual(layoutLeaves(before.layout!).map((leaf) => leaf.rect));
    expect(restored.groups["chat-b"]).toEqual(["chat-b"]);
    expect(restored.groups["new-browser"]).toEqual(["browser-a", "new-browser"]);
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

  it("keeps a browser selected after switching to it while another page is expanded", () => {
    const expanded = toggleWorkspaceExpansion(original(), "browser-a");
    const switched = selectWorkspaceView(expanded, "browser-b");
    const restored = toggleWorkspaceExpansion(switched, "browser-b");
    expect(restored.focusedId).toBe("browser-b");
    expect(leafIds(restored.layout!)).toContain("browser-b");
    expect(restored.groups["browser-b"]).toEqual(["chat-b", "browser-b"]);
    expectPartition(restored, ids);
  });

  it("keeps a usable restore snapshot after the expanded active page closes and never resurrects it", () => {
    const before = original();
    const closed = closeWorkspaceViews(
      toggleWorkspaceExpansion(before, "browser-a"),
      ["browser-a"],
      "chat-a",
    );
    expect(closed.restoreView).toBeDefined();
    expect(closed.restoreView?.layout).toEqual({
      type: "split",
      id: "outer",
      dir: "right",
      sizes: [0.32, 0.68],
      children: [leaf("chat-a"), leaf("chat-b")],
    });
    const restored = toggleWorkspaceExpansion(
      closed,
      closed.focusedId,
      "chat-a",
    );
    expectPartition(
      restored,
      ids.filter((id) => id !== "browser-a"),
    );
    expect(restored.order).not.toContain("browser-a");
    expect(Object.values(restored.groups).flat()).not.toContain("browser-a");
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
