import { describe, expect, it } from "vitest";
import { leaf, leafIds, type LayoutNode } from "./layout";
import { applyWorkspaceIntent } from "./workspaceIntents";
import {
  WORKSPACE_SPACES_KEY,
  addStripPane,
  applyStripView,
  combineStripTabs,
  entryKey,
  insertStripPane,
  resolveWorkspaceStrip,
  restoreStripSnapshot,
  stripCombineUndo,
  stripViewReshapes,
  stripViewWith,
  undoStripLayout,
  type StripEntry,
  type StripSpace,
  type WorkspaceStrip,
} from "./workspaceSpaces";
import { pairWorkspaceTabs, type WorkspaceView } from "./workspaceViews";

const columns = (...ids: string[]): LayoutNode => ({
  type: "split",
  id: `cols-${ids.join("-")}`,
  dir: "right",
  sizes: ids.map(() => 1 / ids.length),
  children: ids.map(leaf),
});
const space = (
  id: string,
  panes: string[],
  groups: Record<string, string[]> = {},
): StripEntry => ({
  kind: "space",
  id,
  view: {
    layout: columns(...panes),
    focusedId: panes[0],
    order: [...new Set([...panes, ...Object.values(groups).flat()])],
    groups: Object.fromEntries(
      panes.map((pane) => [pane, groups[pane] ?? [pane]]),
    ),
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
const SPLIT = "aven-space:s1";

/** A single chat, then a split of a chat and a page, then a file. */
const strip = (): WorkspaceStrip => ({
  entries: [item("notes"), space("s1", ["chat", "page"]), item("file")],
  front: "notes",
});

describe("a tab let go on a segment of a split's entry", () => {
  it("stands beside that segment's pane, on the side nearer the pointer", () => {
    const after = insertStripPane(strip(), SPLIT, "notes", "chat", "after");
    expect(keys(after)).toEqual(["split(chat|notes|page)", "file"]);
    // In front, the new pane focused, sharing the chat's room.
    expect(after.front).toBe(SPLIT);
    const made = spaceAt(after, 0).view;
    expect(made.focusedId).toBe("notes");
    expect(made.groups.notes).toEqual(["notes"]);
    expect(made.layout).toMatchObject({ sizes: [0.25, 0.25, 0.5] });

    const before = insertStripPane(strip(), SPLIT, "file", "chat", "before");
    expect(keys(before)).toEqual(["notes", "split(file|chat|page)"]);
    const end = insertStripPane(strip(), SPLIT, "file", "page", "after");
    expect(keys(end)).toEqual(["notes", "split(chat|page|file)"]);
  });

  it("moves a tab already in the split beside the segment it is let go on", () => {
    // The chat's own pane moves to the page's right.
    const moved = insertStripPane(strip(), SPLIT, "chat", "page", "after");
    expect(keys(moved)).toEqual(["notes", "split(page|chat)", "file"]);
    // A tab behind another in its pane leaves the stack for a pane of its own.
    const stacked: WorkspaceStrip = {
      entries: [space("s1", ["chat", "page"], { chat: ["chat", "draft"] })],
      front: SPLIT,
    };
    const out = insertStripPane(stacked, SPLIT, "draft", "page", "before");
    expect(keys(out)).toEqual(["split(chat|draft|page)"]);
    expect(spaceAt(out, 0).view.groups).toEqual({
      chat: ["chat"],
      draft: ["draft"],
      page: ["page"],
    });
    // On its own segment, nothing changes.
    expect(insertStripPane(strip(), SPLIT, "chat", "chat", "after")).toEqual(
      strip(),
    );
  });

  it("takes the tab out of another split, which comes apart if left with one pane", () => {
    const two: WorkspaceStrip = {
      entries: [space("s1", ["chat", "page"]), space("s2", ["notes", "file"])],
      front: "aven-space:s2",
    };
    const next = insertStripPane(two, SPLIT, "notes", "page", "before");
    expect(keys(next)).toEqual(["split(chat|notes|page)", "file"]);
  });

  it("joins at the split's right when the segment's pane is gone", () => {
    expect(insertStripPane(strip(), SPLIT, "notes", "gone", "before")).toEqual(
      addStripPane(strip(), SPLIT, "notes"),
    );
  });
});

describe("a pane's tab let go on the window strip's single tab", () => {
  it("leaves its split and makes a new one with the single tab, undoably", () => {
    // The split in front: its page's tab, from the pane's header.
    const before: WorkspaceStrip = { ...strip(), front: SPLIT };
    const undo = stripCombineUndo(before, "file", "page")!;
    const combined = combineStripTabs(before, "file", "page");
    // The split it left had one pane left, so came apart.
    expect(keys(combined)).toEqual(["notes", "chat", "split(file|page)"]);
    expect(combined.front).toBe(entryKey(spaceAt(combined, 2)));
    // Undo puts the whole strip back: the page in its split again, the
    // file alone, the split in front.
    expect(undo.strip).toEqual(before);
    const undone = restoreStripSnapshot(combined, undo.strip!);
    expect(undone).toEqual(before);
    // A version that knows only the view in the entry still takes the new
    // split apart.
    expect(keys(undoStripLayout(combined, undo.view, undo.entry)!)).toEqual([
      "notes",
      "chat",
      "file",
      "page",
    ]);
  });

  it("records no whole strip for a single tab, whose undo is the entry's", () => {
    expect(stripCombineUndo(strip(), "file", "notes")?.strip).toBeUndefined();
  });
});

describe("undoing a drop on a split's segment or entry", () => {
  it("puts the whole strip back, the tab where it was", () => {
    const two: WorkspaceStrip = {
      entries: [space("s1", ["chat", "page"]), space("s2", ["notes", "file"])],
      front: "aven-space:s2",
    };
    const inserted = insertStripPane(two, SPLIT, "notes", "page", "before");
    expect(restoreStripSnapshot(inserted, two)).toEqual(two);
    const added = addStripPane(strip(), SPLIT, "file");
    expect(restoreStripSnapshot(added, strip())).toEqual(strip());
  });

  it("keeps tabs opened since, beside the entry in front, and drops closed ones", () => {
    const inserted = insertStripPane(strip(), SPLIT, "notes", "chat", "after");
    // Since then: the file closed, a new chat opened.
    const now: WorkspaceStrip = {
      ...inserted,
      entries: [
        ...inserted.entries.filter(
          (entry) => entry.kind !== "item" || entry.id !== "file",
        ),
        item("fresh"),
      ],
    };
    const undone = restoreStripSnapshot(now, strip());
    expect(keys(undone)).toEqual(["notes", "fresh", "split(chat|page)"]);
    expect(undone.front).toBe("notes");
  });
});

describe("a tab let go on a tab in a pane's row", () => {
  /** The split in front: the chat's pane holds a draft behind it. */
  const view = (): WorkspaceView => ({
    layout: columns("chat", "page"),
    focusedId: "chat",
    order: ["chat", "draft", "page"],
    groups: { chat: ["chat", "draft"], page: ["page"] },
  });

  it("stands beside it in a pane of its own, that tab in front of its pane", () => {
    // The page let go on the draft, behind the chat.
    const paired = pairWorkspaceTabs(view(), "page", "draft");
    expect(leafIds(paired.layout!)).toEqual(["draft", "page"]);
    expect(paired.groups).toEqual({ draft: ["chat", "draft"], page: ["page"] });
    expect(paired.focusedId).toBe("page");
    // The draft let go on the chat, in its own row.
    const row = pairWorkspaceTabs(view(), "draft", "chat");
    expect(leafIds(row.layout!)).toEqual(["chat", "draft", "page"]);
    expect(row.groups).toEqual({
      chat: ["chat"],
      draft: ["draft"],
      page: ["page"],
    });
    // On itself, nothing changes.
    const same = view();
    expect(pairWorkspaceTabs(same, "chat", "chat")).toBe(same);
  });

  it("brings a single tab from the strip in beside it, as an intent that undoes", () => {
    const before: WorkspaceStrip = {
      entries: [item("notes"), { ...space("s1", ["chat", "page"]) }],
      front: SPLIT,
    };
    (before.entries[1] as StripSpace).view = view();
    const intent = { type: "pair" as const, id: "notes", target: "page" };
    // As App applies it: the tab joins the view in front for the move.
    const front = stripViewWith(before, ["notes"]);
    const { view: next, keep } = applyWorkspaceIntent(front, intent);
    expect(keep).toEqual(["notes", "page"]);
    const after = applyStripView(before, next);
    expect(keys(after)).toEqual(["split(chat|page|notes)"]);
    // The tab left the strip, so the view in front alone cannot undo the
    // move: Undo layout puts the whole strip back, the tab on its own.
    expect(stripViewReshapes(before, next)).toBe(true);
    const undone = restoreStripSnapshot(after, before);
    expect(keys(undone)).toEqual(["notes", "split(chat|page)"]);
    expect(spaceAt(undone, 1).view.groups).toEqual(view().groups);
    expect(undone.front).toBe(SPLIT);
  });
});

describe("a strip changed by a drop on any tab, in storage", () => {
  it("is written and read under the same key and shape", () => {
    expect(WORKSPACE_SPACES_KEY).toBe("aven.workspaceSpaces.v1");
    const changed = insertStripPane(strip(), SPLIT, "notes", "chat", "after");
    const stored = JSON.parse(
      JSON.stringify({ version: 1, projects: { "/p": changed } }),
    ) as { projects: Record<string, WorkspaceStrip> };
    const entry = stored.projects["/p"].entries[0];
    expect(Object.keys(entry).sort()).toEqual(["id", "kind", "view"]);
    expect(entryKey(entry)).toBe(SPLIT);
    expect(Object.keys((entry as StripSpace).view).sort()).toEqual([
      "focusedId",
      "groups",
      "layout",
      "order",
    ]);
    const read = resolveWorkspaceStrip(
      stored.projects["/p"],
      ["notes", "chat", "page", "file"],
      "",
      () => {
        throw new Error("a stored strip needs no fallback");
      },
    );
    expect(read).toEqual(changed);
  });
});
