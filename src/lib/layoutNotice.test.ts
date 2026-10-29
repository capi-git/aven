import { describe, expect, it } from "vitest";
import { leaf, type LayoutNode } from "./layout";
import {
  describeStripChange,
  panePlace,
  quoteList,
  quoteTitle,
  stripTabLocation,
} from "./layoutNotice";
import {
  addStripPane,
  combineStripTabs,
  detachStripTab,
  entryKey,
  insertStripPane,
  joinStripSplit,
  separateStripSpace,
  stripEntryKeyOf,
  stripView,
  applyStripView,
  type StripEntry,
  type WorkspaceStrip,
} from "./workspaceSpaces";
import { closeWorkspaceViews, type WorkspaceView } from "./workspaceViews";

const columns = (...ids: string[]): LayoutNode => ({
  type: "split",
  id: `cols-${ids.join("-")}`,
  dir: "right",
  sizes: ids.map(() => 1 / ids.length),
  children: ids.map(leaf),
});
const item = (id: string): StripEntry => ({ kind: "item", id });
const space = (id: string, view: WorkspaceView): StripEntry => ({
  kind: "space",
  id,
  view,
});
const NAMES: Record<string, string> = {
  pricing: "Pricing — WorkOS",
  signup: "Add sign-up flow",
  site: "linking.coaching",
  hero: "Tighten the hero layout on small phones",
  footer: "Footer links on mobile",
  docs: "Docs",
};
const name = (id: string) => NAMES[id] ?? id;

/** hero, then signup | site, then footer and pricing. */
function strip(front = "hero"): WorkspaceStrip {
  return {
    entries: [
      item("hero"),
      space("s1", {
        layout: columns("signup", "site"),
        focusedId: "signup",
        order: ["signup", "site", "docs"],
        groups: { signup: ["signup"], site: ["site", "docs"] },
      }),
      item("footer"),
      item("pricing"),
    ],
    front,
  };
}

describe("quoting titles", () => {
  it("quotes, tidies and shortens a title", () => {
    expect(quoteTitle("  Pricing —\n WorkOS ")).toBe("“Pricing — WorkOS”");
    expect(quoteTitle(NAMES.hero)).toBe(
      "“Tighten the hero layout on small ph…”",
    );
    expect(quoteTitle("")).toBe("“Untitled”");
  });

  it("names one, two, or two and how many more", () => {
    expect(quoteList(["A"])).toBe("“A”");
    expect(quoteList(["A", "B"])).toBe("“A” and “B”");
    expect(quoteList(["A", "B", "C"])).toBe("“A” and 2 more");
  });
});

describe("the notice after a move", () => {
  it("says a tab moved into the split, and where it landed", () => {
    const before = strip();
    const after = addStripPane(before, "aven-space:s1", "pricing");
    expect(describeStripChange(before, after, "pricing", name)).toEqual({
      text: "Moved “Pricing — WorkOS” into the split with “Add sign-up flow” and “linking.coaching”.",
      landed: { entry: "aven-space:s1", pane: "pricing" },
    });
    const beside = insertStripPane(
      before,
      "aven-space:s1",
      "pricing",
      "signup",
      "after",
    );
    expect(
      describeStripChange(before, beside, "pricing", name)?.landed,
    ).toEqual({ entry: "aven-space:s1", pane: "pricing" });
  });

  it("says a new split was made when two single tabs combine", () => {
    const before = strip();
    const after = combineStripTabs(before, "footer", "pricing");
    const change = describeStripChange(before, after, "pricing", name)!;
    expect(change.text).toBe(
      "Moved “Pricing — WorkOS” into a split with “Footer links on mobile”.",
    );
    expect(change.landed?.entry).toBe(stripEntryKeyOf(after, "pricing"));
  });

  it("names the tab a split was let go on as the one that moved", () => {
    const before = strip();
    const after = joinStripSplit(before, "aven-space:s1", "pricing");
    expect(describeStripChange(before, after, "pricing", name)?.text).toBe(
      "Moved “Pricing — WorkOS” into the split with “Add sign-up flow” and “linking.coaching”.",
    );
  });

  it("says a tab left a split, and that the tab left behind stays where the split was", () => {
    const before = strip("aven-space:s1");
    const after = detachStripTab(before, "signup", null);
    expect(after.front).toBe("signup");
    expect(describeStripChange(before, after, "signup", name)).toEqual({
      text: "Moved “Add sign-up flow” out of the split with “linking.coaching”. “linking.coaching” stays on its own, where the split was.",
      landed: { entry: "signup" },
    });
  });

  it("says a split was separated", () => {
    const before = strip("aven-space:s1");
    const after = separateStripSpace(before, "aven-space:s1");
    expect(describeStripChange(before, after, null, name)?.text).toBe(
      "Separated “Add sign-up flow” and “linking.coaching”.",
    );
  });

  it("says what closed and that the tab left stays in front, in the split's place", () => {
    const before = strip("aven-space:s1");
    const closed = applyStripView(
      before,
      closeWorkspaceViews(stripView(before), ["site", "docs"], "signup"),
    );
    // The tab left stands where the split stood, in front.
    expect(closed.entries.map(entryKey)).toEqual([
      "hero",
      "signup",
      "footer",
      "pricing",
    ]);
    expect(closed.front).toBe("signup");
    expect(describeStripChange(before, closed, null, name)?.text).toBe(
      "Closed “linking.coaching” and “Docs”. “Add sign-up flow” stays on its own, where the split was.",
    );
    // A tab gone to another window is not called closed.
    expect(
      describeStripChange(before, closed, null, name, () => true)?.text,
    ).toBe("“Add sign-up flow” stays on its own, where the split was.");
  });

  it("says nothing for a reorder, a focus change or a move inside a split", () => {
    const before = strip();
    expect(
      describeStripChange(before, { ...before, front: "footer" }, null, name),
    ).toBeNull();
    expect(
      describeStripChange(
        before,
        { ...before, entries: [...before.entries].reverse() },
        "hero",
        name,
      ),
    ).toBeNull();
    const inside = {
      ...before,
      entries: before.entries.map((entry) =>
        entry.kind === "space"
          ? {
              ...entry,
              view: {
                ...entry.view,
                groups: { signup: ["signup", "docs"], site: ["site"] },
              },
            }
          : entry,
      ),
    };
    expect(describeStripChange(before, inside, "docs", name)).toBeNull();
  });
});

describe("where a tab lives, for search", () => {
  it("names the split, the pane's place and the tab in front of it", () => {
    const at = strip();
    expect(stripTabLocation(at, "site", name)).toBe(
      "In the split with “Add sign-up flow” · right pane",
    );
    expect(stripTabLocation(at, "signup", name)).toBe(
      "In the split with “linking.coaching” · left pane",
    );
    expect(stripTabLocation(at, "docs", name)).toBe(
      "In the split with “Add sign-up flow” · right pane, behind “linking.coaching”",
    );
    // A single tab on the strip is just there.
    expect(stripTabLocation(at, "hero", name)).toBeNull();
  });

  it("names corners, rows and collapsed panes", () => {
    const view: WorkspaceView = {
      layout: {
        type: "split",
        id: "row",
        dir: "right",
        sizes: [0.5, 0.5],
        children: [
          { ...leaf("hero"), rail: 0.5 },
          {
            type: "split",
            id: "column",
            dir: "down",
            sizes: [0.5, 0.5],
            children: [leaf("signup"), leaf("site")],
          },
        ],
      },
      focusedId: "signup",
      order: ["hero", "signup", "site"],
      groups: { hero: ["hero"], signup: ["signup"], site: ["site"] },
    };
    expect(panePlace(view, "signup")).toBe("top-right pane");
    expect(panePlace(view, "site")).toBe("bottom-right pane");
    const at: WorkspaceStrip = {
      entries: [space("s", view)],
      front: "aven-space:s",
    };
    expect(stripTabLocation(at, "hero", name)).toBe(
      "In the split with “Add sign-up flow” and “linking.coaching” · collapsed left pane",
    );
  });
});
