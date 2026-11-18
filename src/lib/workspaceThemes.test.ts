// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  activateWindowAppearance,
  AVEN_THEME_COLORS,
  watchSystemColorScheme,
} from "./appearance";
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
  SIDEBAR_TINT_STRENGTH_DEFAULT,
  SIDEBAR_TINT_STRENGTH_MAX,
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
const defaultGlass = {
  opacity: 0.52,
  blur: 16,
  bodyGlass: true,
  matchPanels: false,
};
/** Fresh workspaces follow the system; pin it so each test controls the mode. */
function systemScheme(scheme: "dark" | "light") {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: scheme === "light",
    addEventListener: vi.fn(),
  } as unknown as MediaQueryList);
}
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
  systemScheme("dark");
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const PROFILES_KEY = "monocode.workspaceProfiles.v1";
function storedThemes() {
  return JSON.parse(localStorage.getItem(WORKSPACE_THEMES_KEY)!);
}

describe("workspace appearance migration and persistence", () => {
  it("always matches sidebars to the workspace, whatever an older version saved", () => {
    const matched = () =>
      document.documentElement.classList.contains("match-workspace-panels");
    act(() => saveWorkspaceTheme({ matchPanels: false }));
    // The saved value is kept for older versions, never rewritten.
    expect(storedThemes().fallback.matchPanels).toBe(false);
    render("work");
    expect(matched()).toBe(true);
    act(() => saveWorkspaceTheme({ matchPanels: true }));
    render("personal");
    expect(matched()).toBe(true);
    act(() => resetWorkspaceTheme());
    expect(matched()).toBe(true);
  });

  it("gives every workspace the same sidebar colour and clears it with Graphite", () => {
    const root = document.documentElement;
    render("personal");
    expect(root.classList.contains("has-sidebar-tint")).toBe(false);
    act(() => saveWorkspaceTheme({ sidebarTint: "#4F7CFF" as never }));
    expect(root.classList.contains("has-sidebar-tint")).toBe(true);
    expect(root.style.getPropertyValue("--sidebar-tint")).toBe("#4f7cff");
    expect(root.style.getPropertyValue("--sidebar-tint-strength")).toBe(
      `${SIDEBAR_TINT_STRENGTH_DEFAULT}%`,
    );
    act(() => saveWorkspaceTheme({ sidebarTintStrength: 500 }));
    expect(root.style.getPropertyValue("--sidebar-tint-strength")).toBe(
      `${SIDEBAR_TINT_STRENGTH_MAX}%`,
    );
    render("work");
    expect(root.style.getPropertyValue("--sidebar-tint")).toBe("#4f7cff");
    act(() => saveWorkspaceTheme({ sidebarTint: "accent" }));
    expect(root.style.getPropertyValue("--sidebar-tint")).toBe(
      "var(--personal-accent)",
    );
    render("personal");
    expect(root.style.getPropertyValue("--sidebar-tint")).toBe(
      "var(--personal-accent)",
    );
    act(() => saveWorkspaceTheme({ sidebarTint: "none" }));
    expect(root.classList.contains("has-sidebar-tint")).toBe(false);
    expect(loadWorkspaceTheme().sidebarTint).toBeUndefined();
    act(() => saveWorkspaceTheme({ sidebarTint: "url(evil)" as never }));
    expect(root.classList.contains("has-sidebar-tint")).toBe(false);
  });

  it("starts with the Aven glass palette following the system and persists it as the shared look", () => {
    const aven = defaultWorkspaceTheme();
    expect(WORKSPACE_THEME_PRESETS[0].name).toBe("Aven");
    expect(aven).toEqual({
      hue: 207,
      saturation: 0,
      preference: "system",
      opacity: 0.52,
      blur: 16,
      bodyGlass: true,
      matchPanels: false,
      colors: {
        // A neutral accent: colour is for what means something.
        dark: {
          background: "#000000",
          accent: "#e8e8ea",
          highlight: "#a1a1a6",
        },
        light: {
          background: "#ffffff",
          accent: "#0a0a0a",
          highlight: "#737373",
        },
      },
    });
    expect(loadWorkspaceTheme()).toEqual(aven);
    expect(storedThemes()).toEqual({
      version: 1,
      fallback: aven,
      themes: {},
      shared: true,
    });
  });

  it("keeps a saved Cove look unchanged across the rebrand", () => {
    const cove = WORKSPACE_THEME_PRESETS.find(
      (theme) => theme.name === "Cove",
    )!;
    const custom = {
      ...defaultWorkspaceTheme(),
      hue: cove.hue,
      saturation: cove.saturation,
      opacity: 0.37,
      blur: 12,
      bodyGlass: true,
      matchPanels: true,
      colors: { dark: { background: "#123456", accent: "#abcdef" } },
    };
    const before = JSON.stringify({
      version: 1,
      fallback: custom,
      themes: {},
      shared: true,
    });
    localStorage.setItem(WORKSPACE_THEMES_KEY, before);
    localStorage.setItem(
      "monocode.chatBackgroundPath",
      "/saved/background.png",
    );

    expect(loadWorkspaceTheme()).toEqual(custom);
    expect(localStorage.getItem(WORKSPACE_THEMES_KEY)).toBe(before);
    expect(localStorage.getItem("monocode.chatBackgroundPath")).toBe(
      "/saved/background.png",
    );

    const next = applyWorkspaceThemePreset(WORKSPACE_THEME_PRESETS[0], "dark");
    expect(next).toEqual({
      ...custom,
      colors: { dark: WORKSPACE_THEME_PRESETS[0].colors.dark },
    });
    expect(loadWorkspaceTheme()).toEqual(next);
    expect(localStorage.getItem("monocode.chatBackgroundPath")).toBe(
      "/saved/background.png",
    );
  });

  it("migrates only the complete inherited stock fallback", () => {
    const stock = {
      hue: 240,
      saturation: 8,
      preference: "dark",
      opacity: 0.15,
      blur: 0,
      bodyGlass: true,
    };
    localStorage.setItem(
      WORKSPACE_THEMES_KEY,
      JSON.stringify({ version: 1, fallback: stock, themes: {} }),
    );
    expect(loadWorkspaceTheme()).toEqual(defaultWorkspaceTheme());
    const migrated = localStorage.getItem(WORKSPACE_THEMES_KEY);
    expect(JSON.parse(migrated!).fallback).toEqual(defaultWorkspaceTheme());
    expect(loadWorkspaceTheme()).toEqual(defaultWorkspaceTheme());
    expect(localStorage.getItem(WORKSPACE_THEMES_KEY)).toBe(migrated);
  });

  it("preserves an explicit old transparency preference and custom fallback until reset", () => {
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
    expect(loadWorkspaceTheme()).toEqual({
      ...custom,
      matchPanels: false,
    });
    resetWorkspaceTheme();
    expect(loadWorkspaceTheme()).toEqual(defaultWorkspaceTheme());
    expect(localStorage.getItem("monocode.sidebarOpacity")).toBe("0.15");
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
    expect(loadWorkspaceTheme()).toEqual({
      ...custom,
      matchPanels: false,
    });
  });

  it("keeps tint-only customization after reload without reintroducing the Aven palette", () => {
    saveWorkspaceTheme({ hue: 85, saturation: 24 });
    saveWorkspaceTheme({ preference: "light", hue: 85 });
    expect(loadWorkspaceTheme().colors).toBeUndefined();
    expect(storedThemes().fallback.colors).toBeUndefined();
    expect(loadWorkspaceTheme()).toEqual({
      ...defaultGlass,
      hue: 85,
      saturation: 24,
      preference: "light",
    });
  });

  it("keeps the former blue default selectable as Blue", () => {
    expect(
      WORKSPACE_THEME_PRESETS.map((preset) => preset.name).slice(0, 4),
    ).toEqual(["Aven", "Blue", "Mono", "Sky"]);
    expect(WORKSPACE_THEME_PRESETS[1]).toEqual({
      name: "Blue",
      hue: 207,
      saturation: 0,
      colors: {
        dark: {
          background: "#000000",
          accent: "#57b5ff",
          highlight: "#8ccbff",
        },
        light: {
          background: "#ffffff",
          accent: "#0a6cc4",
          highlight: "#6aaee8",
        },
      },
    });
  });

  it("moves a look saved with the former blue default to the neutral one", () => {
    localStorage.setItem(
      WORKSPACE_THEMES_KEY,
      JSON.stringify({
        version: 1,
        fallback: {
          ...defaultWorkspaceTheme(),
          opacity: 0.4,
          colors: {
            dark: {
              background: "#000000",
              accent: "#57B5FF",
              highlight: "#57b5ff",
            },
            light: { ...AVEN_THEME_COLORS.light },
          },
        },
        themes: {},
        shared: true,
      }),
    );
    expect(loadWorkspaceTheme()).toEqual({
      ...defaultWorkspaceTheme(),
      opacity: 0.4,
    });
    // Blue on another background was a choice, not the default.
    localStorage.setItem(
      WORKSPACE_THEMES_KEY,
      JSON.stringify({
        version: 1,
        fallback: {
          ...defaultWorkspaceTheme(),
          colors: {
            dark: {
              background: "#171b25",
              accent: "#57b5ff",
              highlight: "#57b5ff",
            },
          },
        },
        themes: {},
        shared: true,
      }),
    );
    expect(loadWorkspaceTheme().colors?.dark?.accent).toBe("#57b5ff");
  });

  it("keeps the former monochrome default selectable as Mono", () => {
    expect(WORKSPACE_THEME_PRESETS[2]).toEqual({
      name: "Mono",
      hue: 207,
      saturation: 0,
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

  it("stores custom colors by mode while preserving legacy settings and glass", () => {
    const original = loadWorkspaceTheme();
    const light = resolvedWorkspaceColors(original, "light");
    const black = WORKSPACE_THEME_PRESETS.find(
      (preset) => preset.name === "Black",
    )!;
    expect(WORKSPACE_THEME_PRESETS).toHaveLength(22);
    const next = applyWorkspaceThemePreset(black, "dark");
    expect({ ...next, colors: original.colors }).toEqual(original);
    expect(next.colors?.dark?.background).toBe("#000000");
    expect(resolvedWorkspaceColors(next, "light")).toEqual(light);
    saveWorkspaceColor("light", "accent", "#AbC");
    expect(loadWorkspaceTheme().colors?.light?.accent).toBe("#aabbcc");
    expect(loadWorkspaceTheme().colors?.dark).toEqual(black.colors.dark);
    const saved = localStorage.getItem(WORKSPACE_THEMES_KEY);
    saveWorkspaceColor("dark", "background", "url(untrusted)");
    expect(localStorage.getItem(WORKSPACE_THEMES_KEY)).toBe(saved);
    saveWorkspaceColor("light", "accent", null);
    expect(loadWorkspaceTheme().colors?.light).toEqual({
      background: light.background,
      highlight: light.highlight,
    });
    expect(loadWorkspaceTheme().colors?.dark).toEqual(black.colors.dark);
  });

  it("legacy tint edits clear only the resolved mode and reset restores Aven colors", () => {
    const original = loadWorkspaceTheme();
    saveWorkspaceColor("dark", "background", "#000000");
    saveWorkspaceColor("light", "background", "#ffffff");
    saveWorkspaceTheme({ hue: 155 });
    expect(loadWorkspaceTheme().colors?.dark).toBeUndefined();
    expect(loadWorkspaceTheme().colors?.light?.background).toBe("#ffffff");
    saveWorkspaceColor("dark", "background", "#123456");
    // Non-finite tint values are not a tint edit.
    saveWorkspaceTheme({ hue: NaN, saturation: Infinity });
    expect(loadWorkspaceTheme().colors?.dark?.background).toBe("#123456");
    resetWorkspaceTheme();
    expect(loadWorkspaceTheme()).toEqual(original);
  });

  it("captures the legacy theme once and keeps it after the legacy setting changes", () => {
    localStorage.setItem("monocode.themeHue", "155");
    localStorage.setItem("monocode.themeSaturation", "22");
    localStorage.setItem("monocode.colorScheme", "light");
    // Older installs keep the opaque look they had for glass they never set.
    const legacyGlass = {
      opacity: 1,
      blur: 0,
      bodyGlass: false,
      matchPanels: false,
    };
    const original = {
      hue: 155,
      saturation: 22,
      preference: "light",
      ...legacyGlass,
    };
    expect(loadWorkspaceTheme()).toEqual(original);
    // A legacy consumer changing its setting must not change the saved look.
    localStorage.setItem("monocode.themeHue", "40");
    expect(loadWorkspaceTheme()).toEqual(original);
    saveWorkspaceTheme({ hue: 260, preference: "dark" });
    expect(loadWorkspaceTheme()).toEqual({
      ...legacyGlass,
      hue: 260,
      saturation: 22,
      preference: "dark",
    });
    expect(localStorage.getItem("monocode.colorScheme")).toBe("light");
  });

  it("merges edits into the one look and reset restores Aven", () => {
    const original = loadWorkspaceTheme();
    saveWorkspaceTheme({ hue: 265, preference: "dark" });
    saveWorkspaceTheme({ saturation: 35, preference: "light" });
    saveWorkspaceTheme({ saturation: 18 });
    expect(loadWorkspaceTheme()).toMatchObject({
      ...defaultGlass,
      hue: 265,
      saturation: 18,
      preference: "light",
    });
    // Each tint edit cleared the palette of the mode it was made in.
    expect(loadWorkspaceTheme().colors?.dark).toBeUndefined();
    expect(loadWorkspaceTheme().colors?.light).toBeUndefined();
    resetWorkspaceTheme();
    expect(loadWorkspaceTheme()).toEqual(original);
  });

  it("rejects malformed preferences and clamps out-of-range values", () => {
    localStorage.setItem(WORKSPACE_THEMES_KEY, "broken");
    expect(loadWorkspaceTheme()).toEqual(defaultWorkspaceTheme());
    saveWorkspaceTheme({ hue: 990, saturation: -20 });
    expect(loadWorkspaceTheme()).toEqual({
      ...defaultGlass,
      hue: 360,
      saturation: 0,
      preference: "system",
      colors: { light: defaultWorkspaceTheme().colors!.light },
    });
    const saved = storedThemes();
    saved.fallback = {
      hue: "invalid",
      saturation: null,
      preference: "unknown",
    };
    localStorage.setItem(WORKSPACE_THEMES_KEY, JSON.stringify(saved));
    expect(loadWorkspaceTheme()).toEqual({
      ...defaultWorkspaceTheme(),
      colors: undefined,
    });
  });
});

describe("one look for every workspace", () => {
  const look = (hue: number) => ({
    ...defaultWorkspaceTheme(),
    hue,
    colors: undefined,
  });
  function oldStore(themes: Record<string, unknown>) {
    localStorage.setItem(
      WORKSPACE_THEMES_KEY,
      JSON.stringify({ version: 1, fallback: look(10), themes }),
    );
  }

  it("migrates the look of the workspace that was in front", () => {
    localStorage.setItem(
      PROFILES_KEY,
      JSON.stringify({ activeProfileId: "work" }),
    );
    oldStore({ personal: look(20), work: look(30) });
    expect(loadWorkspaceTheme()).toEqual(look(30));
    expect(storedThemes()).toEqual({
      version: 1,
      fallback: look(30),
      themes: {},
      shared: true,
    });
  });

  it("keeps a chosen look that matches the old stock values", () => {
    const stock = {
      hue: 240,
      saturation: 8,
      preference: "dark",
      opacity: 0.15,
      blur: 0,
      bodyGlass: true,
    };
    localStorage.setItem(
      PROFILES_KEY,
      JSON.stringify({ activeProfileId: "work" }),
    );
    oldStore({ work: stock });
    const chosen = loadWorkspaceTheme();
    expect(chosen).not.toEqual(defaultWorkspaceTheme());
    expect(chosen).toMatchObject(stock);
    // Read again from the folded store: still the chosen look.
    expect(loadWorkspaceTheme()).toEqual(chosen);
    saveWorkspaceTheme(stock as Partial<typeof chosen>);
    expect(loadWorkspaceTheme()).toMatchObject(stock);
  });

  it("migrates Personal's look when the front workspace had none of its own", () => {
    localStorage.setItem(
      PROFILES_KEY,
      JSON.stringify({ activeProfileId: "workspace-new" }),
    );
    oldStore({ personal: look(20), work: look(30) });
    expect(loadWorkspaceTheme()).toEqual(look(20));
    expect(storedThemes()).toEqual({
      version: 1,
      fallback: look(20),
      themes: {},
      shared: true,
    });
  });

  it("migrates the old fallback when neither the front workspace nor Personal had a look", () => {
    oldStore({ work: look(30) });
    expect(loadWorkspaceTheme()).toEqual(look(10));
    expect(storedThemes()).toEqual({
      version: 1,
      fallback: look(10),
      themes: {},
      shared: true,
    });
  });

  it("ignores unreadable or unsafe front-workspace records", () => {
    localStorage.setItem(PROFILES_KEY, "broken");
    oldStore({ personal: look(20) });
    expect(loadWorkspaceTheme()).toEqual(look(20));
    localStorage.setItem(
      PROFILES_KEY,
      JSON.stringify({ activeProfileId: "__proto__" }),
    );
    oldStore({ work: look(30) });
    expect(loadWorkspaceTheme()).toEqual(look(10));
  });

  it("migrates once: a shared store keeps its look even if workspace records come back", () => {
    oldStore({ personal: look(20) });
    expect(loadWorkspaceTheme()).toEqual(look(20));
    // An older Aven may still write a per-workspace record into the store.
    const shared = storedThemes();
    shared.themes.personal = look(99);
    localStorage.setItem(WORKSPACE_THEMES_KEY, JSON.stringify(shared));
    localStorage.setItem(
      PROFILES_KEY,
      JSON.stringify({ activeProfileId: "personal" }),
    );
    expect(loadWorkspaceTheme()).toEqual(look(20));
  });

  it("shows an edit made in one workspace in every workspace", () => {
    render("personal");
    act(() => saveWorkspaceTheme({ hue: 120, opacity: 0.4 }));
    render("work");
    expect(activeSettings.profileId).toBe("work");
    expect(activeSettings.theme).toMatchObject({ hue: 120, opacity: 0.4 });
    expect(document.documentElement.style.getPropertyValue("--theme-hue")).toBe(
      "120",
    );
    expect(storedThemes().themes).toEqual({});
    expect(storedThemes().shared).toBe(true);
  });

  it("writes only the theme key and announces each edit once", () => {
    const otherStorage = {
      [PROFILES_KEY]: JSON.stringify({
        activeProfileId: "personal",
        projectProfiles: { "/work/project": "work" },
      }),
      "monocode.chatBackgroundPath": "/app-data/background.png",
    };
    for (const [key, value] of Object.entries(otherStorage)) {
      localStorage.setItem(key, value);
    }
    loadWorkspaceTheme();
    const persist = vi.spyOn(localStorage, "setItem");
    const onChange = vi.fn();
    window.addEventListener("monocode:workspace-theme-changed", onChange);
    try {
      saveWorkspaceTheme({ opacity: 0.53, blur: 13 });
      expect(persist).toHaveBeenCalledTimes(1);
      expect(persist.mock.calls[0][0]).toBe(WORKSPACE_THEMES_KEY);
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("monocode:workspace-theme-changed", onChange);
    }
    for (const [key, value] of Object.entries(otherStorage)) {
      expect(localStorage.getItem(key)).toBe(value);
    }
  });
});

describe("workspace glass migration", () => {
  it("migrates palette-only records once", () => {
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
    const expected = {
      ...palette,
      hue: 265,
      opacity: 0.07,
      blur: 10,
      bodyGlass: false,
      matchPanels: false,
    };
    expect(loadWorkspaceTheme()).toEqual(expected);
    const migrated = localStorage.getItem(WORKSPACE_THEMES_KEY);
    localStorage.setItem("monocode.sidebarOpacity", "0.9");
    localStorage.setItem("monocode.sidebarBlur", "30");
    localStorage.setItem("monocode.bodyGlass", "1");
    expect(loadWorkspaceTheme()).toEqual(expected);
    expect(localStorage.getItem(WORKSPACE_THEMES_KEY)).toBe(migrated);
  });

  it("preserves fractional opacity and clamps or rejects glass values", () => {
    saveWorkspaceTheme({
      opacity: 0.07,
      blur: 0,
      bodyGlass: false,
      matchPanels: false,
    });
    expect(loadWorkspaceTheme()).toMatchObject({
      opacity: 0.07,
      blur: 0,
      bodyGlass: false,
      matchPanels: false,
    });
    saveWorkspaceTheme({ opacity: Infinity, blur: NaN });
    expect(loadWorkspaceTheme()).toMatchObject({ opacity: 0.07, blur: 0 });
    saveWorkspaceTheme({ opacity: -10, blur: 88 });
    expect(loadWorkspaceTheme()).toMatchObject({ opacity: 0.05, blur: 64 });
    saveWorkspaceTheme({ opacity: 10, blur: -4 });
    expect(loadWorkspaceTheme()).toMatchObject({ opacity: 1, blur: 0 });
    resetWorkspaceTheme();
    expect(loadWorkspaceTheme()).toMatchObject(defaultGlass);
  });
});

describe("workspace theme activation", () => {
  it("switches workspaces without repainting the root or repeating native work", () => {
    saveWorkspaceTheme({
      hue: 210,
      opacity: 0.5,
      blur: 12,
      matchPanels: true,
    });
    render("personal");
    const setStyle = vi.spyOn(document.documentElement.style, "setProperty");
    const removeStyle = vi.spyOn(
      document.documentElement.style,
      "removeProperty",
    );
    vi.mocked(invoke).mockClear();
    const saved = localStorage.getItem(WORKSPACE_THEMES_KEY);
    render("work");
    expect(activeSettings.profileId).toBe("work");
    expect(activeSettings.theme).toEqual(loadWorkspaceTheme());
    expect(setStyle).not.toHaveBeenCalled();
    expect(removeStyle).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(localStorage.getItem(WORKSPACE_THEMES_KEY)).toBe(saved);
    act(() => saveWorkspaceColor("dark", "accent", "#123456"));
    expect(
      document.documentElement.style.getPropertyValue("--theme-accent-color"),
    ).toBe("#123456");
    render("personal");
    expect(
      document.documentElement.style.getPropertyValue("--theme-accent-color"),
    ).toBe("#123456");
  });

  it("activates custom colors without leaking them to the other mode", async () => {
    saveWorkspaceColor("dark", "background", "#101010");
    saveWorkspaceColor("light", "background", "#f0f0f0");
    render("personal");
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--theme-background-color")).toBe("#101010");
    vi.mocked(invoke).mockClear();
    act(() => {
      saveWorkspaceColor("dark", "accent", "#aabbcc");
    });
    expect(style.getPropertyValue("--theme-accent-color")).toBe("#aabbcc");
    expect(invoke).not.toHaveBeenCalled();
    act(() => {
      saveWorkspaceTheme({ preference: "light" });
    });
    expect(style.getPropertyValue("--theme-background-color")).toBe("#f0f0f0");
    render("work");
    expect(style.getPropertyValue("--theme-background-color")).toBe("#f0f0f0");
    expect(document.documentElement.classList.contains("theme-light")).toBe(
      true,
    );
  });

  it("an edit repaints at once and sends only the new translucency to the window", async () => {
    // Start opaque so the later edit is what reveals the desktop.
    saveWorkspaceTheme({ opacity: 1, blur: 0, bodyGlass: false });
    render("work");
    activateWindowAppearance();
    await Promise.resolve();
    vi.mocked(invoke).mockClear();
    act(() => {
      saveWorkspaceTheme({
        hue: 90,
        saturation: 30,
        opacity: 0.05,
        bodyGlass: false,
      });
    });
    expect(document.documentElement.style.getPropertyValue("--theme-hue")).toBe(
      "90",
    );
    // Only the translucency this edit introduced reaches the native window.
    expect(vi.mocked(invoke).mock.calls).toEqual([
      [
        "set_window_glass_enabled",
        // The shell's dark frame, hsl(90 30% 4%), at the new opacity above
        // the glass floor.
        { enabled: true, tint: { r: 10, g: 13, b: 7, alpha: 0.24 } },
      ],
    ]);
    vi.mocked(invoke).mockClear();
    render("personal");
    expect(document.documentElement.style.getPropertyValue("--theme-hue")).toBe(
      "90",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("system appearance follows the shared look's preference instead of the legacy global setting", () => {
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
    saveWorkspaceTheme({ preference: "system" });
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
    expect(document.documentElement.classList.contains("theme-light")).toBe(
      true,
    );
    act(() => saveWorkspaceTheme({ preference: "dark" }));
    act(() => {
      changed?.();
    });
    expect(document.documentElement.classList.contains("theme-light")).toBe(
      false,
    );
  });

  it("keeps the glass when switching workspaces, without native-window IPC", async () => {
    saveWorkspaceTheme({ opacity: 0.7, blur: 13, bodyGlass: false });
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
    expect(invoke).not.toHaveBeenCalled();
    expect(localStorage.getItem(WORKSPACE_THEMES_KEY)).toBe(saved);
  });
});
