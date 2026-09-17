import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  applyBodyGlass,
  applySidebarBlur,
  applySidebarOpacity,
  applyThemeColors,
  applyThemePreference,
  applyThemeTint,
  AVEN_THEME_COLORS,
  BODY_GLASS_DEFAULT,
  COVE_THEME_COLORS,
  hasLegacyAppearancePreferences,
  loadBodyGlass,
  loadSidebarBlur,
  loadSidebarOpacity,
  loadThemeHue,
  loadThemePreference,
  loadThemeSaturation,
  normalizeThemeColor,
  resolveColorScheme,
  SIDEBAR_BLUR_MAX,
  SIDEBAR_BLUR_MIN,
  SIDEBAR_BLUR_DEFAULT,
  SIDEBAR_OPACITY_MAX,
  SIDEBAR_OPACITY_MIN,
  SIDEBAR_OPACITY_DEFAULT,
  THEME_HUE_MAX,
  THEME_HUE_MIN,
  THEME_HUE_DEFAULT,
  THEME_SATURATION_MAX,
  THEME_SATURATION_MIN,
  THEME_SATURATION_DEFAULT,
  THEME_PREFERENCE_DEFAULT,
  type ThemePreference,
  type ColorScheme,
  type ThemeColorOverrides,
  type ThemeColorTarget,
} from "./appearance";

export const WORKSPACE_THEMES_KEY = "monocode.personal.workspaceThemes.v1";
const THEME_CHANGED = "monocode:workspace-theme-changed";
const ACTIVE_THEME_CHANGED = "monocode:active-workspace-theme-changed";
let activeThemeProfileId = "personal";
let validatedSnapshot: string | null = null;

export type WorkspaceTheme = {
  hue: number;
  saturation: number;
  preference: ThemePreference;
  opacity: number;
  blur: number;
  bodyGlass: boolean;
  matchPanels: boolean;
  colors?: ThemeColorOverrides;
};
export type WorkspaceColorTarget = ThemeColorTarget;
export type WorkspaceColors = Record<WorkspaceColorTarget, string>;
export type WorkspaceThemePreset = {
  name: string;
  hue: number;
  saturation: number;
  colors: Record<ColorScheme, WorkspaceColors>;
};
type ThemeStore = {
  version: 1;
  fallback: WorkspaceTheme;
  themes: Record<string, WorkspaceTheme>;
};
function preset(
  name: string,
  hue: number,
  saturation: number,
  dark: [string, string, string],
  light: [string, string, string],
): WorkspaceThemePreset {
  const colors = ([background, accent, highlight]: [
    string,
    string,
    string,
  ]) => ({ background, accent, highlight });
  return {
    name,
    hue,
    saturation,
    colors: { dark: colors(dark), light: colors(light) },
  };
}

export const WORKSPACE_THEME_PRESETS: readonly WorkspaceThemePreset[] = [
  {
    name: "Aven",
    hue: THEME_HUE_DEFAULT,
    saturation: THEME_SATURATION_DEFAULT,
    colors: AVEN_THEME_COLORS,
  },
  {
    name: "Cove",
    hue: 180,
    saturation: 16,
    colors: COVE_THEME_COLORS,
  },
  preset(
    "Mist",
    224,
    20,
    ["#171b25", "#aab6d6", "#8794b6"],
    ["#e9edf5", "#64718d", "#9aa7c6"],
  ),
  preset(
    "Black",
    240,
    0,
    ["#000000", "#c4c4c8", "#85858f"],
    ["#ffffff", "#343438", "#757580"],
  ),
  preset(
    "Graphite",
    240,
    8,
    ["#171719", "#aaaab8", "#78788e"],
    ["#f0f0f3", "#555565", "#89899e"],
  ),
  preset(
    "Carbon",
    220,
    2,
    ["#101112", "#b2b8be", "#747f8a"],
    ["#f3f4f5", "#4d5965", "#8594a3"],
  ),
  preset(
    "Slate",
    215,
    14,
    ["#171e28", "#a0b7d1", "#6486af"],
    ["#edf1f6", "#3c5e85", "#789abe"],
  ),
  preset(
    "Midnight",
    226,
    22,
    ["#0b1020", "#9aaee0", "#5c78bf"],
    ["#edf0fa", "#405a96", "#849bd0"],
  ),
  preset(
    "Indigo",
    238,
    24,
    ["#17172d", "#b0adea", "#7971c9"],
    ["#f0effa", "#5e54a3", "#9a91d6"],
  ),
  preset(
    "Dusk",
    265,
    18,
    ["#21192c", "#c5afe0", "#9974bf"],
    ["#f4eff8", "#775491", "#b293c8"],
  ),
  preset(
    "Ocean",
    212,
    20,
    ["#14202d", "#9cc4e7", "#588fbf"],
    ["#edf4fa", "#356b98", "#7ba9ce"],
  ),
  preset(
    "Teal",
    180,
    20,
    ["#112526", "#8cccca", "#4d9996"],
    ["#eaf5f3", "#2a7370", "#78b1aa"],
  ),
  preset(
    "Sage",
    155,
    12,
    ["#1b2822", "#aecbb8", "#729983"],
    ["#eff5ef", "#4d7559", "#8aad93"],
  ),
  preset(
    "Forest",
    136,
    20,
    ["#142019", "#a2c7aa", "#63896b"],
    ["#edf3eb", "#486e4e", "#86a789"],
  ),
  preset(
    "Olive",
    72,
    18,
    ["#23261a", "#c4ca9c", "#949b62"],
    ["#f4f5e9", "#6c7540", "#a5af77"],
  ),
  preset(
    "Clay",
    24,
    16,
    ["#2a211b", "#d4b297", "#ac8061"],
    ["#f8f1ea", "#8c6041", "#bf997b"],
  ),
  preset(
    "Amber",
    38,
    24,
    ["#2a2215", "#debd82", "#b58d48"],
    ["#faf4e6", "#8f6b25", "#c5a264"],
  ),
  preset(
    "Sand",
    36,
    12,
    ["#292620", "#ccc2ac", "#a39678"],
    ["#f7f4ed", "#7b6d50", "#b7aa8d"],
  ),
  preset(
    "Rose",
    338,
    14,
    ["#2b1c23", "#deb0c2", "#b47891"],
    ["#faf0f3", "#93546c", "#c28ca0"],
  ),
];

function hslHex(hue: number, saturation: number, lightness: number): string {
  const light = lightness / 100;
  const chroma = (saturation / 100) * Math.min(light, 1 - light);
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    const value = light - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Picker values match the active mode; absent overrides retain the legacy tint. */
export function resolvedWorkspaceColors(
  theme: WorkspaceTheme,
  scheme: ColorScheme,
): WorkspaceColors {
  const dark = scheme === "dark";
  const legacyAccent = hslHex(theme.hue, dark ? 38 : 42, dark ? 66 : 38);
  const colors = theme.colors?.[scheme];
  return {
    background:
      normalizeThemeColor(colors?.background) ??
      hslHex(theme.hue, theme.saturation, dark ? 4 : 94),
    accent: normalizeThemeColor(colors?.accent) ?? legacyAccent,
    highlight:
      normalizeThemeColor(colors?.highlight) ??
      normalizeThemeColor(colors?.accent) ??
      legacyAccent,
  };
}

function normalizeColors(
  value: unknown,
  fallback?: ThemeColorOverrides,
): ThemeColorOverrides | undefined {
  if (value === undefined) return fallback;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fallback;
  const colors: ThemeColorOverrides = {};
  for (const scheme of ["dark", "light"] as const) {
    const candidate = (value as ThemeColorOverrides)[scheme];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      continue;
    const palette: Partial<WorkspaceColors> = {};
    for (const target of ["background", "accent", "highlight"] as const) {
      if (!(target in candidate)) continue;
      const color =
        normalizeThemeColor(candidate[target]) ??
        normalizeThemeColor(fallback?.[scheme]?.[target]);
      if (color) palette[target] = color;
    }
    if (Object.keys(palette).length) colors[scheme] = palette;
  }
  return Object.keys(colors).length ? colors : undefined;
}

export function defaultWorkspaceTheme(): WorkspaceTheme {
  return {
    hue: THEME_HUE_DEFAULT,
    saturation: THEME_SATURATION_DEFAULT,
    preference: THEME_PREFERENCE_DEFAULT,
    opacity: SIDEBAR_OPACITY_DEFAULT,
    blur: SIDEBAR_BLUR_DEFAULT,
    bodyGlass: BODY_GLASS_DEFAULT,
    matchPanels: false,
    colors: {
      dark: { ...AVEN_THEME_COLORS.dark },
      light: { ...AVEN_THEME_COLORS.light },
    },
  };
}

function legacyTheme(): WorkspaceTheme {
  if (!hasLegacyAppearancePreferences()) return defaultWorkspaceTheme();
  return {
    hue: loadThemeHue(),
    saturation: loadThemeSaturation(),
    preference: loadThemePreference(),
    opacity: loadSidebarOpacity(),
    blur: loadSidebarBlur(),
    bodyGlass: loadBodyGlass(),
    matchPanels: false,
  };
}
function numberInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  round = true,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const bounded = Math.max(min, Math.min(max, value));
  return round ? Math.round(bounded) : bounded;
}
export function normalizeWorkspaceTheme(
  value: unknown,
  fallback: WorkspaceTheme,
): WorkspaceTheme {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<WorkspaceTheme>)
      : {};
  const colors = normalizeColors(candidate.colors, fallback.colors);
  return {
    hue: numberInRange(
      candidate.hue,
      fallback.hue,
      THEME_HUE_MIN,
      THEME_HUE_MAX,
    ),
    saturation: numberInRange(
      candidate.saturation,
      fallback.saturation,
      THEME_SATURATION_MIN,
      THEME_SATURATION_MAX,
    ),
    preference:
      candidate.preference === "light" ||
      candidate.preference === "dark" ||
      candidate.preference === "system"
        ? candidate.preference
        : fallback.preference,
    opacity: numberInRange(
      candidate.opacity,
      fallback.opacity,
      SIDEBAR_OPACITY_MIN,
      SIDEBAR_OPACITY_MAX,
      false,
    ),
    blur: numberInRange(
      candidate.blur,
      fallback.blur,
      SIDEBAR_BLUR_MIN,
      SIDEBAR_BLUR_MAX,
    ),
    bodyGlass:
      typeof candidate.bodyGlass === "boolean"
        ? candidate.bodyGlass
        : fallback.bodyGlass,
    matchPanels:
      typeof candidate.matchPanels === "boolean"
        ? candidate.matchPanels
        : fallback.matchPanels,
    ...(colors ? { colors } : {}),
  };
}
function validId(id: string) {
  return !!id && !["__proto__", "prototype", "constructor"].includes(id);
}

/** Only an inherited, complete stock fallback is distinguishable from a custom theme. */
function isHistoricalStockFallback(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const theme = value as Partial<WorkspaceTheme>;
  return (
    theme.hue === 240 &&
    theme.saturation === 8 &&
    theme.preference === "dark" &&
    theme.opacity === 0.15 &&
    theme.blur === 0 &&
    theme.bodyGlass === true &&
    theme.colors === undefined &&
    theme.matchPanels !== true
  );
}

function parseStore(raw: string | null): ThemeStore | null {
  try {
    const parsed = JSON.parse(raw ?? "null") as Partial<ThemeStore> | null;
    if (
      !parsed ||
      parsed.version !== 1 ||
      !parsed.fallback ||
      typeof parsed.fallback !== "object"
    )
      return null;
    // Saved records without color overrides deliberately use their tint. Do not
    // inject brand colors into customized palettes during normalization.
    const previousFallback = normalizeWorkspaceTheme(parsed.fallback, {
      ...legacyTheme(),
      colors: undefined,
    });
    const fallback =
      isHistoricalStockFallback(parsed.fallback) &&
      !hasLegacyAppearancePreferences()
        ? defaultWorkspaceTheme()
        : previousFallback;
    const themes: Record<string, WorkspaceTheme> = {};
    if (
      parsed.themes &&
      typeof parsed.themes === "object" &&
      !Array.isArray(parsed.themes)
    ) {
      for (const [id, theme] of Object.entries(parsed.themes)) {
        if (validId(id))
          themes[id] = normalizeWorkspaceTheme(theme, {
            ...previousFallback,
            colors: undefined,
          });
      }
    }
    return { version: 1, fallback, themes };
  } catch {
    return null;
  }
}

/** Capture the legacy appearance once, so untouched workspaces do not inherit later edits. */
function themeSnapshot(): string {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(WORKSPACE_THEMES_KEY);
  } catch {
    /* Browser storage unavailable. */
  }
  if (raw && raw === validatedSnapshot) return raw;
  // Persist newly added fields once. Otherwise a legacy palette-only record
  // could keep inheriting changes to global glass settings on every read.
  const initial = JSON.stringify(
    parseStore(raw) ??
      ({
        version: 1,
        fallback: legacyTheme(),
        themes: {},
      } satisfies ThemeStore),
  );
  try {
    if (raw !== initial) localStorage.setItem(WORKSPACE_THEMES_KEY, initial);
  } catch {
    /* Keep the legacy fallback usable. */
  }
  validatedSnapshot = initial;
  return initial;
}
function readThemeStore(): ThemeStore {
  return parseStore(themeSnapshot())!;
}
export function loadWorkspaceTheme(profileId: string): WorkspaceTheme {
  const store = readThemeStore();
  return store.themes[profileId] ?? store.fallback;
}
export function saveWorkspaceTheme(
  profileId: string,
  patch: Partial<WorkspaceTheme>,
): WorkspaceTheme {
  const store = readThemeStore();
  const current = store.themes[profileId] ?? store.fallback;
  if (!validId(profileId)) return current;
  // Legacy tint sliders remain useful after an explicit palette selection.
  // Only the edited mode returns to tint colors; the other mode stays saved.
  let colors = patch.colors ?? current.colors;
  if (
    [patch.hue, patch.saturation].some(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) &&
    patch.colors === undefined &&
    colors
  ) {
    colors = { ...colors };
    delete colors[resolveColorScheme(patch.preference ?? current.preference)];
  }
  const next = normalizeWorkspaceTheme(
    { ...current, ...patch, colors },
    current,
  );
  try {
    localStorage.setItem(
      WORKSPACE_THEMES_KEY,
      JSON.stringify({
        ...store,
        themes: { ...store.themes, [profileId]: next },
      }),
    );
  } catch {
    /* A preference write must never block project navigation. */
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(THEME_CHANGED));
  return next;
}
/** Replace destination appearance as one preference write. This is a copy,
 * not a link: later edits stay local to their workspace. */
export function copyWorkspaceTheme(
  profileId: string,
  targetProfileIds: readonly string[],
): boolean {
  if (!validId(profileId)) return false;
  const store = readThemeStore();
  const source = store.themes[profileId] ?? store.fallback;
  const targets = [...new Set(targetProfileIds)].filter(
    (id) => validId(id) && id !== profileId,
  );
  if (!targets.length) return true;
  const themes = { ...store.themes };
  // Full replacement also removes old destination palette overrides when
  // the source uses tint colors. Patch/merge semantics cannot do that.
  for (const id of targets) themes[id] = source;
  const snapshot = JSON.stringify({ ...store, themes });
  try {
    localStorage.setItem(WORKSPACE_THEMES_KEY, snapshot);
  } catch {
    return false;
  }
  validatedSnapshot = snapshot;
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(THEME_CHANGED));
  return true;
}

export function resetWorkspaceTheme(profileId: string) {
  return saveWorkspaceTheme(profileId, defaultWorkspaceTheme());
}

export function saveWorkspaceColor(
  profileId: string,
  scheme: ColorScheme,
  target: WorkspaceColorTarget,
  color: string | null,
): WorkspaceTheme {
  const current = loadWorkspaceTheme(profileId);
  const normalized = normalizeThemeColor(color);
  if (color !== null && !normalized) return current;
  const palette = { ...current.colors?.[scheme] };
  if (normalized) palette[target] = normalized;
  else delete palette[target];
  return saveWorkspaceTheme(profileId, {
    colors: { ...current.colors, [scheme]: palette },
  });
}

export function applyWorkspaceThemePreset(
  profileId: string,
  selected: WorkspaceThemePreset,
  scheme: ColorScheme,
): WorkspaceTheme {
  const current = loadWorkspaceTheme(profileId);
  return saveWorkspaceTheme(profileId, {
    colors: { ...current.colors, [scheme]: selected.colors[scheme] },
  });
}
function subscribeThemes(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === WORKSPACE_THEMES_KEY) onChange();
  };
  window.addEventListener(THEME_CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(THEME_CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
export function useWorkspaceTheme(profileId: string) {
  const snapshot = useSyncExternalStore(
    subscribeThemes,
    themeSnapshot,
    themeSnapshot,
  );
  return useMemo(() => {
    const store = parseStore(snapshot)!;
    return store.themes[profileId] ?? store.fallback;
  }, [snapshot, profileId]);
}
function subscribeActiveTheme(onChange: () => void) {
  window.addEventListener(ACTIVE_THEME_CHANGED, onChange);
  return () => window.removeEventListener(ACTIVE_THEME_CHANGED, onChange);
}
export function useActiveWorkspaceTheme() {
  const profileId = useSyncExternalStore(
    subscribeActiveTheme,
    () => activeThemeProfileId,
    () => "personal",
  );
  const theme = useWorkspaceTheme(profileId);
  return { profileId, theme };
}

/** Selection applies the destination theme directly; it never writes the outgoing DOM theme back. */
export function useActivateWorkspaceTheme(profileId: string) {
  const theme = useWorkspaceTheme(profileId);
  const appliedPreference = useRef<ThemePreference | null>(null);
  const appliedBlur = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (activeThemeProfileId !== profileId) {
      activeThemeProfileId = profileId;
      window.dispatchEvent(new Event(ACTIVE_THEME_CHANGED));
    }
    applyThemeTint(theme.hue, theme.saturation);
    applyThemeColors(theme.colors);
    applySidebarOpacity(theme.opacity);
    applyBodyGlass(theme.bodyGlass);
    document.documentElement.classList.toggle(
      "match-workspace-panels",
      theme.matchPanels,
    );
    if (appliedBlur.current !== theme.blur) {
      appliedBlur.current = theme.blur;
      applySidebarBlur(theme.blur);
    }
    // Hue sliders need no native-window IPC or repeated scheme events.
    if (appliedPreference.current !== theme.preference) {
      appliedPreference.current = theme.preference;
      applyThemePreference(theme.preference);
    }
  }, [
    profileId,
    theme.hue,
    theme.saturation,
    theme.preference,
    theme.opacity,
    theme.blur,
    theme.bodyGlass,
    theme.matchPanels,
    theme.colors?.dark?.background,
    theme.colors?.dark?.accent,
    theme.colors?.dark?.highlight,
    theme.colors?.light?.background,
    theme.colors?.light?.accent,
    theme.colors?.light?.highlight,
  ]);
}
