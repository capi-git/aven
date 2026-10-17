import { describe, expect, it } from "vitest";
import {
  BOARD_TAB_TITLE,
  boardTabFor,
  editorTabKey,
  isBoardTab,
  isFilesystemTab,
  isVirtualDocumentTab,
  leafIds,
  newBoardWorkspaceTab,
  newTab,
} from "./layout";
import { sameProjectPath } from "./recents";
import {
  collectWorkspaceSnapshot,
  hydrateWorkspaceSnapshot,
  parseWorkspaceSnapshot,
} from "./workspaceSnapshot";

describe("a project's board tab", () => {
  it("opens as a workspace tab holding one board pane", () => {
    const tab = newBoardWorkspaceTab("/work/site");
    expect(tab.editorPanes).toHaveLength(1);
    const [file] = tab.editorPanes[0].files;
    expect(leafIds(tab.layout)).toEqual([tab.editorPanes[0].id]);
    expect(tab.focusedId).toBe(tab.editorPanes[0].id);
    expect(file).toMatchObject({
      path: BOARD_TAB_TITLE,
      cwd: "/work/site",
      board: { project: "/work/site" },
    });
    expect(isBoardTab(file)).toBe(true);
    // A board is no file: it is never saved, watched or diffed.
    expect(isVirtualDocumentTab(file)).toBe(true);
    expect(isFilesystemTab(file)).toBe(false);
    expect(editorTabKey(file)).toBe("board:/work/site");
  });

  it("is found again for its project, so opening it twice focuses the first", () => {
    const chat = newTab("chat");
    const site = newBoardWorkspaceTab("/work/site");
    const other = newBoardWorkspaceTab("/work/other");
    const tabs = [chat, site, other];
    expect(boardTabFor(tabs, "/work/site/", sameProjectPath)).toBe(site);
    expect(boardTabFor(tabs, "/work/other", sameProjectPath)).toBe(other);
    expect(boardTabFor([chat], "/work/site", sameProjectPath)).toBeUndefined();
  });

  it("is saved with the workspace and restored after a restart", () => {
    const chat = newTab("chat");
    const board = newBoardWorkspaceTab("/work/site");
    const snapshot = collectWorkspaceSnapshot(
      [chat, board],
      [],
      board.id,
      "/work/site",
    );
    const saved = JSON.parse(JSON.stringify(snapshot));
    const parsed = parseWorkspaceSnapshot(saved)!;
    expect(parsed.activeTabId).toBe(board.id);
    expect(parsed.tabs[1]).toEqual(board);

    const restored = hydrateWorkspaceSnapshot(saved, new Map())!;
    expect(restored.activeTabId).toBe(board.id);
    const file = restored.tabs.find((tab) => tab.id === board.id)!
      .editorPanes[0].files[0];
    expect(file.board).toEqual({ project: "/work/site" });
    expect(boardTabFor(restored.tabs, "/work/site", sameProjectPath)?.id).toBe(
      board.id,
    );
  });

  it("drops a saved board that names no project", () => {
    const board = newBoardWorkspaceTab("/work/site");
    const saved = JSON.parse(
      JSON.stringify({
        tabs: [newTab("chat"), board],
        sessions: [],
        activeTabId: board.id,
        projectCwd: "/work/site",
      }),
    );
    saved.tabs[1].editorPanes[0].files[0].board = { project: "" };
    const parsed = parseWorkspaceSnapshot(saved)!;
    expect(parsed.tabs.map((tab) => tab.id)).toEqual([saved.tabs[0].id]);
  });
});
