import { describe, expect, it } from "vitest";
import { leaf, leafIds, type LayoutNode } from "./layout";
import {
  applyStripView,
  entryKey,
  focusStripTab,
  isSpaceKey,
  reorderStripEntries,
  resolveWorkspaceStrip,
  stepStripEntry,
  stripEntryAt,
  stripEntryFocus,
  stripFromView,
  stripItems,
  stripView,
  stripViewWith,
  type StripEntry,
  type WorkspaceStrip,
} from "./workspaceSpaces";
import {
  closeWorkspaceViews,
  moveWorkspaceTab,
  reorderWorkspaceGroup,
  resolveWorkspaceView,
  selectWorkspaceView,
  splitWorkspaceView,
  toggleWorkspaceExpansion,
  type WorkspaceView,
} from "./workspaceViews";

const columns = (a: string, b: string): LayoutNode => ({
  type: "split",
  id: `${a}-${b}`,
  dir: "right",
  sizes: [0.5, 0.5],
  children: [leaf(a), leaf(b)],
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
      : `space(${leafIds(entry.view.layout!).join("|")})`,
  );
const noFallback = (): WorkspaceView => {
  throw new Error("unexpected migration");
};

/** chat | web as a space, between two single tabs. */
function mixed(): WorkspaceStrip {
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
    front: "notes",
  };
}
const ALL = ["notes", "chat", "web", "docs", "board"];

describe("workspace spaces", () => {
  it("migrates a split arrangement to one space, and one pane to its tabs", () => {
    const split = resolveWorkspaceView(
      {
        layout: columns("chat", "web"),
        focusedId: "web",
        order: ["chat", "web", "docs"],
        groups: { chat: ["chat"], web: ["web", "docs"] },
      },
      ["chat", "web", "docs"],
      "chat",
    );
    const migrated = stripFromView(split);
    expect(migrated.entries).toHaveLength(1);
    expect(migrated.entries[0]).toMatchObject({ kind: "space", view: split });
    expect(isSpaceKey(migrated.front)).toBe(true);
    expect(stripView(migrated)).toEqual(split);

    const single = resolveWorkspaceView(
      {
        layout: leaf("b"),
        focusedId: "b",
        order: ["a", "b", "c"],
        groups: { b: ["a", "b", "c"] },
      },
      ["a", "b", "c"],
      "a",
    );
    expect(stripFromView(single)).toEqual({
      entries: [item("a"), item("b"), item("c")],
      front: "b",
    });
  });

  it("starts from the former arrangement when nothing is stored", () => {
    const strip = resolveWorkspaceStrip(undefined, ["a", "b"], "a", () =>
      resolveWorkspaceView(undefined, ["a", "b"], "a"),
    );
    expect(strip).toEqual({ entries: [item("a"), item("b")], front: "a" });
  });

  it("round-trips through storage unchanged", () => {
    const strip = resolveWorkspaceStrip(mixed(), ALL, "notes", noFallback);
    const stored = JSON.parse(JSON.stringify(strip));
    expect(resolveWorkspaceStrip(stored, ALL, "notes", noFallback)).toEqual(
      strip,
    );
  });

  it("shows a single tab in front as one pane of every single tab", () => {
    const view = stripView(mixed());
    expect(view.layout).toEqual(leaf("notes"));
    expect(view.groups).toEqual({ notes: ["notes", "board"] });
    expect(stripItems(mixed())).toEqual(["notes", "board"]);
  });

  it("shows a space in front as its own arrangement", () => {
    const strip = { ...mixed(), front: "aven-space:s1" };
    expect(stripView(strip).layout).toEqual(columns("chat", "web"));
    expect(stripView(strip).groups.web).toEqual(["web", "docs"]);
  });

  it("drops closed tabs and comes apart when a space is down to one pane", () => {
    const strip = resolveWorkspaceStrip(
      { ...mixed(), front: "aven-space:s1" },
      ["notes", "web", "docs", "board"],
      "notes",
      noFallback,
    );
    expect(keys(strip)).toEqual(["notes", "web", "docs", "board"]);
    // The space was in front; its tab in front now is.
    expect(strip.front).toBe("web");
  });

  it("puts new tabs in the focused pane of a space in front", () => {
    const strip = resolveWorkspaceStrip(
      { ...mixed(), front: "aven-space:s1" },
      [...ALL, "fresh"],
      "notes",
      noFallback,
    );
    const front = strip.entries[1];
    expect(front.kind === "space" && front.view.groups.web).toContain("fresh");
    expect(stripItems(strip)).toEqual(["notes", "board"]);
  });

  it("puts new tabs beside a single tab in front", () => {
    const strip = resolveWorkspaceStrip(
      mixed(),
      [...ALL, "fresh"],
      "notes",
      noFallback,
    );
    expect(keys(strip)).toEqual(["notes", "fresh", "space(chat|web)", "board"]);
  });

  it("keeps each tab in one entry", () => {
    const strip = resolveWorkspaceStrip(
      { entries: [item("a"), item("a"), item("b")], front: "a" },
      ["a", "b"],
      "a",
      noFallback,
    );
    expect(keys(strip)).toEqual(["a", "b"]);
  });

  it("selects another single tab", () => {
    const strip = mixed();
    const next = applyStripView(
      strip,
      selectWorkspaceView(stripView(strip), "board"),
    );
    expect(next.front).toBe("board");
    expect(keys(next)).toEqual(keys(strip));
  });

  it("turns a single tab and the one dragged onto its edge into a space in its place", () => {
    const strip: WorkspaceStrip = {
      entries: [item("a"), item("b"), item("c"), item("d")],
      front: "b",
    };
    const split = splitWorkspaceView(stripView(strip), "d", "right", "b");
    const next = applyStripView(strip, split);
    expect(keys(next)).toEqual(["a", "space(b|d)", "c"]);
    expect(isSpaceKey(next.front)).toBe(true);
    const view = stripView(next);
    expect(view.groups).toEqual({ b: ["b"], d: ["d"] });
    expect(view.focusedId).toBe("d");
  });

  it("comes apart into single tabs when panes close until one remains", () => {
    const strip = { ...mixed(), front: "aven-space:s1" };
    const next = applyStripView(
      strip,
      closeWorkspaceViews(stripView(strip), ["chat"], "web"),
    );
    expect(keys(next)).toEqual(["notes", "web", "docs", "board"]);
    expect(next.front).toBe("web");
  });

  it("brings a single tab into the space in front, taking it off the strip", () => {
    const strip = { ...mixed(), front: "aven-space:s1" };
    const view = stripViewWith(strip, ["board"]);
    const next = applyStripView(strip, moveWorkspaceTab(view, "board", "chat"));
    expect(keys(next)).toEqual(["notes", "space(chat|web)"]);
    expect(stripView(next).groups.chat).toEqual(["chat", "board"]);
  });

  it("reorders single tabs around spaces, which keep their places", () => {
    const strip: WorkspaceStrip = {
      entries: [
        item("a"),
        space("s1", stripView({ ...mixed(), front: "aven-space:s1" })),
        item("b"),
        item("c"),
      ],
      front: "a",
    };
    const next = applyStripView(
      strip,
      reorderWorkspaceGroup(stripView(strip), "a", ["c", "a", "b"]),
    );
    expect(keys(next)).toEqual(["c", "space(chat|web)", "a", "b"]);
  });

  it("brings the entry holding a tab to the front, selecting it in its space", () => {
    const next = focusStripTab(mixed(), "docs");
    expect(next.front).toBe("aven-space:s1");
    expect(stripView(next).focusedId).toBe("docs");
    expect(focusStripTab(mixed(), "missing")).toEqual(mixed());
  });

  it("steps the strip round and picks entries by place", () => {
    const strip = mixed();
    expect(stepStripEntry(strip, 1)).toBe("aven-space:s1");
    expect(stepStripEntry(strip, -1)).toBe("board");
    expect(stepStripEntry({ ...strip, front: "board" }, 1)).toBe("notes");
    expect(stripEntryAt(strip, 0)).toBe("notes");
    expect(stripEntryAt(strip, -1)).toBe("board");
    expect(stripEntryAt(strip, 7)).toBeUndefined();
    expect(stripEntryFocus(strip, "aven-space:s1")).toBe("web");
  });

  it("reorders entries, keeping the ones it does not name after them", () => {
    const next = reorderStripEntries(mixed(), ["board", "notes"]);
    expect(next.entries.map(entryKey)).toEqual([
      "board",
      "notes",
      "aven-space:s1",
    ]);
  });

  it("keeps an expanded pane's space whole, and restores its split", () => {
    const strip = { ...mixed(), front: "aven-space:s1" };
    const zoomed = applyStripView(
      strip,
      toggleWorkspaceExpansion(stripView(strip), "web"),
    );
    expect(keys(zoomed)).toEqual(["notes", "space(web)", "board"]);
    const restored = applyStripView(
      zoomed,
      toggleWorkspaceExpansion(stripView(zoomed), "web"),
    );
    expect(keys(restored)).toEqual(keys(strip));
  });
});
