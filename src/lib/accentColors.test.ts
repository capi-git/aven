import { beforeEach, describe, expect, it, vi } from "vitest";
import { AVEN_BLUE_THEME_COLORS, AVEN_THEME_COLORS } from "./appearance";
import {
  ACCENT_PRESETS,
  accentSwatches,
  saveWorkspaceAccentPreset,
  saveWorkspaceCustomAccent,
  selectedAccentPreset,
  withAccentPreset,
  withCustomAccent,
} from "./accentColors";
import {
  defaultWorkspaceTheme,
  loadWorkspaceTheme,
  saveWorkspaceTheme,
  WORKSPACE_THEME_PRESETS,
} from "./workspaceThemes";

vi.mock("./platform", () => ({ HAS_NATIVE_GLASS: true, IS_MAC: true }));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});

const preset = (name: string) =>
  ACCENT_PRESETS.find((candidate) => candidate.name === name)!;

describe("accent colours", () => {
  it("offers distinct palette accents, Aven's neutral default first and Blue next", () => {
    expect(ACCENT_PRESETS[0]).toMatchObject({
      name: "Aven",
      label: "Neutral",
      colors: {
        dark: { accent: "#e8e8ea", highlight: "#a1a1a6" },
        light: {
          accent: AVEN_THEME_COLORS.light.accent,
          highlight: AVEN_THEME_COLORS.light.highlight,
        },
      },
    });
    expect(ACCENT_PRESETS[1]).toMatchObject({
      name: "Blue",
      label: "Blue",
      colors: {
        dark: { accent: "#57b5ff" },
        light: { accent: AVEN_BLUE_THEME_COLORS.light.accent },
      },
    });
    // Mono's near-white would be a near-twin of the neutral default.
    expect(ACCENT_PRESETS.map((accent) => accent.name)).not.toContain("Mono");
    for (const accent of ACCENT_PRESETS) {
      const palette = WORKSPACE_THEME_PRESETS.find(
        (candidate) => candidate.name === accent.name,
      )!;
      expect(accent.colors.dark.accent).toBe(palette.colors.dark.accent);
      expect(accent.colors.light.accent).toBe(palette.colors.light.accent);
    }
    const dark = accentSwatches("dark").map(
      (swatch) => swatch.colors.dark.accent,
    );
    expect(dark).toHaveLength(ACCENT_PRESETS.length);
    expect(new Set(dark).size).toBe(dark.length);
  });

  it("shows each shade once in light mode", () => {
    const light = accentSwatches("light");
    expect(light.map((swatch) => swatch.name)).not.toContain("Mono");
    expect(
      new Set(light.map((swatch) => swatch.colors.light.accent)).size,
    ).toBe(light.length);
  });

  it("selects the swatch for the accent in use, or none for a custom colour", () => {
    const theme = defaultWorkspaceTheme();
    expect(selectedAccentPreset(theme, "dark")?.name).toBe("Aven");
    expect(selectedAccentPreset(theme, "light")?.name).toBe("Aven");
    const forest = {
      ...theme,
      colors: withAccentPreset(theme.colors, preset("Forest")),
    };
    expect(selectedAccentPreset(forest, "dark")?.name).toBe("Forest");
    expect(selectedAccentPreset(forest, "light")?.name).toBe("Forest");
    const custom = {
      ...theme,
      colors: withCustomAccent(theme.colors, "#ff00aa"),
    };
    expect(selectedAccentPreset(custom, "dark")).toBeNull();
    expect(selectedAccentPreset(custom, "light")).toBeNull();
  });

  it("keeps Blue and a custom blue as chosen; the former default turns neutral", () => {
    const theme = defaultWorkspaceTheme();
    saveWorkspaceTheme("blue", {
      colors: withAccentPreset(theme.colors, preset("Blue")),
    });
    expect(selectedAccentPreset(loadWorkspaceTheme("blue"), "dark")?.name).toBe(
      "Blue",
    );
    expect(loadWorkspaceTheme("blue").colors?.dark?.accent).toBe("#57b5ff");
    saveWorkspaceCustomAccent("custom", "#57b5ff");
    expect(loadWorkspaceTheme("custom").colors?.dark?.accent).toBe("#57b5ff");
    saveWorkspaceTheme("former", {
      colors: {
        dark: {
          background: "#000000",
          accent: "#57b5ff",
          highlight: "#57b5ff",
        },
      },
    });
    expect(loadWorkspaceTheme("former").colors?.dark).toEqual(
      AVEN_THEME_COLORS.dark,
    );
    expect(
      selectedAccentPreset(loadWorkspaceTheme("former"), "dark")?.name,
    ).toBe("Aven");
  });

  it("sets a palette accent in both modes and keeps the backgrounds", () => {
    saveWorkspaceTheme("work", {
      colors: {
        dark: {
          background: "#000000",
          accent: "#57b5ff",
          highlight: "#57b5ff",
        },
        light: { background: "#fafafa" },
      },
      opacity: 0.35,
      blur: 11,
    });
    const next = saveWorkspaceAccentPreset("work", preset("Rose"));
    expect(next).toMatchObject({ opacity: 0.35, blur: 11 });
    expect(loadWorkspaceTheme("work").colors).toEqual({
      dark: {
        background: "#000000",
        accent: "#deb0c2",
        highlight: "#b47891",
      },
      light: {
        background: "#fafafa",
        accent: "#93546c",
        highlight: "#c28ca0",
      },
    });
  });

  it("uses one custom colour in both modes with the highlight following it", () => {
    saveWorkspaceTheme("work", {
      colors: {
        dark: {
          background: "#000000",
          accent: "#57b5ff",
          highlight: "#57b5ff",
        },
        light: {
          background: "#ffffff",
          accent: "#0a0a0a",
          highlight: "#737373",
        },
      },
    });
    saveWorkspaceCustomAccent("work", "#FF00AA");
    expect(loadWorkspaceTheme("work").colors).toEqual({
      dark: { background: "#000000", accent: "#ff00aa" },
      light: { background: "#ffffff", accent: "#ff00aa" },
    });
    const before = loadWorkspaceTheme("work");
    expect(saveWorkspaceCustomAccent("work", "not a colour")).toEqual(before);
    expect(loadWorkspaceTheme("work")).toEqual(before);
  });

  it("adds an accent to a tint-only workspace without fixing its background", () => {
    expect(withCustomAccent(undefined, "#123456")).toEqual({
      dark: { accent: "#123456" },
      light: { accent: "#123456" },
    });
    expect(withAccentPreset(undefined, preset("Cove"))).toEqual({
      dark: { accent: "#5ed9d0", highlight: "#c6e8fa" },
      light: { accent: "#157d82", highlight: "#79bdd8" },
    });
  });
});
