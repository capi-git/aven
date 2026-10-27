import { describe, expect, it } from "vitest";
import {
  editorTabKey,
  isFilesystemTab,
  isProjectView,
  isSimulatorTab,
  isVirtualDocumentTab,
  newSimulatorTab,
  newTab,
  openEditorTab,
  simulatorProjectOf,
} from "./layout";
import { parseWorkspaceSnapshot } from "./workspaceSnapshot";

describe("the iPhone tab", () => {
  it("is a project view, not a file", () => {
    const tab = newSimulatorTab("/work/pom");
    expect(isSimulatorTab(tab)).toBe(true);
    expect(isProjectView(tab)).toBe(true);
    expect(isVirtualDocumentTab(tab)).toBe(true);
    expect(isFilesystemTab(tab)).toBe(false);
    expect(editorTabKey(tab)).toBe("simulator:/work/pom");
  });

  it("opens beside the chat once and tells which project it shows", () => {
    const chat = newTab("session-1");
    expect(simulatorProjectOf(chat)).toBeNull();
    const opened = openEditorTab(chat, newSimulatorTab("/work/pom"));
    expect(opened.editorPanes).toHaveLength(1);
    expect(opened.layout.type).toBe("split");
    expect(simulatorProjectOf(opened)).toBe("/work/pom");
    const again = openEditorTab(opened, newSimulatorTab("/work/pom"));
    expect(again.editorPanes[0].files).toHaveLength(1);
  });
});

describe("saved iPhone tabs", () => {
  it("survive a workspace save and restore, and a damaged one is dropped", () => {
    const opened = openEditorTab(
      newTab("session-1"),
      newSimulatorTab("/work/pom"),
    );
    const saved = JSON.parse(
      JSON.stringify({
        tabs: [opened],
        sessions: [],
        activeTabId: opened.id,
        projectCwd: "/work/pom",
      }),
    );
    const restored = parseWorkspaceSnapshot(saved);
    const file = restored?.tabs[0].editorPanes[0].files[0];
    expect(file?.simulator).toEqual({ project: "/work/pom" });
    expect(isSimulatorTab(file!)).toBe(true);

    saved.tabs[0].editorPanes[0].files[0].simulator = { project: 3 };
    const damaged = parseWorkspaceSnapshot(saved);
    expect(damaged?.tabs[0].editorPanes[0]?.files ?? []).toEqual([]);
  });
});
