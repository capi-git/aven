import { describe, expect, it } from "vitest";
import { leaf, leafIds, type LayoutNode } from "./layout";
import {
  combineStripTabs,
  entryKey,
  joinStripSplit,
  resolveWorkspaceStrip,
  stripCombineUndo,
  stripDropKeeps,
  undoStripLayout,
  WORKSPACE_SPACES_KEY,
  type StripEntry,
  type StripSpace,
  type WorkspaceStrip,
} from "./workspaceSpaces";
import type { WorkspaceView } from "./workspaceViews";

const columns = (...ids: string[]): LayoutNode => ({
  type: "split",
  id: `cols-${ids.join("-")}`,
  dir: "right",
  sizes: ids.map(() => 1 / ids.length),
  children: ids.map(leaf),
});
const space = (id: string, ...panes: string[]): StripEntry => ({
  kind: "space",
  id,
  view: {
    layout: columns(...panes),
    focusedId: panes[0],
    order: panes,
    groups: Object.fromEntries(panes.map((pane) => [pane, [pane]])),
  },
});
const item = (id: string): StripEntry => ({ kind: "item", id });
const keys = (strip: WorkspaceStrip) =>
  strip.entries.map((entry) =>
    entry.kind === "item"
      ? entry.id
      : `split(${leafIds(entry.view.layout!).join("|")})`,
  );
const spaceAt = (strip: WorkspaceStrip, at: number) =>
  strip.entries[at] as StripSpace;

/** A chat, a page and a file as single tabs. */
const singles = (front = "chat"): WorkspaceStrip => ({
  entries: [item("chat"), item("page"), item("file")],
  front,
});

describe("a tab let go on a single tab's middle", () => {
  it("makes a split in the single tab's place: it on the left, the tab let go on the right, half each", () => {
    const next = combineStripTabs(singles(), "page", "file");
    expect(keys(next)).toEqual(["chat", "split(page|file)"]);
    const made = spaceAt(next, 1);
    expect(made.view.layout).toMatchObject({
      type: "split",
      dir: "right",
      sizes: [0.5, 0.5],
      children: [leaf("page"), leaf("file")],
    });
    // In front, with the tab let go focused.
    expect(next.front).toBe(entryKey(made));
    expect(made.view.focusedId).toBe("file");
    expect(made.view.groups).toEqual({ page: ["page"], file: ["file"] });
  });

  it("works leftward along the strip too, and for any kind of tab", () => {
    // The iPhone let go on the chat at the start of the strip.
    const strip: WorkspaceStrip = {
      entries: [item("chat"), item("page"), item("iphone")],
      front: "page",
    };
    const next = combineStripTabs(strip, "chat", "iphone");
    expect(keys(next)).toEqual(["split(chat|iphone)", "page"]);
    expect(spaceAt(next, 0).view.focusedId).toBe("iphone");
  });

  it("changes nothing for itself, a split or a tab not on the strip", () => {
    const strip = singles();
    expect(combineStripTabs(strip, "page", "page")).toBe(strip);
    expect(combineStripTabs(strip, "page", "gone")).toBe(strip);
    const withSplit: WorkspaceStrip = {
      entries: [item("chat"), space("s1", "page", "file")],
      front: "chat",
    };
    // A split is not a single tab to combine into (it takes a pane).
    expect(combineStripTabs(withSplit, "page", "chat")).toBe(withSplit);
  });
});

describe("a segment pulled out of a split, let go on a single tab", () => {
  it("leaves its split and makes a new one with the single tab", () => {
    const strip: WorkspaceStrip = {
      entries: [item("notes"), space("s1", "chat", "page", "file")],
      front: "aven-space:s1",
    };
    const next = combineStripTabs(strip, "notes", "page");
    expect(keys(next)).toEqual(["split(notes|page)", "split(chat|file)"]);
    expect(next.front).toBe(entryKey(spaceAt(next, 0)));
    expect(spaceAt(next, 0).view.focusedId).toBe("page");
  });

  it("takes apart a split left with one pane", () => {
    const strip: WorkspaceStrip = {
      entries: [space("s1", "chat", "page"), item("notes")],
      front: "aven-space:s1",
    };
    const next = combineStripTabs(strip, "notes", "page");
    expect(keys(next)).toEqual(["chat", "split(notes|page)"]);
    expect(next.front).toBe(entryKey(spaceAt(next, 1)));
  });
});

describe("a split let go on a single tab's middle", () => {
  it("takes the tab as a pane at its right, standing in the tab's place", () => {
    const strip: WorkspaceStrip = {
      entries: [item("notes"), space("s1", "chat", "page"), item("file")],
      front: "notes",
    };
    const s1 = spaceAt(strip, 1);
    const withFocus: WorkspaceStrip = {
      ...strip,
      entries: [
        strip.entries[0],
        { ...s1, view: { ...s1.view, focusedId: "page" } },
        strip.entries[2],
      ],
    };
    const next = joinStripSplit(withFocus, "aven-space:s1", "notes");
    expect(keys(next)).toEqual(["split(chat|page|notes)", "file"]);
    expect(next.front).toBe("aven-space:s1");
    // The split keeps its own focus; its panes share the width.
    const joined = spaceAt(next, 0);
    expect(joined.view.focusedId).toBe("page");
    const layout = joined.view.layout as Extract<LayoutNode, { type: "split" }>;
    expect(layout.sizes.reduce((total, size) => total + size)).toBeCloseTo(1);

    // Dropped rightward, on the tab after it.
    const right = joinStripSplit(strip, "aven-space:s1", "file");
    expect(keys(right)).toEqual(["notes", "split(chat|page|file)"]);
  });

  it("changes nothing for a tab already in a split", () => {
    const strip: WorkspaceStrip = {
      entries: [space("s1", "chat", "page"), space("s2", "notes", "file")],
      front: "aven-space:s1",
    };
    expect(joinStripSplit(strip, "aven-space:s1", "notes")).toBe(strip);
  });
});

describe("undoing a split made on the strip", () => {
  it("takes it apart into its single tabs again", () => {
    const before = singles("page");
    const undo = stripCombineUndo(before, "chat", "file")!;
    expect(undo.entry).toBe("chat");
    const combined = combineStripTabs(before, "chat", "file");
    const undone = undoStripLayout(combined, undo.view, undo.entry)!;
    // Both stand alone again, nothing lost, the single tab in front; the
    // tab let go stays beside it.
    expect(keys(undone)).toEqual(["chat", "file", "page"]);
    expect(undone.front).toBe("chat");
  });

  it("takes apart a split made from a segment pulled out of another", () => {
    const before: WorkspaceStrip = {
      entries: [item("notes"), space("s1", "chat", "page", "file")],
      front: "notes",
    };
    const undo = stripCombineUndo(before, "notes", "page")!;
    const combined = combineStripTabs(before, "notes", "page");
    const undone = undoStripLayout(combined, undo.view, undo.entry)!;
    expect(keys(undone)).toEqual(["notes", "page", "split(chat|file)"]);
  });

  it("is not offered for a split taking a pane", () => {
    const strip: WorkspaceStrip = {
      entries: [item("notes"), space("s1", "chat", "page")],
      front: "notes",
    };
    expect(stripCombineUndo(strip, "notes", "aven-space:s1")).toBeNull();
    expect(stripCombineUndo(singles(), "page", "page")).toBeNull();
  });
});

describe("pages a drop on the strip brings together", () => {
  it("are kept, so a preview page combined is no longer the preview", () => {
    // A preview page let go on a tab, and a tab let go on a preview page.
    expect(stripDropKeeps("chat", "preview")).toEqual(["chat", "preview"]);
    expect(stripDropKeeps("preview", "chat")).toEqual(["preview", "chat"]);
    // A preview page let go on a split, or a split let go on it.
    expect(stripDropKeeps("aven-space:s1", "preview")).toEqual(["preview"]);
    expect(stripDropKeeps("preview", "aven-space:s1")).toEqual(["preview"]);
  });
});

describe("a combined strip in storage", () => {
  it("is written and read as an ordinary split under the same key", () => {
    expect(WORKSPACE_SPACES_KEY).toBe("aven.workspaceSpaces.v1");
    const combined = combineStripTabs(singles(), "page", "file");
    // What useWorkspaceViews writes, read back as an older or newer Aven
    // would read it.
    const stored = JSON.parse(
      JSON.stringify({ version: 1, projects: { "/p": combined } }),
    ) as { projects: Record<string, WorkspaceStrip> };
    const entry = stored.projects["/p"].entries[1];
    expect(Object.keys(entry).sort()).toEqual(["id", "kind", "view"]);
    expect(Object.keys((entry as { view: WorkspaceView }).view).sort()).toEqual(
      ["focusedId", "groups", "layout", "order"],
    );
    const read = resolveWorkspaceStrip(
      stored.projects["/p"],
      ["chat", "page", "file"],
      "",
      () => {
        throw new Error("a stored strip needs no fallback");
      },
    );
    expect(keys(read)).toEqual(["chat", "split(page|file)"]);
    expect(read.front).toBe(combined.front);
    expect(spaceAt(read, 1).view.focusedId).toBe("file");
  });
});
