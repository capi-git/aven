import { describe, expect, it } from "vitest";
import { leaf, leafIds, placePane } from "./layout";
import {
  closeWorkspaceViews,
  resolveWorkspaceView,
  selectWorkspaceView,
  reorderWorkspaceGroup,
  minimizeWorkspaceSide,
} from "./workspaceViews";
import {
  mergeWorkspaceArrangements,
  captureWorkspaceReturnPlacement,
  restoreWorkspaceArrangement,
  selectWorkspaceArrangement,
} from "./workspaceArrangement";

const view = () =>
  resolveWorkspaceView(
    {
      layout: {
        type: "split",
        id: "split",
        dir: "right",
        children: [leaf("a"), leaf("c")],
        sizes: [0.4, 0.6],
      },
      order: ["a", "b", "c"],
      groups: { a: ["a", "b"], c: ["c"] },
      focusedId: "a",
    },
    ["a", "b", "c"],
    "a",
  );
describe("workspace arrangement transfers", () => {
  it("preserves grouped tabs and source split proportions", () => {
    const original = view();
    expect(selectWorkspaceArrangement(original, original.order)).toEqual(
      original,
    );
    const group = selectWorkspaceArrangement(original, ["a", "b"]);
    expect(group.groups).toEqual({ a: ["a", "b"] });
    expect(leafIds(group.layout!)).toEqual(["a"]);
  });
  it("merges returned tabs without discarding work opened while detached", () => {
    const current = resolveWorkspaceView(undefined, ["new"], "new");
    const result = mergeWorkspaceArrangements(current, view());
    expect(result.order).toEqual(["new", "a", "b", "c"]);
    expect(leafIds(result.layout!)).toEqual(["new", "a", "c"]);
    expect(result.groups.a).toEqual(["a", "b"]);
  });
  it("reveals minimized groups as separate panes when a returned window changes the arrangement", () => {
    const minimized = minimizeWorkspaceSide(view(), "split", 0, "before");
    const incoming = resolveWorkspaceView(undefined, ["new"], "new");
    for (const [current, added] of [
      [minimized, incoming],
      [incoming, minimized],
    ]) {
      const merged = mergeWorkspaceArrangements(current, added);
      expect(leafIds(merged.layout!).sort()).toEqual(["a", "c", "new"]);
      expect(merged.groups.a).toEqual(["a", "b"]);
      expect(merged.groups.c).toEqual(["c"]);
      expect(merged.groups.new).toEqual(["new"]);
      expect(merged.hiddenGroups).toBeUndefined();
      expect(merged.restoreView).toBeUndefined();
    }
  });
  it("preserves minimized state during an unchanged visible-group window round trip", () => {
    const minimized = minimizeWorkspaceSide(view(), "split", 0, "before");
    const placement = captureWorkspaceReturnPlacement(minimized, ["c"]);
    const restored = restoreWorkspaceArrangement(
      placement.remaining,
      placement.incoming,
      placement,
    );
    expect(restored).toEqual(minimized);
    expect(restored.groups).toEqual({ c: ["c"] });
    expect(restored.hiddenGroups).toEqual({ a: ["a", "b"] });
  });
  const roundTrip = () => {
    const original = resolveWorkspaceView(
      {
        layout: {
          type: "split",
          id: "columns",
          dir: "right",
          sizes: [0.39, 0.32, 0.29],
          children: [
            {
              type: "split",
              id: "rows",
              dir: "down",
              sizes: [0.53, 0.47],
              children: [leaf("left"), leaf("bottom")],
            },
            leaf("middle"),
            leaf("right"),
          ],
        },
        order: [
          "left",
          "left-2",
          "bottom",
          "middle",
          "middle-2",
          "middle-3",
          "middle-4",
          "middle-5",
          "right",
        ],
        groups: {
          left: ["left", "left-2"],
          bottom: ["bottom"],
          middle: ["middle", "middle-2", "middle-3", "middle-4", "middle-5"],
          right: ["right"],
        },
        focusedId: "middle",
      },
      [
        "left",
        "left-2",
        "bottom",
        "middle",
        "middle-2",
        "middle-3",
        "middle-4",
        "middle-5",
        "right",
      ],
      "middle",
    );
    return captureWorkspaceReturnPlacement(original, original.groups.middle);
  };
  it("returns a five-tab middle group to its exact nested split position and widths, preserving changed active tabs", () => {
    const checkpoint = roundTrip();
    const parent = selectWorkspaceView(checkpoint.remaining, "left-2");
    const child = selectWorkspaceView(checkpoint.incoming, "middle-3");
    const restored = restoreWorkspaceArrangement(parent, child, checkpoint);
    const expected = selectWorkspaceView(
      selectWorkspaceView(checkpoint.before, "left-2"),
      "middle-3",
    );
    expect(restored).toEqual(expected);
    expect(restored.order).toEqual(checkpoint.before.order);
    expect(leafIds(restored.layout!)).toEqual([
      "left-2",
      "bottom",
      "middle-3",
      "right",
    ]);
  });
  it.each(["reorder", "resize"] as const)(
    "keeps the current parent %s when a detached group returns",
    (change) => {
      const checkpoint = roundTrip();
      const parent =
        change === "reorder"
          ? {
              ...checkpoint.remaining,
              layout: placePane(
                checkpoint.remaining.layout!,
                "right",
                "left",
                "left",
              ),
              focusedId: "right",
            }
          : {
              ...checkpoint.remaining,
              layout: { ...checkpoint.remaining.layout!, sizes: [0.7, 0.3] },
            };
      const restored = restoreWorkspaceArrangement(
        parent,
        checkpoint.incoming,
        checkpoint,
      );
      expect(restored.layout?.type).toBe("split");
      if (restored.layout?.type === "split") {
        expect(restored.layout.children[0]).toEqual(parent.layout);
        expect(restored.layout.children[1]).toEqual(checkpoint.incoming.layout);
      }
      expect(restored.order).toEqual([
        ...parent.order,
        ...checkpoint.incoming.order,
      ]);
    },
  );
  it.each([
    "close-parent",
    "new-parent",
    "close-child",
    "new-child",
    "reorder-child",
  ] as const)(
    "falls back without reviving or discarding tabs after %s",
    (change) => {
      const checkpoint = roundTrip();
      let parent = checkpoint.remaining,
        child = checkpoint.incoming;
      if (change === "close-parent")
        parent = closeWorkspaceViews(parent, ["right"], parent.focusedId);
      if (change === "new-parent")
        parent = resolveWorkspaceView(
          parent,
          [...parent.order, "new-parent"],
          parent.focusedId,
        );
      if (change === "close-child")
        child = closeWorkspaceViews(child, ["middle-5"], child.focusedId);
      if (change === "new-child")
        child = resolveWorkspaceView(
          child,
          [...child.order, "new-child"],
          child.focusedId,
        );
      if (change === "reorder-child")
        child = reorderWorkspaceGroup(
          child,
          "middle",
          [...child.groups.middle].reverse(),
        );
      const restored = restoreWorkspaceArrangement(parent, child, checkpoint);
      expect(restored.order).toEqual([...parent.order, ...child.order]);
      if (restored.layout?.type === "split") {
        expect(restored.layout.children[0]).toEqual(parent.layout);
        expect(restored.layout.children[1]).toEqual(child.layout);
      } else
        throw new Error("Changed work should use the existing append fallback");
      if (change.startsWith("close"))
        expect(restored.order).not.toContain(
          change === "close-parent" ? "right" : "middle-5",
        );
    },
  );
  it("restores a whole workspace returned to an unchanged empty parent", () => {
    const original = view();
    const checkpoint = captureWorkspaceReturnPlacement(
      original,
      original.order,
    );
    expect(
      restoreWorkspaceArrangement(
        checkpoint.remaining,
        checkpoint.incoming,
        checkpoint,
      ),
    ).toEqual(original);
  });
});
