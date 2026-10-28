import { describe, expect, it } from "vitest";
import { leaf, leafIds, type LayoutNode } from "./layout";
import {
  addStripPane,
  applyStripView,
  detachStripTab,
  focusStripTab,
  keepUnseenStripEntries,
  resolveWorkspaceStrip,
  separateStripSpace,
  spacePanes,
  stripView,
  undoStripLayout,
  type StripEntry,
  type WorkspaceStrip,
} from "./workspaceSpaces";
import {
  closeWorkspaceViews,
  splitWorkspaceView,
  toggleWorkspaceExpansion,
  type WorkspaceView,
} from "./workspaceViews";

const columns = (...ids: string[]): LayoutNode => ({
  type: "split",
  id: `cols-${ids.join("-")}`,
  dir: "right",
  sizes: ids.map(() => 1 / ids.length),
  children: ids.map(leaf),
});
const rows = (...ids: string[]): LayoutNode => ({
  type: "split",
  id: `rows-${ids.join("-")}`,
  dir: "down",
  sizes: ids.map(() => 1 / ids.length),
  children: ids.map(leaf),
});
const space = (id: string, view: WorkspaceView): StripEntry => ({
  kind: "space",
  id,
  view,
});
const item = (id: string): StripEntry => ({ kind: "item", id });
const keys = (strip: WorkspaceStrip) =>
  strip.entries.map((entry) =>
    entry.kind === "item"
      ? entry.id
      : `split(${leafIds(entry.view.layout!).join("|")})`,
  );

/** notes, then chat | web (web holding docs behind it), then board. */
function strip(front = "notes"): WorkspaceStrip {
  return {
    entries: [
      item("notes"),
      space("s1", {
        layout: columns("chat", "web"),
        focusedId: "web",
        order: ["chat", "web", "docs"],
        groups: { chat: ["chat"], web: ["web", "docs"] },
      }),
      item("board"),
    ],
    front,
  };
}

describe("a split's panes", () => {
  it("lists each pane by its tab in front, in arrangement order", () => {
    const view = (strip().entries[1] as { view: WorkspaceView }).view;
    expect(spacePanes(view)).toEqual([
      { id: "chat", tabs: ["chat"] },
      { id: "web", tabs: ["web", "docs"] },
    ]);
  });

  it("keeps a pane tucked behind an expanded one in its place", () => {
    const view = (strip().entries[1] as { view: WorkspaceView }).view;
    const expanded = toggleWorkspaceExpansion(view, "web");
    expect(leafIds(expanded.layout!)).toEqual(["web"]);
    expect(spacePanes(expanded).map((pane) => pane.id)).toEqual([
      "chat",
      "web",
    ]);
  });
});

describe("one click on a segment", () => {
  it("brings a split forward with that pane focused and its tab shown", () => {
    // The split is behind notes; docs sits behind web in its pane.
    const next = focusStripTab(strip(), "docs");
    expect(next.front).toBe("aven-space:s1");
    const view = stripView(next);
    expect(view.focusedId).toBe("docs");
    expect(leafIds(view.layout!)).toEqual(["chat", "docs"]);
    expect(view.groups.docs).toEqual(["web", "docs"]);
  });
});

describe("a tab dropped on a split's entry", () => {
  it("joins the split as a new pane at its right, and the split comes forward", () => {
    const next = addStripPane(strip(), "aven-space:s1", "notes");
    expect(keys(next)).toEqual(["split(chat|web|notes)", "board"]);
    expect(next.front).toBe("aven-space:s1");
    const view = stripView(next);
    expect(view.focusedId).toBe("notes");
    expect(view.groups.notes).toEqual(["notes"]);
    // Three columns of a third each.
    expect(view.layout).toMatchObject({
      type: "split",
      dir: "right",
      sizes: [1 / 3, 1 / 3, 1 / 3],
    });
  });

  it("puts a column beside a split that is stacked", () => {
    const stacked: WorkspaceStrip = {
      entries: [
        space("s2", {
          layout: rows("a", "b"),
          focusedId: "a",
          order: ["a", "b"],
          groups: { a: ["a"], b: ["b"] },
        }),
        item("c"),
      ],
      front: "c",
    };
    const next = addStripPane(stacked, "aven-space:s2", "c");
    const layout = stripView(next).layout!;
    expect(layout).toMatchObject({ type: "split", dir: "right" });
    expect(leafIds(layout)).toEqual(["a", "b", "c"]);
  });

  it("takes a tab out of another split, which comes apart if one pane is left", () => {
    const two: WorkspaceStrip = {
      entries: [
        ...strip().entries,
        space("s2", {
          layout: columns("x", "y"),
          focusedId: "x",
          order: ["x", "y"],
          groups: { x: ["x"], y: ["y"] },
        }),
      ],
      front: "notes",
    };
    const next = addStripPane(two, "aven-space:s1", "y");
    expect(keys(next)).toEqual(["notes", "split(chat|web|y)", "board", "x"]);
  });

  it("leaves a split alone for its own tab", () => {
    const before = strip();
    expect(addStripPane(before, "aven-space:s1", "docs")).toBe(before);
    expect(addStripPane(before, "notes", "board")).toBe(before);
  });
});

describe("a segment pulled out of its split onto the strip", () => {
  it("stands alone where it was let go; a split left with one pane comes apart", () => {
    const next = detachStripTab(strip(), "chat", "notes");
    expect(keys(next)).toEqual(["chat", "notes", "web", "docs", "board"]);
    expect(next.front).toBe("notes");
    expect(keys(detachStripTab(strip(), "chat", null))).toEqual([
      "notes",
      "web",
      "docs",
      "board",
      "chat",
    ]);
  });

  it("keeps focus with the tab that had it", () => {
    // The split in front had focus on web: it comes apart with web in front.
    expect(detachStripTab(strip("aven-space:s1"), "chat", null).front).toBe(
      "web",
    );
    // Pulling out the focused tab itself brings it forward alone.
    const three: WorkspaceStrip = addStripPane(
      strip(),
      "aven-space:s1",
      "board",
    );
    const next = detachStripTab(three, "board", "notes");
    expect(keys(next)).toEqual(["board", "notes", "split(chat|web)"]);
    expect(next.front).toBe("board");
  });

  it("leaves a single tab where it is", () => {
    const before = strip();
    expect(detachStripTab(before, "notes", "board")).toBe(before);
  });
});

describe("Separate split", () => {
  it("puts its tabs on the strip in its place, pane by pane", () => {
    const next = separateStripSpace(strip("aven-space:s1"), "aven-space:s1");
    expect(keys(next)).toEqual(["notes", "chat", "web", "docs", "board"]);
    // Its focused tab stays in front.
    expect(next.front).toBe("web");
    expect(separateStripSpace(strip(), "aven-space:s1").front).toBe("notes");
  });

  it("round-trips through storage as single tabs", () => {
    const next = separateStripSpace(strip(), "aven-space:s1");
    const stored = JSON.parse(JSON.stringify(next));
    expect(
      resolveWorkspaceStrip(
        stored,
        ["notes", "chat", "web", "docs", "board"],
        "notes",
        () => {
          throw new Error("unexpected migration");
        },
      ),
    ).toEqual(next);
  });
});

/** x | y, then a single tab, then a | b. */
function twoSplits(front: string): WorkspaceStrip {
  const pair = (one: string, two: string): WorkspaceView => ({
    layout: columns(one, two),
    focusedId: one,
    order: [one, two],
    groups: { [one]: [one], [two]: [two] },
  });
  return {
    entries: [
      space("s1", pair("x", "y")),
      item("f"),
      space("s2", pair("a", "b")),
    ],
    front,
  };
}

describe("closing the only single tab in front", () => {
  it("brings its neighbour forward, not the first entry", () => {
    const before = twoSplits("f");
    const next = applyStripView(
      before,
      closeWorkspaceViews(stripView(before), ["f"], ""),
    );
    expect(keys(next)).toEqual(["split(x|y)", "split(a|b)"]);
    expect(next.front).toBe("aven-space:s2");
  });
});

describe("a tab let go on its own split's chip", () => {
  it("stands where the split stood", () => {
    const next = detachStripTab(strip(), "chat", "aven-space:s1");
    expect(keys(next)).toEqual(["notes", "chat", "web", "docs", "board"]);
  });

  it("still goes before another entry it is let go on", () => {
    const next = detachStripTab(strip(), "chat", "notes");
    expect(keys(next)).toEqual(["chat", "notes", "web", "docs", "board"]);
  });
});

describe("undoing a layout change", () => {
  it("returns to the split it was made in, not the one in front", () => {
    let current = twoSplits("aven-space:s1");
    const snapshot = stripView(current);
    current = applyStripView(
      current,
      splitWorkspaceView(stripView(current), "f", "down", "y"),
    );
    // The user looks at the other split, then undoes.
    current = focusStripTab(current, "a");
    expect(current.front).toBe("aven-space:s2");
    const undone = undoStripLayout(current, snapshot, "aven-space:s1")!;
    expect(undone.front).toBe("aven-space:s1");
    expect(keys(undone)).toEqual(["split(x|y)", "f", "split(a|b)"]);
    const s2 = undone.entries.find((entry) => entry.id === "s2");
    expect(s2?.kind === "space" && leafIds(s2.view.layout!)).toEqual([
      "a",
      "b",
    ]);
  });

  it("finds a single tab's change in the split it became", () => {
    const current = twoSplits("f");
    const snapshot = stripView(current);
    const split = applyStripView(
      current,
      splitWorkspaceView(
        { ...snapshot, groups: { f: ["f", "a"] }, order: ["f", "a"] },
        "a",
        "right",
        "f",
      ),
    );
    expect(split.front).not.toBe("f");
    const undone = undoStripLayout(split, snapshot, "f")!;
    expect(keys(undone)).toContain("f");
    expect(undone.front).toBe("f");
  });

  it("changes nothing once none of the entry's tabs is left", () => {
    const current = twoSplits("aven-space:s2");
    const gone: WorkspaceView = {
      layout: columns("p", "q"),
      focusedId: "p",
      order: ["p", "q"],
      groups: { p: ["p"], q: ["q"] },
    };
    expect(undoStripLayout(current, gone, "aven-space:old")).toBeNull();
  });
});

describe("a write that sees only some of a project's tabs", () => {
  const all = ["x", "y", "f", "a", "b"];
  it("keeps the stored entries it could not see in their places", () => {
    const stored = twoSplits("f");
    const partial = resolveWorkspaceStrip(stored, ["home"], "home", () => {
      throw new Error("unexpected migration");
    });
    const written = keepUnseenStripEntries(
      stored,
      partial,
      new Set(["home"]),
      (id) => all.includes(id),
    );
    const back = resolveWorkspaceStrip(written, all, "f", () => {
      throw new Error("unexpected migration");
    });
    expect(keys(back)).toEqual(["split(x|y)", "f", "split(a|b)"]);
  });

  it("lets entries of closed tabs go", () => {
    const stored = twoSplits("f");
    const partial = resolveWorkspaceStrip(stored, ["x", "y"], "x", () => {
      throw new Error("unexpected migration");
    });
    const written = keepUnseenStripEntries(
      stored,
      partial,
      new Set(["x", "y"]),
      (id) => id !== "f",
    );
    expect(keys(written)).toEqual(["split(x|y)", "split(a|b)"]);
  });
});
