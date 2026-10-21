import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  leaf,
  newChangesTab,
  newEditorPane,
  newFileTab,
  newPlanTab,
  newTerminalFile,
  splitPane,
  type WorkspaceTab,
} from "./layout";
import {
  NO_OPEN_FILES,
  filesOpenInTabs,
  openFilesSnapshot,
  rememberMentionedFile,
  resetOpenFiles,
  setOpenFiles,
  subscribeOpenFiles,
} from "./openFiles";

function tabOf(id: string, ...panes: ReturnType<typeof newEditorPane>[]) {
  let layout = leaf("chat");
  for (const pane of panes)
    layout = splitPane(layout, "chat", "right", pane.id);
  return {
    kind: "session",
    id,
    layout,
    focusedId: "chat",
    editorPanes: panes,
    terminalPanes: [],
  } satisfies WorkspaceTab;
}

describe("filesOpenInTabs", () => {
  it("lists the active tab's files first, each pane's shown file before the rest", () => {
    const readme = newFileTab("/repo/README.md", "/repo");
    const notes = newFileTab("/Users/me/Documents/notes.md", "/repo");
    const pane = { ...newEditorPane(readme), files: [readme, notes] };
    pane.activeFileId = notes.id;
    const other = newFileTab("/other/main.rs", "/other");
    const tabs = [tabOf("other", newEditorPane(other)), tabOf("active", pane)];

    expect(filesOpenInTabs(tabs, "active")).toEqual([
      "/Users/me/Documents/notes.md",
      "/repo/README.md",
      "/other/main.rs",
    ]);
  });

  it("keeps files on disk only, once each", () => {
    const file = newFileTab("/repo/a.md", "/repo");
    const review = newFileTab("/repo/a.md", "/repo", true);
    const pane = {
      ...newEditorPane(file),
      files: [
        file,
        review,
        newPlanTab("session", "block", "Plan", "/repo"),
        newChangesTab("/repo"),
        newTerminalFile("/repo"),
      ],
    };
    expect(filesOpenInTabs([tabOf("tab", pane)], "tab")).toEqual([
      "/repo/a.md",
    ]);
  });
});

describe("open files store", () => {
  beforeEach(() => resetOpenFiles());

  it("tells listeners only when the open files change", () => {
    const listener = vi.fn();
    const stop = subscribeOpenFiles(listener);
    setOpenFiles(["/a.md", "/b.md"]);
    setOpenFiles(["/a.md", "/b.md"]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(openFilesSnapshot()).toEqual({
      open: ["/a.md", "/b.md"],
      known: ["/a.md", "/b.md"],
    });
    stop();
    setOpenFiles([]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(openFilesSnapshot()).toBe(NO_OPEN_FILES);
  });

  it("still knows a mentioned file after its tab closes", () => {
    setOpenFiles(["/Users/me/Documents/notes.md"]);
    rememberMentionedFile("/Users/me/Documents/notes.md");
    setOpenFiles(["/repo/a.md"]);
    expect(openFilesSnapshot()).toEqual({
      open: ["/repo/a.md"],
      known: ["/repo/a.md", "/Users/me/Documents/notes.md"],
    });
  });

  it("lists the latest mentions first and keeps a bounded number", () => {
    for (let i = 0; i < 105; i++) rememberMentionedFile(`/m/${i}.md`);
    const { known } = openFilesSnapshot();
    expect(known).toHaveLength(100);
    expect(known[0]).toBe("/m/104.md");
    expect(known).not.toContain("/m/4.md");
  });
});
