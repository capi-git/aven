// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { activateWindowAppearance, watchSystemColorScheme } from "./appearance";
import {
  loadWorkspaceTheme,
  resetWorkspaceTheme,
  saveWorkspaceTheme,
  useActivateWorkspaceTheme,
  useActiveWorkspaceTheme,
  WORKSPACE_THEMES_KEY,
  WORKSPACE_THEME_PRESETS,
  applyWorkspaceThemePreset,
  resolvedWorkspaceColors,
  saveWorkspaceColor,
  defaultWorkspaceTheme,
  copyWorkspaceTheme,
} from "./workspaceThemes";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (path: string) => path,
}));
vi.mock("./platform", () => ({ HAS_NATIVE_GLASS: true, IS_MAC: true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setBackgroundColor: vi.fn().mockResolvedValue(undefined),
  }),
}));

let root: Root;
let container: HTMLDivElement;
let activeSettings: ReturnType<typeof useActiveWorkspaceTheme>;
const defaultGlass = { opacity: 1, blur: 0, bodyGlass: false, matchPanels: false };
function SettingsProbe() {
  activeSettings = useActiveWorkspaceTheme();
  return null;
}
function Probe({ profileId }: { profileId: string }) {
  useActivateWorkspaceTheme(profileId);
  return createElement(SettingsProbe);
}
function render(profileId: string) {
  act(() => root.render(createElement(Probe, { profileId })));
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.documentElement.className = "";
  document.documentElement.style.cssText = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("workspace appearance migration and persistence", () => {
  it("persists sidebar matching per workspace and applies it without repeating native appearance work", () => {
    render("personal");
    expect(document.documentElement.classList.contains("match-workspace-panels")).toBe(false);
    vi.mocked(invoke).mockClear();
    act(() => saveWorkspaceTheme("personal", { matchPanels: true }));
    expect(document.documentElement.classList.contains("match-workspace-panels")).toBe(true);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(WORKSPACE_THEMES_KEY)!).themes.personal.matchPanels).toBe(true);
    render("work");
    expect(document.documentElement.classList.contains("match-workspace-panels")).toBe(false);
    render("personal");
    expect(document.documentElement.classList.contains("match-workspace-panels")).toBe(true);
    act(() => resetWorkspaceTheme("personal"));
    expect(document.documentElement.classList.contains("match-workspace-panels")).toBe(false);
  });

  it("starts fresh workspaces with the monochrome Aven palette and persists it", () => {
    const aven = defaultWorkspaceTheme();
    expect(WORKSPACE_THEME_PRESETS[0].name).toBe("Aven");
    expect(aven).toEqual({
      hue: 207,
      saturation: 0,
      preference: "dark",
      opacity: 1,
      blur: 0,
      bodyGlass: false,
      matchPanels: false,
      colors: {
        dark: {
          background: "#0a0a0a",
          accent: "#f5f5f5",
          highlight: "#a3a3a3",
        },
        light: {
          background: "#ffffff",
          accent: "#0a0a0a",
          highlight: "#737373",
        },
      },
    });
    expect(loadWorkspaceTheme("personal")).toEqual(aven);
    expect(loadWorkspaceTheme("work")).toEqual(aven);
    expect(
      JSON.parse(localStorage.getItem(WORKSPACE_THEMES_KEY)!).fallback,
    ).toEqual(aven);
    expect(loadWorkspaceTheme("new-profile")).toEqual(aven);
  });

  it("keeps the saved Cove palette and custom workspaces unchanged across the rebrand", () => {
    const cove = WORKSPACE_THEME_PRESETS.find((theme) => theme.name === "Cove")!;
    const savedTheme = {
      ...defaultWorkspaceTheme(),
      hue: cove.hue,
      saturation: cove.saturation,
      colors: cove.colors,
    };
    const custom = {
      ...savedTheme,
      opacity: 0.37,
      blur: 12,
      bodyGlass: true,
      matchPanels: true,
      colors: { dark: { background: "#123456", accent: "#abcdef" } },
    };
    const before = JSON.stringify({
      version: 1,
      fallback: savedTheme,
      themes: { work: custom },
    });
    localStorage.setItem(WORKSPACE_THEMES_KEY, before);
    localStorage.setItem("monocode.chatBackgroundPath", "/saved/background.png");

    expect(loadWorkspaceTheme("personal")).toEqual(savedTheme);
    expect(loadWorkspaceTheme("work")).toEqual(custom);
    expect(localStorage.getItem(WORKSPACE_THEMES_KEY)).toBe(before);
    expect(localStorage.getItem("monocode.chatBackgroundPath")).toBe("/saved/background.png");

    const next = applyWorkspaceThemePreset("work", WORKSPACE_THEME_PRESETS[0], "dark");
    expect(next).toEqual({
      ...custom,
      colors: { dark: WORKSPACE_THEME_PRESETS[0].colors.dark },
    });
    expect(loadWorkspaceTheme("personal")).toEqual(savedTheme);
    expect(localStorage.getItem("monocode.chatBackgroundPath")).toBe("/saved/background.png");
  });

  it("migrates only the complete inherited stock fallback and retains explicit workspace records", () => {
    const stock = {
      hue: 240,
      saturation: 8,
      preference: "dark",
      opacity: 0.15,
      blur: 0,
      bodyGlass: true,
    };
    const custom = {
      ...stock,
      hue: 180,
      opacity: 0.27,
      blur: 17,
      colors: { dark: { background: "#123456", accent: "#fedcba" } },
    };
    localStorage.setItem(
      WORKSPACE_THEMES_KEY,
      JSON.stringify({
        version: 1,
        fallback: stock,
        themes: { personal: custom, work: stock },
      }),
    );
    expect(loadWorkspaceTheme("inherited")).toEqual(defaultWorkspaceTheme());
    expect(loadWorkspaceTheme("personal")).toEqual({ ...custom, matchPanels: false });
    // A saved per-workspace choice cannot safely be classified as untouched.
    expect(loadWorkspaceTheme("work")).toEqual({ ...stock, matchPanels: false });
    const migrated = localStorage.getItem(WORKSPACE_THEMES_KEY);
    expect(JSON.parse(migrated!).fallback).toEqual(defaultWorkspaceTheme());
    expect(loadWorkspaceTheme("inherited")).toEqual(defaultWorkspaceTheme());
    expect(localStorage.getItem(WORKSPACE_THEMES_KEY)).toBe(migrated);
  });

  it("preserves an explicit old transparency preference and custom fallback but resets only the requested workspace", () => {
    const custom = {
      hue: 240,
      saturation: 8,
      preference: "dark",
      opacity: 0.15,
      blur: 0,
      bodyGlass: true,
    };
    localStorage.setItem("monocode.sidebarOpacity", "0.15");
    localStorage.setItem(
      WORKSPACE_THEMES_KEY,
      JSON.stringify({
        version: 1,
        fallback: custom,
        themes: {},
      }),
    );
    expect(loadWorkspaceTheme("personal")).toEqual({ ...custom, matchPanels: false });
    resetWorkspaceTheme("work");
    expect(loadWorkspaceTheme("work")).toEqual(defaultWorkspaceTheme());
    expect(loadWorkspaceTheme("personal")).toEqual({ ...custom, matchPanels: false });
    expect(localStorage.getItem("monocode.sidebarOpacity")).toBe("0.15");
    // The create-profile path uses Reset so new profiles do not inherit old glass.
    resetWorkspaceTheme("new-profile");
    expect(loadWorkspaceTheme("new-profile")).toEqual(defaultWorkspaceTheme());
  });

  it.each([
    { hue: 241 },
    { saturation: 9 },
    { preference: "system" },
    { opacity: 0.16 },
    { blur: 1 },
    { bodyGlass: false },
    { colors: { dark: { accent: "#aabbcc" } } },
  ])("keeps a customized historical fallback %j", (patch) => {
    const custom = {
      hue: 240,
      saturation: 8,
      preference: "dark",
      opacity: 0.15,
      blur: 0,
      bodyGlass: true,
      ...patch,
    };
    localStorage.setItem(
      WORKSPACE_THEMES_KEY,
      JSON.stringify({
        version: 1,
        fallback: custom,
        themes: {},
      }),
    );
    expect(loadWorkspaceTheme("personal")).toEqual({ ...custom, matchPanels: false });
    expect(loadWorkspaceTheme("work")).toEqual({ ...custom, matchPanels: false });
  });

  it("keeps tint-only customization after reload without reintroducing the Aven palette", () => {
    saveWorkspaceTheme("personal", { hue: 85, saturation: 24 });
    saveWorkspaceTheme("personal", { preference: "light", hue: 85 });
    expect(loadWorkspaceTheme("personal").colors).toBeUndefined();
    const persisted = JSON.parse(localStorage.getItem(WORKSPACE_THEMES_KEY)!);
    expect(persisted.themes.personal.colors).toBeUndefined();
    expect(loadWorkspaceTheme("personal")).toEqual({
      ...defaultGlass,
      hue: 85,
      saturation: 24,
      preference: "light",
    });
  });

  it("keeps the former sky-blue default selectable as Sky", () => {
    const sky = WORKSPACE_THEME_PRESETS.find(
      (preset) => preset.name === "Sky",
    )!;
    expect(WORKSPACE_THEME_PRESETS[0].name).toBe("Aven");
    expect(sky).toMatchObject({ hue: 207, saturation: 16 });
    expect(sky.colors).toEqual({
      dark: { background: "#0b121a", accent: "#6cabdd", highlight: "#d7eefc" },
      light: {
        background: "#edf5fc",
        accent: "#286b9f",
        highlight: "#6cabdd",
      },
    });
  });

  it("stores custom colors by workspace and mode while preserving legacy settings and glass", () => {
    const original = loadWorkspaceTheme("personal");
    const light = resolvedWorkspaceColors(original, "light");
    const black = WORKSPACE_THEME_PRESETS.find(
      (preset) => preset.name === "Black",
    )!;
    expect(WORKSPACE_THEME_PRESETS).toHaveLength(20);
    const next = applyWorkspaceThemePreset("personal", black, "dark");
    expect({ ...next, colors: original.colors }).toEqual(original);
    expect(next.colors?.dark.background).toBe("#000000");
    expect(resolvedWorkspaceColors(next, "light")).toEqual(light);
    expect(loadWorkspaceTheme("work")).toEqual(original);
    saveWorkspaceColor("personal", "light", "accent", "#AbC");
    expect(loadWorkspaceTheme("personal").colors?.light?.accent).toBe(
      "#aabbcc",
    );
    expect(loadWorkspaceTheme("personal").colors?.dark).toEqual(
      black.colors.dark,
    );
    const saved = localStorage.getItem(WORKSPACE_THEMES_KEY);
    saveWorkspaceColor("personal", "dark", "background", "url(untrusted)");
    expect(localStorage.getItem(WORKSPACE_THEMES_KEY)).toBe(saved);
    saveWorkspaceColor("personal", "light", "accent", null);
    expect(loadWorkspaceTheme("personal").colors?.light).toEqual({
      background: light.background,
      highlight: light.highlight,
    });
    expect(loadWorkspaceTheme("personal").colors?.dark).toEqual(
      black.colors.dark,
    );
  });

  it("legacy tint edits clear only the resolved mode and reset restores Aven colors", () => {
    const original = loadWorkspaceTheme("personal");
    saveWorkspaceColor("personal", "dark", "background", "#000000");
    saveWorkspaceColor("personal", "light", "background", "#ffffff");
    saveWorkspaceTheme("personal", { hue: 155 });
    expect(loadWorkspaceTheme("personal").colors?.dark).toBeUndefined();
    expect(loadWorkspaceTheme("personal").colors?.light?.background).toBe(
      "#ffffff",
    );
    saveWorkspaceColor("work", "dark", "background", "#123456");
    saveWorkspaceTheme("work", { hue: NaN, saturation: Infinity });
    expect(loadWorkspaceTheme("work").colors?.dark?.background).toBe("#123456");
    resetWorkspaceTheme("personal");
    expect(loadWorkspaceTheme("personal")).toEqual(original);
    expect(loadWorkspaceTheme("work").colors?.dark?.background).toBe("#123456");
  });
  it("captures the legacy theme once and preserves it for untouched workspaces", () => {
    localStorage.setItem("monocode.themeHue", "155");
    localStorage.setItem("monocode.themeSaturation", "22");
    localStorage.setItem("monocode.colorScheme", "light");
    const original = {
      hue: 155,
      saturation: 22,
      preference: "light",
      ...defaultGlass,
    };
    expect(loadWorkspaceTheme("personal")).toEqual(original);
    saveWorkspaceTheme("personal", { hue: 260, preference: "dark" });
    // A legacy consumer changing its setting must not migrate Personal into Work.
    localStorage.setItem("monocode.themeHue", "40");
    expect(loadWorkspaceTheme("work")).toEqual(original);
    expect(loadWorkspaceTheme("new-custom-profile")).toEqual(original);
    expect(loadWorkspaceTheme("personal")).toEqual({
      ...defaultGlass,
      hue: 260,
      saturation: 22,
      preference: "dark",
    });
    expect(localStorage.getItem("monocode.colorScheme")).toBe("light");
  });

  it("merges edits independently and resets only the chosen workspace", () => {
    const original = loadWorkspaceTheme("personal");
    saveWorkspaceTheme("personal", { hue: 265, preference: "dark" });
    saveWorkspaceTheme("work", { saturation: 35, preference: "light" });
    saveWorkspaceTheme("personal", { saturation: 18 });
    expect(loadWorkspaceTheme("personal")).toEqual({
      ...defaultGlass,
      hue: 265,
      saturation: 18,
      preference: "dark",
      colors: { light: original.colors!.light },
    });
    expect(loadWorkspaceTheme("work")).toEqual({
      ...defaultGlass,
      hue: original.hue,
      saturation: 35,
      preference: "light",
      colors: { dark: original.colors!.dark },
    });
    resetWorkspaceTheme("work");
    expect(loadWorkspaceTheme("work")).toEqual(original);
    expect(loadWorkspaceTheme("personal").hue).toBe(265);
  });

  it("rejects malformed preferences and clamps out-of-range values", () => {
    localStorage.setItem(WORKSPACE_THEMES_KEY, "broken");
    expect(loadWorkspaceTheme("work")).toEqual(defaultWorkspaceTheme());
    saveWorkspaceTheme("work", { hue: 990, saturation: -20 });
    expect(loadWorkspaceTheme("work")).toEqual({
      ...defaultGlass,
      hue: 360,
      saturation: 0,
      preference: "dark",
      colors: { light: defaultWorkspaceTheme().colors!.light },
    });
    const saved = JSON.parse(localStorage.getItem(WORKSPACE_THEMES_KEY)!);
    saved.themes.work = {
      hue: "invalid",
      saturation: null,
      preference: "unknown",
    };
    localStorage.setItem(WORKSPACE_THEMES_KEY, JSON.stringify(saved));
    expect(loadWorkspaceTheme("work")).toEqual({
      ...saved.fallback,
      colors: undefined,
    });
  });
});

describe("copying workspace appearance", () => {
  it("replaces both palettes, sidebar matching, and glass without changing other workspace data", () => {
    saveWorkspaceTheme("personal", {
      hue: 155,
      saturation: 22,
      preference: "system",
      opacity: 0.37,
      blur: 19,
      bodyGlass: true,
      matchPanels: true,
      colors: {
        dark: {
          background: "#123456",
          accent: "#789abc",
          highlight: "#def012",
        },
        light: {
          background: "#f1f2f3",
          accent: "#456789",
          highlight: "#abcdef",
        },
      },
    });
    saveWorkspaceTheme("work", { preference: "light", opacity: 1 });
    saveWorkspaceTheme("untouched", { hue: 45, blur: 6 });
    const otherStorage = {
      "monocode.workspaceProfiles.v1": JSON.stringify({
        activeProfileId: "personal",
        projectProfiles: { "/work/project": "work" },
        lastProjectByProfile: { work: "/work/project" },
      }),
      "supermono.workspaceViews.v1": JSON.stringify({
        work: { tabs: ["session-1"], draft: "Keep this draft" },
      }),
      "monocode.chatBackgroundPath": "/app-data/background.png",
      "monocode.chatBackgroundOpacity": "0.35",
      "monocode.chatBackgroundScope": "all",
      "monocode:project-chat-backgrounds": JSON.stringify({
        "/work/project": { path: "/app-data/project-background.png" },
      }),
    };
    for (const [key, value] of Object.entries(otherStorage)) {
      localStorage.setItem(key, value);
    }
    const before = JSON.parse(localStorage.getItem(WORKSPACE_THEMES_KEY)!);
    const source = loadWorkspaceTheme("personal");

    expect(copyWorkspaceTheme("personal", ["personal", "work", "custom"])).toBe(true);

    expect(loadWorkspaceTheme("work")).toEqual(source);
    expect(loadWorkspaceTheme("custom")).toEqual(source);
    expect(loadWorkspaceTheme("personal")).toEqual(source);
    const after = JSON.parse(localStorage.getItem(WORKSPACE_THEMES_KEY)!);
    expect(after.fallback).toEqual(before.fallback);
    expect(after.themes.untouched).toEqual(before.themes.untouched);
    for (const [key, value] of Object.entries(otherStorage)) {
      expect(localStorage.getItem(key)).toBe(value);
    }

    // Copying is a one-time action; later edits remain independent.
    saveWorkspaceColor("work", "light", "accent", "#ff0000");
    expect(loadWorkspaceTheme("personal")).toEqual(source);
    expect(loadWorkspaceTheme("custom")).toEqual(source);
  });

  it("clears every destination color override when the source uses tint-only colors", () => {
    saveWorkspaceTheme("personal", { preference: "dark", hue: 85, saturation: 24 });
    saveWorkspaceTheme("personal", { preference: "light", hue: 85 });
    saveWorkspaceColor("work", "dark", "background", "#012345");
    saveWorkspaceColor("work", "light", "highlight", "#fedcba");
    const source = loadWorkspaceTheme("personal");
    expect(source.colors).toBeUndefined();
    expect(loadWorkspaceTheme("work").colors?.dark).toBeDefined();
    expect(loadWorkspaceTheme("work").colors?.light).toBeDefined();

    expect(copyWorkspaceTheme("personal", ["work"])).toBe(true);

    expect(loadWorkspaceTheme("work")).toEqual(source);
    expect(loadWorkspaceTheme("work").colors).toBeUndefined();
    expect(
      JSON.parse(localStorage.getItem(WORKSPACE_THEMES_KEY)!).themes.work.colors,
    ).toBeUndefined();
  });

  it("writes every destination together and notifies subscribers once after persistence", () => {
    saveWorkspaceTheme("personal", { opacity: 0.53, blur: 13, matchPanels: true });
    saveWorkspaceTheme("work", { opacity: 0.75 });
    saveWorkspaceTheme("custom", { opacity: 0.95 });
    const source = loadWorkspaceTheme("personal");
    const persist = vi.spyOn(localStorage, "setItem");
    const onChange = vi.fn(() => {
      expect(loadWorkspaceTheme("work")).toEqual(source);
      expect(loadWorkspaceTheme("custom")).toEqual(source);
    });
    window.addEventListener("monocode:workspace-theme-changed", onChange);
    try {
      expect(copyWorkspaceTheme("personal", ["work", "custom", "work"])).toBe(true);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(persist.mock.calls[0][0]).toBe(WORKSPACE_THEMES_KEY);
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("monocode:workspace-theme-changed", onChange);
    }
  });

  it("reports a storage failure without changing saved appearances or announcing success", () => {
    saveWorkspaceTheme("personal", { opacity: 0.43, blur: 14 });
    saveWorkspaceTheme("work", { opacity: 0.86, blur: 0 });
    const before = localStorage.getItem(WORKSPACE_THEMES_KEY);
    const source = loadWorkspaceTheme("personal");
    const destination = loadWorkspaceTheme("work");
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    const onChange = vi.fn();
    window.addEventListener("monocode:workspace-theme-changed", onChange);
    try {
      expect(copyWorkspaceTheme("personal", ["work", "custom"])).toBe(false);
      expect(localStorage.getItem(WORKSPACE_THEMES_KEY)).toBe(before);
      expect(loadWorkspaceTheme("personal")).toEqual(source);
      expect(loadWorkspaceTheme("work")).toEqual(destination);
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("monocode:workspace-theme-changed", onChange);
    }
  });
});

describe("workspace glass migration", () => {
  it("migrates palette-only records once without replacing either workspace palette", () => {
    const palette = { hue: 240, saturation: 8, preference: "dark" };
    localStorage.setItem("monocode.sidebarOpacity", "0.07");
    localStorage.setItem("monocode.sidebarBlur", "10");
    localStorage.setItem("monocode.bodyGlass", "0");
    localStorage.setItem(
      WORKSPACE_THEMES_KEY,
      JSON.stringify({
        version: 1,
        fallback: palette,
        themes: {
          personal: { ...palette, hue: 265 },
          work: { ...palette, hue: 155 },
        },
      }),
    );
    expect(loadWorkspaceTheme("personal")).toEqual({
      ...palette,
      hue: 265,
      opacity: 0.07,
      blur: 10,
      bodyGlass: false,
      matchPanels: false,
    });
    const migrated = localStorage.getItem(WORKSPACE_THEMES_KEY);
    localStorage.setItem("monocode.sidebarOpacity", "0.9");
    localStorage.setItem("monocode.sidebarBlur", "30");
    localStorage.setItem("monocode.bodyGlass", "1");
    expect(loadWorkspaceTheme("work")).toEqual({
      ...palette,
      hue: 155,
      opacity: 0.07,
      blur: 10,
      bodyGlass: false,
      matchPanels: false,
    });
    expect(loadWorkspaceTheme("new-profile").opacity).toBe(0.07);
    expect(localStorage.getItem(WORKSPACE_THEMES_KEY)).toBe(migrated);
  });

  it("preserves fractional opacity and independently clamps or rejects glass values", () => {
    saveWorkspaceTheme("personal", {
      opacity: 0.07,
      blur: 0,
      bodyGlass: false,
      matchPanels: false,
    });
    saveWorkspaceTheme("work", { opacity: -10, blur: 88 });
    expect(loadWorkspaceTheme("personal")).toMatchObject({
      opacity: 0.07,
      blur: 0,
      bodyGlass: false,
      matchPanels: false,
    });
    expect(loadWorkspaceTheme("work")).toMatchObject({
      opacity: 0.05,
      blur: 64,
      bodyGlass: false,
      matchPanels: false,
    });
    saveWorkspaceTheme("personal", { opacity: Infinity, blur: NaN });
    expect(loadWorkspaceTheme("personal")).toMatchObject({
      opacity: 0.07,
      blur: 0,
    });
    saveWorkspaceTheme("work", { opacity: 10, blur: -4 });
    expect(loadWorkspaceTheme("work")).toMatchObject({ opacity: 1, blur: 0 });
    resetWorkspaceTheme("work");
    expect(loadWorkspaceTheme("work")).toMatchObject(defaultGlass);
    expect(loadWorkspaceTheme("personal").opacity).toBe(0.07);
  });
});

describe("workspace theme activation", () => {
  it("switches between matching themes without repainting the root or repeating native work", () => {
    saveWorkspaceTheme("personal", { hue: 210, opacity: 0.5, blur: 12, matchPanels: true });
    copyWorkspaceTheme("personal", ["work"]);
    render("personal");
    const setStyle = vi.spyOn(document.documentElement.style, "setProperty");
    const removeStyle = vi.spyOn(document.documentElement.style, "removeProperty");
    vi.mocked(invoke).mockClear();
    render("work");
    expect(activeSettings.profileId).toBe("work");
    expect(activeSettings.theme).toEqual(loadWorkspaceTheme("work"));
    expect(setStyle).not.toHaveBeenCalled();
    expect(removeStyle).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    act(() => saveWorkspaceColor("work", "dark", "accent", "#123456"));
    expect(document.documentElement.style.getPropertyValue("--theme-accent-color")).toBe("#123456");
    expect(loadWorkspaceTheme("personal").colors?.dark?.accent).not.toBe("#123456");
  });

  it("activates custom colors without leaking them to another workspace or mode", async () => {
    saveWorkspaceColor("personal", "dark", "background", "#000000");
    saveWorkspaceColor("personal", "light", "background", "#ffffff");
    render("personal");
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--theme-background-color")).toBe("#000000");
    vi.mocked(invoke).mockClear();
    act(() => {
      saveWorkspaceColor("personal", "dark", "accent", "#aabbcc");
    });
    expect(style.getPropertyValue("--theme-accent-color")).toBe("#aabbcc");
    expect(invoke).not.toHaveBeenCalled();
    act(() => {
      saveWorkspaceTheme("personal", { preference: "light" });
    });
    expect(style.getPropertyValue("--theme-background-color")).toBe("#ffffff");
    render("work");
    expect(style.getPropertyValue("--theme-background-color")).toBe("#0a0a0a");
    expect(style.getPropertyValue("--theme-accent-color")).toBe("#f5f5f5");
  });
  it("switches directly to each destination theme without overwriting either profile", () => {
    saveWorkspaceTheme("personal", {
      hue: 265,
      saturation: 18,
      preference: "dark",
    });
    saveWorkspaceTheme("work", {
      hue: 155,
      saturation: 22,
      preference: "light",
    });
    const saved = localStorage.getItem(WORKSPACE_THEMES_KEY);
    render("personal");
    expect(document.documentElement.style.getPropertyValue("--theme-hue")).toBe(
      "265",
    );
    expect(activeSettings.profileId).toBe("personal");
    render("work");
    expect(document.documentElement.style.getPropertyValue("--theme-hue")).toBe(
      "155",
    );
    expect(document.documentElement.classList.contains("theme-light")).toBe(
      true,
    );
    expect(activeSettings.profileId).toBe("work");
    expect(activeSettings.theme.preference).toBe("light");
    render("personal");
    expect(document.documentElement.classList.contains("theme-light")).toBe(
      false,
    );
    expect(document.documentElement.style.getPropertyValue("--theme-hue")).toBe(
      "265",
    );
    expect(localStorage.getItem(WORKSPACE_THEMES_KEY)).toBe(saved);
  });

  it("editing an inactive workspace does not repaint or send native-window IPC", async () => {
    render("personal");
    activateWindowAppearance();
    await Promise.resolve();
    vi.mocked(invoke).mockClear();
    act(() => {
      saveWorkspaceTheme("work", {
        hue: 60,
        preference: "light",
        opacity: 0.8,
        blur: 16,
        bodyGlass: false,
      });
    });
    expect(document.documentElement.style.getPropertyValue("--theme-hue")).toBe(
      "207",
    );
    expect(document.documentElement.classList.contains("theme-light")).toBe(
      false,
    );
    expect(invoke).not.toHaveBeenCalled();
    act(() => {
      saveWorkspaceTheme("personal", {
        hue: 90,
        saturation: 30,
        opacity: 0.05,
        bodyGlass: false,
      });
    });
    expect(document.documentElement.style.getPropertyValue("--theme-hue")).toBe(
      "90",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("system appearance follows the active workspace preference instead of the legacy global setting", () => {
    let changed: (() => void) | undefined;
    const media = {
      matches: false,
      addEventListener: (_name: string, listener: () => void) => {
        changed = listener;
      },
    };
    vi.spyOn(window, "matchMedia").mockReturnValue(
      media as unknown as MediaQueryList,
    );
    localStorage.setItem("monocode.colorScheme", "dark");
    saveWorkspaceTheme("work", { preference: "system" });
    render("work");
    watchSystemColorScheme();
    act(() => {
      media.matches = true;
      changed?.();
    });
    expect(document.documentElement.classList.contains("theme-light")).toBe(
      true,
    );
    render("personal");
    act(() => {
      changed?.();
    });
    expect(document.documentElement.classList.contains("theme-light")).toBe(
      false,
    );
  });

  it("restores the destination workspace glass values without unchanged-value IPC", async () => {
    saveWorkspaceTheme("personal", { opacity: 0.06, blur: 0, bodyGlass: true });
    saveWorkspaceTheme("work", { opacity: 0.7, blur: 13, bodyGlass: false });
    render("personal");
    await Promise.resolve();
    vi.mocked(invoke).mockClear();
    const saved = localStorage.getItem(WORKSPACE_THEMES_KEY);
    render("work");
    expect(activeSettings.theme).toMatchObject({
      opacity: 0.7,
      blur: 13,
      bodyGlass: false,
      matchPanels: false,
    });
    expect(
      document.documentElement.style.getPropertyValue("--sidebar-opacity"),
    ).toBe("0.7");
    expect(document.documentElement.classList.contains("glass-body")).toBe(
      false,
    );
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      "set_window_background_blur",
      { radius: 13 },
    );
    render("work");
    expect(invoke).toHaveBeenCalledTimes(1);
    render("personal");
    expect(
      document.documentElement.style.getPropertyValue("--sidebar-opacity"),
    ).toBe("0.06");
    expect(document.documentElement.classList.contains("glass-body")).toBe(
      true,
    );
    expect(invoke).toHaveBeenLastCalledWith("set_window_background_blur", {
      radius: 0,
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(WORKSPACE_THEMES_KEY)).toBe(saved);
  });
});
