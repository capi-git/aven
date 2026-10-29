import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ nativeGlass: true }));
vi.mock("./platform", () => ({
  IS_MAC: true,
  get HAS_NATIVE_GLASS() {
    return platform.nativeGlass;
  },
}));

import { searchSettings, settingSearchAnchor } from "./settingsSearch";

describe("settings search", () => {
  beforeEach(() => {
    platform.nativeGlass = true;
  });

  it.each([
    ["permissions", "Default access for new chats", "tasks"],
    ["queued", "While an agent is working, new messages", "tasks"],
    ["memory", "Memory saver", "browser"],
    ["ram", "Memory saver", "browser"],
    ["sleeping tabs", "Memory saver", "browser"],
    ["lightweight", "Use less memory for web pages", "browser"],
    ["low-end", "Use less memory for web pages", "browser"],
    ["do not disturb", "Quiet mode", "notifications"],
    ["wallpaper", "Chat background", "appearance"],
    ["text size", "Interface scale", "appearance"],
    ["status bar", "Glass", "appearance"],
    ["blur", "Glass", "appearance"],
    ["see through", "Glass", "appearance"],
    ["accent", "Accent colour", "appearance"],
    ["color", "Accent colour", "appearance"],
    ["copy workspaces", "Use for all workspaces", "appearance"],
    ["hotkeys", "Keybindings", "keybindings"],
    ["default model", "Providers", "providers"],
    ["cli updates", "Keep provider tools up to date", "providers"],
    ["recover project", "Archived projects", "archive"],
    ["recover chat", "Archived chats", "archive"],
  ])("finds %s in the correct section", (query, label, section) => {
    expect(searchSettings(query)).toContainEqual(
      expect.objectContaining({
        id: settingSearchAnchor(label),
        label,
        section,
      }),
    );
  });

  it("distinguishes app updates from provider tool updates", () => {
    expect(searchSettings("app updates").map(({ label }) => label)).toEqual([
      "Version",
    ]);
    expect(
      searchSettings("provider updates").map(({ label }) => label),
    ).toEqual(["Keep provider tools up to date"]);
  });

  it("ranks an exact label before related descriptions and normalizes input", () => {
    expect(searchSettings("  THÉME  ")[0].label).toBe("Theme");
    expect(searchSettings("follow-up")[0].label).toBe(
      "While an agent is working, new messages",
    );
    expect(searchSettings("followup")[0].label).toBe(
      "While an agent is working, new messages",
    );
  });

  it("requires every term and returns no invented settings", () => {
    expect(searchSettings("queue wallpaper")).toEqual([]);
    expect(searchSettings("quantum teleporter")).toEqual([]);
    expect(searchSettings("custom fonts")).toEqual([]);
    expect(searchSettings("   ")).toEqual([]);
    expect(searchSettings("!!!")).toEqual([]);
  });

  it("does not offer native glass controls on unsupported platforms", () => {
    expect(searchSettings("opacity")[0].label).toBe("Glass");
    platform.nativeGlass = false;
    expect(searchSettings("opacity")).toEqual([]);
    expect(searchSettings("glass").map(({ label }) => label)).not.toContain(
      "Glass",
    );
    expect(searchSettings("blur radius")).toEqual([]);
    expect(searchSettings("include workspace")).toEqual([]);
    expect(searchSettings("theme")[0].label).toBe("Theme");
  });

  it("leads the old window controls to Glass and no longer offers removed settings", () => {
    for (const query of [
      "background opacity",
      "blur radius",
      "include workspace",
      "status bar opacity",
    ])
      expect(searchSettings(query)[0]?.label, query).toBe("Glass");
    const removed = [
      "Workspace colors",
      "Background opacity",
      "Blur radius",
      "Include workspace",
      "Status bar opacity",
      "Match sidebars to workspace",
      "Sidebar colour",
      "Same appearance across workspaces",
    ];
    for (const label of removed)
      expect(
        searchSettings(label).map((result) => result.label),
        label,
      ).not.toContain(label);
    expect(searchSettings("match sidebars")).toEqual([]);
    expect(searchSettings("sidebar colour")).toEqual([]);
  });

  it("targets stable parent cards for controls that may not yet be visible", () => {
    expect(searchSettings("background visibility")).toContainEqual(
      expect.objectContaining({ id: "setting-chat-background" }),
    );
    expect(searchSettings("highlight")).toContainEqual(
      expect.objectContaining({ id: "setting-accent-colour" }),
    );
  });

  it("exposes only the public result fields and deterministic anchors", () => {
    const [result] = searchSettings("MCP servers");
    expect(Object.keys(result).sort()).toEqual([
      "description",
      "id",
      "label",
      "section",
    ]);
    expect(result.id).toBe("setting-mcp-servers");
    expect(settingSearchAnchor("  Follow-up behavior! ")).toBe(
      "setting-follow-up-behavior",
    );
  });
});
