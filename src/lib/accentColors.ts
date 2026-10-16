import {
  normalizeThemeColor,
  type ColorScheme,
  type ThemeColorOverrides,
} from "./appearance";
import {
  loadWorkspaceTheme,
  resolvedWorkspaceColors,
  saveWorkspaceTheme,
  WORKSPACE_THEME_PRESETS,
  type WorkspaceTheme,
} from "./workspaceThemes";

/** An accent from the workspace palettes, with its own dark and light shade
 *  and the highlight that palette pairs with it. */
export type AccentPreset = {
  name: string;
  label: string;
  colors: Record<ColorScheme, { accent: string; highlight: string }>;
};

/** Distinct accents from the existing workspace palettes, Aven's blue first. */
const ACCENT_PALETTES: readonly { name: string; label: string }[] = [
  { name: "Aven", label: "Aven blue" },
  { name: "Mono", label: "Mono" },
  { name: "Cove", label: "Cove" },
  { name: "Indigo", label: "Indigo" },
  { name: "Forest", label: "Forest" },
  { name: "Amber", label: "Amber" },
  { name: "Rose", label: "Rose" },
];

export const ACCENT_PRESETS: readonly AccentPreset[] = ACCENT_PALETTES.map(
  ({ name, label }) => {
    const palette = WORKSPACE_THEME_PRESETS.find(
      (preset) => preset.name === name,
    )!.colors;
    return {
      name,
      label,
      colors: {
        dark: {
          accent: palette.dark.accent,
          highlight: palette.dark.highlight,
        },
        light: {
          accent: palette.light.accent,
          highlight: palette.light.highlight,
        },
      },
    };
  },
);

/** The swatches to show in a mode, in that mode's own shade. Palettes that
 *  share a shade there (Aven and Mono are both near-black in light mode)
 *  show once. */
export function accentSwatches(scheme: ColorScheme): AccentPreset[] {
  const seen = new Set<string>();
  return ACCENT_PRESETS.filter((preset) => {
    const color = preset.colors[scheme].accent;
    if (seen.has(color)) return false;
    seen.add(color);
    return true;
  });
}

/** The swatch matching the accent in use, or null for a custom colour. */
export function selectedAccentPreset(
  theme: WorkspaceTheme,
  scheme: ColorScheme,
): AccentPreset | null {
  const accent = resolvedWorkspaceColors(theme, scheme).accent;
  return (
    accentSwatches(scheme).find(
      (preset) => preset.colors[scheme].accent === accent,
    ) ?? null
  );
}

/** A palette accent sets both modes, each in its readable shade, with the
 *  highlight that palette pairs with it. Backgrounds stay as they are. */
export function withAccentPreset(
  colors: ThemeColorOverrides | undefined,
  preset: AccentPreset,
): ThemeColorOverrides {
  return {
    dark: { ...colors?.dark, ...preset.colors.dark },
    light: { ...colors?.light, ...preset.colors.light },
  };
}

/** A custom accent is one colour in both modes. Its highlight follows it,
 *  so any saved highlight for either mode is dropped. */
export function withCustomAccent(
  colors: ThemeColorOverrides | undefined,
  color: string,
): ThemeColorOverrides {
  const accent = normalizeThemeColor(color);
  if (!accent) return { ...colors };
  const mode = (scheme: ColorScheme) => {
    const palette = { ...colors?.[scheme], accent };
    delete palette.highlight;
    return palette;
  };
  return { dark: mode("dark"), light: mode("light") };
}

export function saveWorkspaceAccentPreset(
  profileId: string,
  preset: AccentPreset,
): WorkspaceTheme {
  const current = loadWorkspaceTheme(profileId);
  return saveWorkspaceTheme(profileId, {
    colors: withAccentPreset(current.colors, preset),
  });
}

export function saveWorkspaceCustomAccent(
  profileId: string,
  color: string,
): WorkspaceTheme {
  const current = loadWorkspaceTheme(profileId);
  if (!normalizeThemeColor(color)) return current;
  return saveWorkspaceTheme(profileId, {
    colors: withCustomAccent(current.colors, color),
  });
}
