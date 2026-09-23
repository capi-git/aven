import { describe, expect, it } from "vitest";
import { leafIds, newTab } from "./layout";
import { openAgentFileInTabs } from "./agentFiles";

describe("agent-requested files", () => {
  it("opens beside the requesting task rather than an unrelated active tab", () => {
    const other = newTab("other-session");
    const own = newTab("own-session");
    const opened = openAgentFileInTabs(
      [other, own],
      "own-session",
      "/project",
      "/project/My Notes.md",
      new Set(),
    );
    expect(opened.tabId).toBe(own.id);
    expect(opened.tabs[0]).toBe(other);
    expect(
      opened.tabs[1].editorPanes
        .flatMap((pane) => pane.files)
        .map((file) => file.path),
    ).toEqual(["/project/My Notes.md"]);
    expect(leafIds(opened.tabs[1].layout)).toContain("own-session");
  });

  it("reuses an existing editor tab on repeated opens", () => {
    const first = openAgentFileInTabs(
      [newTab("s")],
      "s",
      "/project",
      "/project/README.md",
      new Set(),
    );
    const again = openAgentFileInTabs(
      first.tabs,
      "s",
      "/project",
      "/project/README.md",
      new Set(),
    );
    expect(
      again.tabs[0].editorPanes.flatMap((pane) => pane.files),
    ).toHaveLength(1);
  });

  it("never opens an absent or detached task in another task's editor", () => {
    const own = newTab("s");
    expect(() =>
      openAgentFileInTabs([own], "missing", "/p", "/p/a.md", new Set()),
    ).toThrow("no longer available");
    expect(() =>
      openAgentFileInTabs([own], "s", "/p", "/p/a.md", new Set([own.id])),
    ).toThrow("no longer available");
  });
});
