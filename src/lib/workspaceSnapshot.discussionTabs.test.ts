import { describe, expect, it } from "vitest";
import {
  leaf,
  leafIds,
  newEditorPane,
  newFileTab,
  newTab,
  type FilePaneTab,
  type WorkspaceTab,
} from "./layout";
import {
  collectWorkspaceSnapshot,
  parseWorkspaceSnapshot,
} from "./workspaceSnapshot";

/** A discussion's page tab as an earlier version saved it. */
const page: FilePaneTab = {
  id: "page",
  path: "discussion:d1",
  cwd: "/work/site",
  discussion: {
    discussionId: "d1",
    a: "a",
    b: "b",
    title: "Should we cache the lookups?",
  },
};

/** The chat that started it, with the page split beside it. */
function besideChat(files: FilePaneTab[]): WorkspaceTab {
  const pane = newEditorPane(files[0]);
  return {
    ...newTab("a"),
    id: "tab-a",
    layout: {
      type: "split",
      id: "split",
      dir: "right",
      children: [leaf("a"), leaf(pane.id)],
      sizes: [0.5, 0.5],
    },
    editorPanes: [{ ...pane, files, activeFileId: files[0].id }],
  };
}

function saved(tabs: WorkspaceTab[]) {
  return JSON.parse(
    JSON.stringify({
      tabs,
      sessions: [],
      activeTabId: tabs[0].id,
      projectCwd: "/work/site",
    }),
  );
}

describe("a discussion's page tab from an earlier version", () => {
  it("is dropped when the workspace is restored, leaving the chat beside it", () => {
    const restored = parseWorkspaceSnapshot(saved([besideChat([page])]))!;
    expect(restored.tabs).toHaveLength(1);
    expect(leafIds(restored.tabs[0].layout)).toEqual(["a"]);
    expect(restored.tabs[0].editorPanes).toEqual([]);
  });

  it("leaves the other files in its pane", () => {
    const notes = newFileTab("/work/site/notes.md", "/work/site");
    const restored = parseWorkspaceSnapshot(
      saved([besideChat([page, notes])]),
    )!;
    expect(
      restored.tabs[0].editorPanes[0].files.map((file) => file.id),
    ).toEqual([notes.id]);
    expect(restored.tabs[0].editorPanes[0].activeFileId).toBe(notes.id);
  });

  it("drops a tab that held only the page, and keeps the rest", () => {
    const alone: WorkspaceTab = {
      ...newTab("x"),
      ...(() => {
        const pane = newEditorPane(page);
        return {
          id: "tab-page",
          layout: leaf(pane.id),
          focusedId: pane.id,
          editorPanes: [pane],
        };
      })(),
    };
    const chat = { ...newTab("c"), id: "tab-c" };
    const restored = parseWorkspaceSnapshot(saved([alone, chat]))!;
    expect(restored.tabs.map((tab) => tab.id)).toEqual(["tab-c"]);
    expect(restored.activeTabId).toBe("tab-c");
  });

  it("is never saved again", () => {
    const snapshot = collectWorkspaceSnapshot(
      [besideChat([page])],
      [],
      "tab-a",
      "/work/site",
    );
    expect(JSON.stringify(snapshot)).not.toContain("discussion:d1");
    expect(leafIds(snapshot.tabs[0].layout)).toEqual(["a"]);
  });
});
