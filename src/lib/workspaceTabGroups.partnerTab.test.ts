import { describe, expect, it } from "vitest";
import {
  leafIds,
  newDiscussionTab,
  newTab,
  showDiscussionInTabs,
  splitPane,
  type WorkspaceTab,
} from "./layout";
import { insertTabBesideSession } from "./workspaceTabGroups";

function tab(id: string, sessionId: string, groupId?: string): WorkspaceTab {
  return { ...newTab(sessionId), id, ...(groupId ? { groupId } : {}) };
}

const SITE = (id: string) => (id.startsWith("api") ? "api" : "site");

const discussion = {
  id: "d1",
  topic: "Should we cache the lookups?",
  a: { sessionId: "a", cwd: "/work/site" },
  b: { sessionId: "b" },
};

/**
 * A discussion with a new chat: the chat waits in a tab behind the one that
 * started it (as `openPartner` adds it), then the page opens (as
 * `openDiscussionView` shows it).
 */
function startWithNewChat(tabs: WorkspaceTab[], active: string) {
  const partner = tab("partner", "b");
  const withPartner = insertTabBesideSession(tabs, partner, "a", active, SITE);
  const shown = showDiscussionInTabs(
    withPartner,
    newDiscussionTab(discussion),
  )!;
  return { withPartner, shown };
}

describe("a new chat a discussion starts", () => {
  it("waits in a tab right after the starting chat's, in its group", () => {
    const before = [
      tab("t0", "x"),
      tab("t1", "a", "g"),
      tab("t2", "y", "g"),
      tab("t3", "z"),
    ];
    const { withPartner } = startWithNewChat(before, "t1");
    expect(withPartner.map((entry) => entry.id)).toEqual([
      "t0",
      "t1",
      "partner",
      "t2",
      "t3",
    ]);
    expect(withPartner[2].groupId).toBe("g");
    expect(leafIds(withPartner[2].layout)).toEqual(["b"]);
    // No other tab changed: nothing split, nothing refocused.
    for (const entry of before)
      expect(withPartner.find((next) => next.id === entry.id)).toBe(entry);
  });

  it("then only the page opens, beside the starting chat", () => {
    const { withPartner, shown } = startWithNewChat([tab("t1", "a")], "t1");
    expect(shown.tabId).toBe("t1");
    const host = shown.tabs.find((entry) => entry.id === "t1")!;
    const page = host.editorPanes[0];
    expect(page.files[0].discussion?.discussionId).toBe("d1");
    // The starting chat and the page; the new chat is not a pane here.
    expect(leafIds(host.layout)).toEqual(["a", page.id]);
    expect(host.focusedId).toBe(page.id);
    const partner = shown.tabs.find((entry) => entry.id === "partner");
    expect(partner).toBe(withPartner[1]);
  });

  it("finds the starting chat inside a split tab", () => {
    const split: WorkspaceTab = {
      ...tab("t1", "x"),
      layout: splitPane(leafOf("x"), "x", "right", "a"),
    };
    const { withPartner } = startWithNewChat([split, tab("t2", "y")], "t2");
    expect(withPartner.map((entry) => entry.id)).toEqual([
      "t1",
      "partner",
      "t2",
    ]);
    expect(leafIds(withPartner[0].layout)).toEqual(["x", "a"]);
  });

  it("stays out of a group that belongs to another project", () => {
    const { withPartner } = startWithNewChat(
      [tab("api-1", "a", "g"), tab("api-2", "y", "g")],
      "api-1",
    );
    expect(withPartner.map((entry) => entry.id)).toEqual([
      "api-1",
      "partner",
      "api-2",
    ]);
    expect(withPartner[1].groupId).toBeUndefined();
  });

  it("goes after the tab in front when the starting chat has no tab here", () => {
    const { withPartner } = startWithNewChat(
      [tab("t1", "x"), tab("t2", "y"), tab("t3", "z")],
      "t2",
    );
    expect(withPartner.map((entry) => entry.id)).toEqual([
      "t1",
      "t2",
      "partner",
      "t3",
    ]);
  });
});

describe("a discussion with a chat that is already open", () => {
  it("leaves that chat where it is and opens only the page", () => {
    const partner = tab("t2", "b");
    const tabs = [tab("t1", "a"), partner];
    const shown = showDiscussionInTabs(tabs, newDiscussionTab(discussion))!;
    expect(shown.tabId).toBe("t1");
    expect(shown.tabs[1]).toBe(partner);
    const host = shown.tabs[0];
    expect(leafIds(host.layout)).toEqual(["a", host.editorPanes[0].id]);
  });
});

function leafOf(id: string) {
  return newTab(id).layout;
}
