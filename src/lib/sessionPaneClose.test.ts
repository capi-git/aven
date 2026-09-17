import { describe, expect, it } from "vitest";
import {
  closeLeaf,
  leafIds,
  newFileTab,
  newTab,
  newTerminalFile,
  openEditorTab,
  openTerminalTab,
  splitPane,
} from "./layout";
import { resolvePaneCloseTab } from "./sessionPaneClose";

describe("resolvePaneCloseTab", () => {
  it("targets a nested session in an unfocused outer tab", () => {
    const active = newTab("active-session");
    const owner = newTab("left");
    owner.layout = splitPane(owner.layout, "left", "right", "right-top");
    owner.layout = splitPane(owner.layout, "right-top", "down", "right-bottom");
    owner.focusedId = "right-bottom";

    const target = resolvePaneCloseTab(
      [active, owner],
      active.id,
      "right-bottom",
    );
    expect(target).toBe(owner);
    const remaining = closeLeaf(target!, "right-bottom")!;
    expect(leafIds(remaining.layout)).toEqual(["left", "right-top"]);
    expect(remaining.focusedId).toBe("right-top");
    expect(leafIds(active.layout)).toEqual(["active-session"]);
    expect(leafIds(owner.layout)).toEqual([
      "left",
      "right-top",
      "right-bottom",
    ]);
  });

  it("uses the active tab for the keyboard close command", () => {
    const first = newTab("first");
    const active = newTab("active");
    expect(resolvePaneCloseTab([first, active], active.id)).toBe(active);
  });

  it("resolves file and terminal leaves by their owning tab", () => {
    const active = newTab("active");
    const fileOwner = openEditorTab(
      newTab("file-session"),
      newFileTab("/repo/a.ts", "/repo"),
    );
    const terminalOwner = openTerminalTab(
      newTab("terminal-session"),
      newTerminalFile("/repo"),
    );
    const tabs = [active, fileOwner, terminalOwner];
    expect(
      resolvePaneCloseTab(tabs, active.id, fileOwner.editorPanes[0].id),
    ).toBe(fileOwner);
    expect(
      resolvePaneCloseTab(tabs, active.id, terminalOwner.terminalPanes[0].id),
    ).toBe(terminalOwner);
  });

  it("does not close the active tab when an explicit pane no longer exists", () => {
    const active = newTab("active");
    expect(
      resolvePaneCloseTab([active], active.id, "closed-pane"),
    ).toBeUndefined();
    expect(resolvePaneCloseTab([active], active.id, "")).toBeUndefined();
  });

  it("ignores stale pane metadata that is absent from the layout", () => {
    const owner = openEditorTab(
      newTab("session"),
      newFileTab("/repo/a.ts", "/repo"),
    );
    const staleId = owner.editorPanes[0].id;
    owner.layout = { type: "leaf", id: "session" };
    expect(resolvePaneCloseTab([owner], owner.id, staleId)).toBeUndefined();
  });

  it("does not silently fall back when the active tab has closed", () => {
    const other = newTab("other");
    expect(resolvePaneCloseTab([other], "closed-tab")).toBeUndefined();
    expect(resolvePaneCloseTab([], "closed-tab")).toBeUndefined();
    expect(resolvePaneCloseTab([other], "closed-tab", "other")).toBe(other);
  });
});
