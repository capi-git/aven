import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ nativeGlass: true }));
vi.mock("./platform", () => ({
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
    ["permissions", "Default task access", "general"],
    ["queued", "Follow-up behavior", "general"],
    ["memory", "Memory saver", "general"],
    ["ram", "Memory saver", "general"],
    ["sleeping tabs", "Memory saver", "general"],
    ["do not disturb", "Quiet mode", "general"],
    ["wallpaper", "Chat background", "appearance"],
    ["text size", "Interface scale", "appearance"],
    ["hotkeys", "Keybindings", "keybindings"],
    ["default model", "Providers", "providers"],
    ["cli updates", "Keep provider tools up to date", "providers"],
    ["recover project", "Archived projects", "archive"],
    ["recover chat", "Archived conversations", "archive"],
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
    expect(searchSettings("follow-up")[0].label).toBe("Follow-up behavior");
    expect(searchSettings("followup")[0].label).toBe("Follow-up behavior");
  });

  it("requires every term and returns no invented settings", () => {
    expect(searchSettings("queue wallpaper")).toEqual([]);
    expect(searchSettings("quantum teleporter")).toEqual([]);
    expect(searchSettings("custom fonts")).toEqual([]);
    expect(searchSettings("   ")).toEqual([]);
    expect(searchSettings("!!!")).toEqual([]);
  });

  it("does not offer native glass controls on unsupported platforms", () => {
    expect(searchSettings("opacity")[0].label).toBe("Background opacity");
    platform.nativeGlass = false;
    expect(searchSettings("opacity")).toEqual([]);
    expect(searchSettings("blur radius")).toEqual([]);
    expect(searchSettings("include workspace")).toEqual([]);
    expect(searchSettings("theme")[0].label).toBe("Theme");
  });

  it("targets stable parent cards for controls that may not yet be visible", () => {
    expect(searchSettings("background visibility")).toContainEqual(
      expect.objectContaining({ id: "setting-chat-background" }),
    );
    expect(searchSettings("accent")).toContainEqual(
      expect.objectContaining({ id: "setting-workspace-colors" }),
    );
  });

  it("exposes only the public result fields and deterministic anchors", () => {
    const [result] = searchSettings("Linear API key");
    expect(Object.keys(result).sort()).toEqual([
      "description",
      "id",
      "label",
      "section",
    ]);
    expect(result.id).toBe("setting-linear-api-key");
    expect(settingSearchAnchor("  Follow-up behavior! ")).toBe(
      "setting-follow-up-behavior",
    );
  });
});
