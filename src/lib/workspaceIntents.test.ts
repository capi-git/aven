import { describe, expect, it } from "vitest";
import { leaf, leafIds, type LayoutNode } from "./layout";
import {
  applyWorkspaceIntent,
  hiddenSplitStatus,
  neighborCombineTargets,
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

  it("minimizes a side and restores the original split", () => {
    const before = grouped();
    const minimized = applyWorkspaceIntent(before, {
      type: "minimize",
      split: "columns",
      index: 0,
      side: "after",
    });
    expect(leafIds(minimized.view.layout!)).toEqual(["chat-a"]);
    expect(minimized.view.hiddenGroups).toEqual({
      "chat-b": ["chat-b", "browser-b", "chat-c"],
    });
    expect(minimized.keep).toEqual([]);
    const restored = applyWorkspaceIntent(minimized.view, { type: "restore" });
    expect(restored.view.layout).toEqual(before.layout);
    expect(restored.view.groups).toEqual(before.groups);
    expect(restored.keep).toEqual([]);
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
  const minimized = () =>
    applyWorkspaceIntent(grouped(), {
      type: "minimize",
      split: "columns",
      index: 0,
      side: "after",
    }).view;
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
