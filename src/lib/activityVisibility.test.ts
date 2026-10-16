import { describe, expect, it } from "vitest";
import { visibleActivitySessionIds } from "./activityVisibility";
import {
  leaf,
  newDiscussionTab,
  newFileTab,
  newTab,
  openEditorTab,
  showDiscussionInTabs,
} from "./layout";

const split = {
  ...newTab("a"),
  id: "tab1",
  layout: {
    type: "split" as const,
    id: "split",
    dir: "right" as const,
    children: [leaf("a"), leaf("b")],
    sizes: [0.5, 0.5],
  },
};
const other = { ...newTab("c"), id: "tab2" };
const base = {
  workspaceVisible: true,
  visibleSurfaceIds: ["tab1"],
  tabs: [split, other],
  sessionIds: new Set(["a", "b", "c"]),
  floatingSessionIds: [],
};
describe("Activity transcript visibility", () => {
  it("includes both visible chat siblings and excludes retained background tabs", () => {
    expect([...visibleActivitySessionIds(base)]).toEqual(["a", "b"]);
  });
  it("includes another visible surface but never mistakes a browser surface for a task", () => {
    expect([
      ...visibleActivitySessionIds({
        ...base,
        visibleSurfaceIds: ["tab1", "tab2", "browser:1"],
      }),
    ]).toEqual(["a", "b", "c"]);
  });
  it("keeps covered tasks unread on Home, Settings or full browser", () => {
    expect(
      visibleActivitySessionIds({ ...base, workspaceVisible: false }).size,
    ).toBe(0);
    expect(
      visibleActivitySessionIds({ ...base, visibleSurfaceIds: ["browser:1"] })
        .size,
    ).toBe(0);
  });
  it("counts a discussion's page on screen as showing both of its chats", () => {
    // The page beside "a"; the partner "c" waits in a tab behind it.
    const page = showDiscussionInTabs(
      [{ ...newTab("a"), id: "tab1" }, other],
      newDiscussionTab({
        id: "d1",
        topic: "Topic",
        a: { sessionId: "a", cwd: "/work" },
        b: { sessionId: "c" },
      }),
    )!.tabs;
    const shown = { ...base, tabs: page, sessionIds: new Set(["a", "c"]) };
    expect([...visibleActivitySessionIds(shown)].sort()).toEqual(["a", "c"]);
    // Another file in front of the page in its pane hides it.
    const covered = page.map((tab) =>
      tab.id === "tab1"
        ? openEditorTab(tab, newFileTab("/work/notes.md", "/work"))
        : tab,
    );
    expect([...visibleActivitySessionIds({ ...shown, tabs: covered })]).toEqual(
      ["a"],
    );
    // A page in a tab behind shows nothing.
    expect(
      visibleActivitySessionIds({ ...shown, visibleSurfaceIds: ["tab2"] }).has(
        "a",
      ),
    ).toBe(false);
  });
  it("excludes floating placeholders and editor/terminal leaves", () => {
    expect([
      ...visibleActivitySessionIds({
        ...base,
        floatingSessionIds: ["a"],
        sessionIds: new Set(["a"]),
      }),
    ]).toEqual([]);
  });
});
