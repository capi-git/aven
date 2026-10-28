import { describe, expect, it } from "vitest";
import { leaf, leafIds, type LayoutNode } from "./layout";
import {
  addStripPane,
  detachStripTab,
  focusStripTab,
  resolveWorkspaceStrip,
  separateStripSpace,
  spacePanes,
  stripView,
  type StripEntry,
  type WorkspaceStrip,
} from "./workspaceSpaces";
import { toggleWorkspaceExpansion, type WorkspaceView } from "./workspaceViews";

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
