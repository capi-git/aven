import { describe, expect, it } from "vitest";
import { leaf, leafIds } from "./layout";
import {
  closeWorkspaceViews,
  resolveWorkspaceView,
  selectWorkspaceView,
  reorderWorkspaceGroup,
} from "./workspaceViews";
import {
  mergeWorkspaceArrangements,
  captureWorkspaceReturnPlacement,
  restoreWorkspaceArrangement,
  moveWorkspaceGroup,
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
          ? moveWorkspaceGroup(checkpoint.remaining, "right", "left", "left")
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
  it("moves a group together and ignores a drop on itself", () => {
    const original = view();
    expect(moveWorkspaceGroup(original, "b", "a", "right")).toBe(original);
    const split = moveWorkspaceGroup(original, "a", "c", "down");
    expect(split.groups.a).toEqual(["a", "b"]);
    expect(leafIds(split.layout!)).toEqual(["c", "a"]);
    expect(moveWorkspaceGroup(original, "a", "c", "tab").groups.c).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
  it("inserts a moved group as an ordered block at the previewed header slot", () => {
    const original = resolveWorkspaceView(
      {
        ...view(),
        order: ["a", "b", "c", "d"],
        groups: { a: ["a", "b"], c: ["c", "d"] },
      },
      ["a", "b", "c", "d"],
      "a",
    );
    const joined = moveWorkspaceGroup(original, "a", "c", "tab", 1);
    expect(joined.groups.c).toEqual(["c", "a", "b", "d"]);
    expect(joined.order).toEqual(["c", "a", "b", "d"]);
    expect(joined.focusedId).toBe("c");
    expect(leafIds(joined.layout!)).toEqual(["c"]);
    expect(original.groups.a).toEqual(["a", "b"]);
  });
  it("clamps header slots and leaves center joins as append", () => {
    expect(moveWorkspaceGroup(view(), "a", "c", "tab", -1).groups.c).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(moveWorkspaceGroup(view(), "a", "c", "tab", 99).groups.c).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(moveWorkspaceGroup(view(), "a", "c", "tab", NaN).groups.c).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(moveWorkspaceGroup(view(), "a", "c", "tab").groups.c).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});
