import { describe, expect, it } from "vitest";
import {
  discussionTabTitle,
  editorTabKey,
  isFilesystemTab,
  leafIds,
  newDiscussionTab,
  newTab,
  newFileTab,
  openEditorTab,
  showDiscussionInTabs,
  splitPane,
  type WorkspaceTab,
} from "./layout";
import {
  collectWorkspaceSnapshot,
  parseWorkspaceSnapshot,
} from "./workspaceSnapshot";

const discussion = {
  id: "d1",
  topic: "Should we cache the lookups?\nMore detail here.",
  a: { sessionId: "a", cwd: "/work/site" },
  b: { sessionId: "b" },
};

describe("discussion tabs", () => {
  it("names the tab after the topic's first line and keys it by discussion", () => {
    const file = newDiscussionTab(discussion);
    expect(file.discussion).toEqual({
      discussionId: "d1",
      a: "a",
      b: "b",
      title: "Should we cache the lookups?",
    });
    expect(editorTabKey(file)).toBe("discussion:d1");
    expect(isFilesystemTab(file)).toBe(false);
    expect(discussionTabTitle("x".repeat(80))).toHaveLength(48);
    expect(discussionTabTitle("  ")).toBe("Discussion");
  });

  it("opens beside the chat that started it, leaving a partner beside it there", () => {
    // A with the chat it discusses with already split beside it, focused.
    const tab: WorkspaceTab = {
      ...newTab("a"),
      layout: splitPane(newTab("a").layout, "a", "right", "b"),
      focusedId: "b",
    };
    const shown = showDiscussionInTabs([tab], newDiscussionTab(discussion))!;
    expect(shown.tabId).toBe(tab.id);
    const next = shown.tabs[0];
    const pane = next.editorPanes[0];
    expect(pane.files[0].discussion?.discussionId).toBe("d1");
    expect(leafIds(next.layout)).toEqual(["a", pane.id, "b"]);
    // Focused, so it is what the user sees next.
    expect(next.focusedId).toBe(pane.id);
    expect(pane.activeFileId).toBe(pane.files[0].id);
  });

  it("joins an editor pane the tab already has", () => {
    const tab = openEditorTab(
      newTab("a"),
      newFileTab("/work/site/a.ts", "/work/site"),
    );
    const shown = showDiscussionInTabs([tab], newDiscussionTab(discussion))!;
    const pane = shown.tabs[0].editorPanes[0];
    expect(pane.files.map((file) => editorTabKey(file))).toEqual([
      "file:/work/site/a.ts",
      "discussion:d1",
    ]);
    expect(shown.tabs[0].editorPanes).toHaveLength(1);
  });

  it("focuses the page where it is already open instead of opening another", () => {
    const other = newTab("x");
    const first = showDiscussionInTabs(
      [other, newTab("a")],
      newDiscussionTab(discussion),
    )!;
    // The user moved on to another file in that pane.
    const moved = first.tabs.map((tab) =>
      tab.id === first.tabId
        ? openEditorTab(tab, newFileTab("/work/site/b.ts", "/work/site"))
        : tab,
    );
    const again = showDiscussionInTabs(moved, newDiscussionTab(discussion))!;
    expect(again.tabId).toBe(first.tabId);
    const pane = again.tabs.find((tab) => tab.id === first.tabId)!
      .editorPanes[0];
    expect(
      pane.files.filter((file) => file.discussion?.discussionId === "d1"),
    ).toHaveLength(1);
    expect(
      pane.files.find((file) => file.id === pane.activeFileId)?.discussion,
    ).toBeTruthy();
  });

  it("falls back to the partner's tab, and to nothing when neither chat is here", () => {
    const partner = newTab("b");
    expect(
      showDiscussionInTabs([partner], newDiscussionTab(discussion))?.tabId,
    ).toBe(partner.id);
    expect(
      showDiscussionInTabs([newTab("x")], newDiscussionTab(discussion)),
    ).toBeNull();
  });

  it("survives a reload with the workspace", () => {
    const shown = showDiscussionInTabs(
      [newTab("a")],
      newDiscussionTab(discussion),
    )!;
    const snapshot = collectWorkspaceSnapshot(
      shown.tabs,
      [],
      shown.tabId,
      "/work/site",
    );
    const parsed = parseWorkspaceSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(parsed?.tabs[0].editorPanes[0].files[0].discussion).toEqual({
      discussionId: "d1",
      a: "a",
      b: "b",
      title: "Should we cache the lookups?",
    });
    // A damaged source drops that tab, not the workspace.
    const damaged = JSON.parse(JSON.stringify(snapshot));
    damaged.tabs[0].editorPanes[0].files[0].discussion = { a: "a" };
    expect(
      parseWorkspaceSnapshot(damaged)?.tabs[0]?.editorPanes[0]?.files ?? [],
    ).toHaveLength(0);
  });
});
