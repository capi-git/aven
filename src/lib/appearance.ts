import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HAS_NATIVE_GLASS, IS_MAC } from "./platform";
import { applyUiScale, loadUiScale } from "./uiScale";

const THEME_HUE_KEY = "monocode.themeHue";
const THEME_SATURATION_KEY = "monocode.themeSaturation";
const OPACITY_KEY = "monocode.sidebarOpacity";
const BLUR_KEY = "monocode.sidebarBlur";
const PROJECT_RAIL_OPEN_KEY = "monocode.projectRailOpen";
const BODY_KEY = "monocode.bodyGlass";
const SCHEME_KEY = "monocode.colorScheme";
const SIDEBAR_TAB_ORDER_KEY = "monocode.sidebarTabOrder";
const PROJECT_RAIL_WIDTH_KEY = "monocode.projectRailWidth";
const TRANSCRIPT_LAYOUT_KEY = "monocode.transcriptLayout";
const TRANSCRIPT_ANCHOR_KEY = "monocode.transcriptAnchor";
const CHAT_BACKGROUND_PATH_KEY = "monocode.chatBackgroundPath";
const CHAT_BACKGROUND_OPACITY_KEY = "monocode.chatBackgroundOpacity";
const CHAT_BACKGROUND_SCOPE_KEY = "monocode.chatBackgroundScope";
const CHANGES_VIEW_KEY = "monocode.changesView";
let chatBackgroundRevision = Date.now();
let nativeGlassReady = false;
let appliedThemePreference: ThemePreference | null = null;
let appliedNativeBlur: number | null = null;
let appliedThemeColors: ThemeColorOverrides = {};

export const CHAT_BACKGROUND_PATH_CHANGE_EVENT =
  "monocode:chat-background-path-change";

export type ColorScheme = "dark" | "light";
export type ThemePreference = ColorScheme | "system";
export type ThemeColorTarget = "background" | "accent" | "highlight";
export type ThemeColorOverrides = Partial<
  Record<ColorScheme, Partial<Record<ThemeColorTarget, string>>>
>;
export type TranscriptLayout = "full" | "chat";
export type ChatBackgroundScope = "empty" | "all";
export type ChangesView = "list" | "tree";

export const THEME_PREFERENCE_DEFAULT: ThemePreference = "dark";

/** Aven's monochrome default. Saved workspace palettes remain independent. */
export const AVEN_THEME_COLORS = {
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
} satisfies Record<ColorScheme, Record<ThemeColorTarget, string>>;

/** The former sky-blue default, kept selectable; saved colors are not rewritten. */
export const SKY_THEME_COLORS = {
  dark: {
    background: "#0b121a",
    accent: "#6cabdd",
    highlight: "#d7eefc",
  },
  light: {
    background: "#edf5fc",
    accent: "#286b9f",
    highlight: "#6cabdd",
  },
} satisfies Record<ColorScheme, Record<ThemeColorTarget, string>>;

/** Retained as a selectable palette; the rebrand never rewrites saved colors. */
export const COVE_THEME_COLORS = {
  dark: {
    background: "#101416",
    accent: "#5ed9d0",
    highlight: "#c6e8fa",
  },
  light: {
    background: "#edf5f7",
    accent: "#157d82",
    highlight: "#79bdd8",
  },
} satisfies Record<ColorScheme, Record<ThemeColorTarget, string>>;

/** Fired on `window` whenever the color scheme flips (detail: ColorScheme). */
export const SCHEME_CHANGE_EVENT = "monocode:schemechange";

export const TRANSCRIPT_LAYOUT_DEFAULT: TranscriptLayout = "chat";

export const CHANGES_VIEW_DEFAULT: ChangesView = "list";

export const TRANSCRIPT_ANCHOR_DEFAULT = true;

/** Fired on `window` whenever prompt-to-top anchoring flips (detail: boolean). */
export const TRANSCRIPT_ANCHOR_CHANGE_EVENT = "monocode:transcriptanchorchange";

/** Fired on `window` whenever the transcript layout flips (detail: TranscriptLayout). */
export const TRANSCRIPT_LAYOUT_CHANGE_EVENT = "monocode:transcriptlayoutchange";

export type SidebarTabId = "files" | "sessions" | "changes" | "inbox";

const DEFAULT_SIDEBAR_TAB_ORDER: SidebarTabId[] = [
  "sessions",
  "inbox",
  "files",
  "changes",
];

export const THEME_HUE_MIN = 0;
export const THEME_HUE_MAX = 360;
export const THEME_HUE_DEFAULT = 207;
const LEGACY_THEME_HUE_DEFAULT = 180;

export const THEME_SATURATION_MIN = 0;
export const THEME_SATURATION_MAX = 100;
export const THEME_SATURATION_DEFAULT = 0;
/** Sky's tint strength, also the default for older standalone preferences. */
export const SKY_THEME_SATURATION = 16;

export const SIDEBAR_OPACITY_MIN = 0.05;
export const SIDEBAR_OPACITY_MAX = 1;
export const SIDEBAR_OPACITY_DEFAULT = 1;

export const SIDEBAR_BLUR_MIN = 0;
export const SIDEBAR_BLUR_MAX = 64;
export const SIDEBAR_BLUR_DEFAULT = 0;

export const PROJECT_RAIL_WIDTH_MIN = 180;
export const PROJECT_RAIL_WIDTH_MAX = 360;
export const PROJECT_RAIL_WIDTH_DEFAULT = 200;

export const BODY_GLASS_DEFAULT = false;

export const CHAT_BACKGROUND_OPACITY_MIN = 0.05;
export const CHAT_BACKGROUND_OPACITY_MAX = 0.65;
export const CHAT_BACKGROUND_OPACITY_DEFAULT = 0.24;
export const CHAT_BACKGROUND_SCOPE_DEFAULT: ChatBackgroundScope = "all";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // private mode / quota
  }
}

function readFlag(key: string): boolean | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return raw === "1" || raw === "true";
  } catch {
    return null;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // private mode / quota
  }
}

/** Presence matters: an explicitly saved old default is still a user preference. */
export function hasLegacyAppearancePreferences(): boolean {
  try {
    return [
      THEME_HUE_KEY,
      THEME_SATURATION_KEY,
      SCHEME_KEY,
      OPACITY_KEY,
      BLUR_KEY,
      BODY_KEY,
    ].some((key) => localStorage.getItem(key) !== null);
  } catch {
    return false;
  }
}

export function loadThemeHue(): number {
  return Math.round(
    clamp(
      readNumber(THEME_HUE_KEY) ??
        (hasLegacyAppearancePreferences()
          ? LEGACY_THEME_HUE_DEFAULT
          : THEME_HUE_DEFAULT),
      THEME_HUE_MIN,
      THEME_HUE_MAX,
    ),
  );
}

export function saveThemeHue(value: number) {
  writeNumber(
    THEME_HUE_KEY,
    Math.round(clamp(value, THEME_HUE_MIN, THEME_HUE_MAX)),
  );
}

export function loadThemeSaturation(): number {
  return Math.round(
    clamp(
      readNumber(THEME_SATURATION_KEY) ??
        (hasLegacyAppearancePreferences()
          ? SKY_THEME_SATURATION
          : THEME_SATURATION_DEFAULT),
      THEME_SATURATION_MIN,
      THEME_SATURATION_MAX,
    ),
  );
}

export function saveThemeSaturation(value: number) {
  writeNumber(
    THEME_SATURATION_KEY,
    Math.round(clamp(value, THEME_SATURATION_MIN, THEME_SATURATION_MAX)),
  );
}

export function applyThemeTint(hue: number, saturation: number) {
  const nextHue = Math.round(clamp(hue, THEME_HUE_MIN, THEME_HUE_MAX));
  const nextSaturation = Math.round(
    clamp(saturation, THEME_SATURATION_MIN, THEME_SATURATION_MAX),
  );
  document.documentElement.style.setProperty("--theme-hue", String(nextHue));
  document.documentElement.style.setProperty(
    "--theme-saturation",
    `${nextSaturation}%`,
  );
  return { hue: nextHue, saturation: nextSaturation };
}

/** Only plain hex colors enter CSS; accept shorthand from native color controls. */
export function normalizeThemeColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/.test(hex))
    return `#${[...hex.slice(1)].map((digit) => digit + digit).join("")}`;
  return null;
}

/** Neutral foreground with readable contrast even for a bright custom background. */
export function themeForeground(background: string): string {
  const hex = normalizeThemeColor(background);
  if (!hex) return "#ededed";
  const channels = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

function paintThemeColors(scheme: ColorScheme) {
  const root = document.documentElement;
  const colors = appliedThemeColors[scheme];
  for (const target of ["background", "accent", "highlight"] as const) {
    const color = normalizeThemeColor(colors?.[target]);
    const property = `--theme-${target}-color`;
    if (color) root.style.setProperty(property, color);
    else root.style.removeProperty(property);
  }
  const background = normalizeThemeColor(colors?.background);
  if (background) {
    const foreground = themeForeground(background);
    root.style.setProperty("--theme-content-color", foreground);
    // The light shell lifts pale frames toward white. A dark custom frame
    // needs its original surface so the shared light foreground stays legible.
    root.style.setProperty(
      "--theme-light-surface-color",
      foreground === "#ffffff"
        ? background
        : `color-mix(in srgb, ${background} 32%, #ffffff)`,
    );
  } else {
    root.style.removeProperty("--theme-content-color");
    root.style.removeProperty("--theme-light-surface-color");
  }
}

/** Palette changes are CSS-only. Mode changes reuse these overrides without storage writes. */
export function applyThemeColors(colors: ThemeColorOverrides = {}) {
  appliedThemeColors = colors;
  paintThemeColors(isLightScheme() ? "light" : "dark");
}

export function initAppearance() {
  document.documentElement.classList.toggle("is-mac", IS_MAC);
  document.documentElement.classList.toggle(
    "has-native-glass",
    HAS_NATIVE_GLASS,
  );
  applyThemeTint(loadThemeHue(), loadThemeSaturation());
  applyThemeColors(hasLegacyAppearancePreferences() ? {} : AVEN_THEME_COLORS);
  applyThemePreference(loadThemePreference());
  watchSystemColorScheme();
  applySidebarOpacity(loadSidebarOpacity());
  applySidebarBlur(loadSidebarBlur());
  applyBodyGlass(loadBodyGlass());
  applyChatBackground(loadChatBackgroundPath());
  applyChatBackgroundOpacity(loadChatBackgroundOpacity());
  applyChatBackgroundScope(loadChatBackgroundScope());
  void applyUiScale(loadUiScale());
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "dark" || value === "light" || value === "system";
}

export function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(SCHEME_KEY);
    return isThemePreference(raw) ? raw : THEME_PREFERENCE_DEFAULT;
  } catch {
    return THEME_PREFERENCE_DEFAULT;
  }
}

export function saveThemePreference(value: ThemePreference) {
  try {
    localStorage.setItem(SCHEME_KEY, value);
  } catch {
    // private mode / quota
  }
}

function systemQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  return window.matchMedia("(prefers-color-scheme: light)");
}

function systemColorScheme(): ColorScheme {
  return systemQuery()?.matches ? "light" : "dark";
}

export function resolveColorScheme(value: ThemePreference): ColorScheme {
  return value === "system" ? systemColorScheme() : value;
}

export function isLightScheme(): boolean {
  return document.documentElement.classList.contains("theme-light");
}

export function applyThemePreference(value: ThemePreference): ColorScheme {
  appliedThemePreference = value;
  const next = resolveColorScheme(value);
  document.documentElement.classList.toggle("theme-light", next === "light");
  paintThemeColors(next);
  if (nativeGlassReady) syncNativeGlass(next);
  window.dispatchEvent(
    new CustomEvent<ColorScheme>(SCHEME_CHANGE_EVENT, { detail: next }),
  );
  return next;
}

function syncNativeGlass(scheme: ColorScheme) {
  void invoke("set_window_glass_enabled", {
    enabled: HAS_NATIVE_GLASS && scheme === "dark",
  })
    .then(() => {
      if (!HAS_NATIVE_GLASS) {
        const currentScheme = isLightScheme() ? "light" : "dark";
        return getCurrentWindow().setBackgroundColor(
          normalizeThemeColor(appliedThemeColors[currentScheme]?.background) ??
            AVEN_THEME_COLORS[currentScheme].background,
        );
      }
    })
    .catch(() => {
      // Browser previews have no native window.
    });
}

/** Synchronizes native appearance after the first opaque frame is ready. */
export function activateWindowAppearance() {
  nativeGlassReady = true;
  syncNativeGlass(isLightScheme() ? "light" : "dark");
}

/** Keeps the "system" preference in sync when the OS flips appearance. */
export function watchSystemColorScheme() {
  const query = systemQuery();
  if (!query) return;
  query.addEventListener("change", () => {
    const preference = appliedThemePreference ?? loadThemePreference();
    if (preference === "system") applyThemePreference(preference);
  });
}

export function loadSidebarOpacity(): number {
  return clamp(
    readNumber(OPACITY_KEY) ?? SIDEBAR_OPACITY_DEFAULT,
    SIDEBAR_OPACITY_MIN,
    SIDEBAR_OPACITY_MAX,
  );
}

export function saveSidebarOpacity(value: number) {
  writeNumber(
    OPACITY_KEY,
    clamp(value, SIDEBAR_OPACITY_MIN, SIDEBAR_OPACITY_MAX),
  );
}

export function applySidebarOpacity(value: number) {
  const next = HAS_NATIVE_GLASS
    ? clamp(value, SIDEBAR_OPACITY_MIN, SIDEBAR_OPACITY_MAX)
    : 1;
  document.documentElement.style.setProperty("--sidebar-opacity", String(next));
  return next;
}

export function loadSidebarBlur(): number {
  return Math.round(
    clamp(
      readNumber(BLUR_KEY) ?? SIDEBAR_BLUR_DEFAULT,
      SIDEBAR_BLUR_MIN,
      SIDEBAR_BLUR_MAX,
    ),
  );
}

export function saveSidebarBlur(value: number) {
  writeNumber(
    BLUR_KEY,
    Math.round(clamp(value, SIDEBAR_BLUR_MIN, SIDEBAR_BLUR_MAX)),
  );
}

export function applySidebarBlur(value: number) {
  const next = Math.round(clamp(value, SIDEBAR_BLUR_MIN, SIDEBAR_BLUR_MAX));
  if (HAS_NATIVE_GLASS && appliedNativeBlur !== next) {
    appliedNativeBlur = next;
    void invoke("set_window_background_blur", { radius: next }).catch(() => {
      // A browser preview has no native window. A later real change can retry.
      if (appliedNativeBlur === next) appliedNativeBlur = null;
    });
  }
  return next;
}

export function loadBodyGlass(): boolean {
  // Preserve the preference during migration even on a platform without glass.
  return readFlag(BODY_KEY) ?? BODY_GLASS_DEFAULT;
}

export function saveBodyGlass(value: boolean) {
  writeFlag(BODY_KEY, value);
}

export function applyBodyGlass(value: boolean) {
  const next = HAS_NATIVE_GLASS && value;
  document.documentElement.classList.toggle("glass-body", next);
  return next;
}

export function loadChatBackgroundPath(): string | null {
  try {
    return localStorage.getItem(CHAT_BACKGROUND_PATH_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function saveChatBackgroundPath(value: string | null) {
  try {
    if (value) localStorage.setItem(CHAT_BACKGROUND_PATH_KEY, value);
    else localStorage.removeItem(CHAT_BACKGROUND_PATH_KEY);
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHAT_BACKGROUND_PATH_CHANGE_EVENT));
}

export function subscribeChatBackgroundPath(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHAT_BACKGROUND_PATH_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(
      CHAT_BACKGROUND_PATH_CHANGE_EVENT,
      onStoreChange,
    );
}

export function applyChatBackground(path: string | null) {
  const root = document.documentElement;
  root.classList.toggle("has-chat-background", !!path);
  if (!path) {
    root.style.removeProperty("--chat-background-image");
    return null;
  }
  chatBackgroundRevision += 1;
  const src = chatBackgroundSrc(path);
  root.style.setProperty(
    "--chat-background-image",
    `url(${JSON.stringify(src)})`,
  );
  return path;
}

export function chatBackgroundSrc(path: string | null): string | null {
  return path ? `${convertFileSrc(path)}?v=${chatBackgroundRevision}` : null;
}

export function loadChatBackgroundOpacity(): number {
  return clamp(
    readNumber(CHAT_BACKGROUND_OPACITY_KEY) ?? CHAT_BACKGROUND_OPACITY_DEFAULT,
    CHAT_BACKGROUND_OPACITY_MIN,
    CHAT_BACKGROUND_OPACITY_MAX,
  );
}

export function saveChatBackgroundOpacity(value: number) {
  writeNumber(
    CHAT_BACKGROUND_OPACITY_KEY,
    clamp(value, CHAT_BACKGROUND_OPACITY_MIN, CHAT_BACKGROUND_OPACITY_MAX),
  );
}

export function applyChatBackgroundOpacity(value: number) {
  const next = clamp(
    value,
    CHAT_BACKGROUND_OPACITY_MIN,
    CHAT_BACKGROUND_OPACITY_MAX,
  );
  document.documentElement.style.setProperty(
    "--chat-background-opacity",
    String(next),
  );
  return next;
}

function isChatBackgroundScope(value: unknown): value is ChatBackgroundScope {
  return value === "empty" || value === "all";
}

export function loadChatBackgroundScope(): ChatBackgroundScope {
  try {
    const raw = localStorage.getItem(CHAT_BACKGROUND_SCOPE_KEY);
    return isChatBackgroundScope(raw) ? raw : CHAT_BACKGROUND_SCOPE_DEFAULT;
  } catch {
    return CHAT_BACKGROUND_SCOPE_DEFAULT;
  }
}

export function saveChatBackgroundScope(value: ChatBackgroundScope) {
  try {
    localStorage.setItem(CHAT_BACKGROUND_SCOPE_KEY, value);
  } catch {
    // private mode / quota
  }
}

export function applyChatBackgroundScope(value: ChatBackgroundScope) {
  document.documentElement.classList.toggle(
    "chat-background-empty-only",
    value === "empty",
  );
  return value;
}

function isSidebarTabId(value: unknown): value is SidebarTabId {
  return (
    value === "files" ||
    value === "sessions" ||
    value === "changes" ||
    value === "inbox"
  );
}

export function loadProjectRailOpen(): boolean {
  return readFlag(PROJECT_RAIL_OPEN_KEY) ?? true;
}

export function saveProjectRailOpen(value: boolean) {
  writeFlag(PROJECT_RAIL_OPEN_KEY, value);
}

export function loadSidebarTabOrder(): SidebarTabId[] {
  try {
    const raw = localStorage.getItem(SIDEBAR_TAB_ORDER_KEY);
    if (!raw) return [...DEFAULT_SIDEBAR_TAB_ORDER];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_SIDEBAR_TAB_ORDER];
    const next = parsed.filter(isSidebarTabId);
    for (const id of DEFAULT_SIDEBAR_TAB_ORDER) {
      if (!next.includes(id)) next.push(id);
    }
    return next.length === DEFAULT_SIDEBAR_TAB_ORDER.length
      ? next
      : [...DEFAULT_SIDEBAR_TAB_ORDER];
  } catch {
    return [...DEFAULT_SIDEBAR_TAB_ORDER];
  }
}

export function saveSidebarTabOrder(order: SidebarTabId[]) {
  try {
    localStorage.setItem(SIDEBAR_TAB_ORDER_KEY, JSON.stringify(order));
  } catch {
    // private mode / quota
  }
}

export function loadProjectRailWidth(): number {
  return Math.round(
    clamp(
      readNumber(PROJECT_RAIL_WIDTH_KEY) ?? PROJECT_RAIL_WIDTH_DEFAULT,
      PROJECT_RAIL_WIDTH_MIN,
      PROJECT_RAIL_WIDTH_MAX,
    ),
  );
}

export function saveProjectRailWidth(value: number) {
  writeNumber(
    PROJECT_RAIL_WIDTH_KEY,
    Math.round(clamp(value, PROJECT_RAIL_WIDTH_MIN, PROJECT_RAIL_WIDTH_MAX)),
  );
}

function isTranscriptLayout(value: unknown): value is TranscriptLayout {
  return value === "full" || value === "chat";
}

export function loadTranscriptLayout(): TranscriptLayout {
  try {
    const raw = localStorage.getItem(TRANSCRIPT_LAYOUT_KEY);
    return isTranscriptLayout(raw) ? raw : TRANSCRIPT_LAYOUT_DEFAULT;
  } catch {
    return TRANSCRIPT_LAYOUT_DEFAULT;
  }
}

export function saveTranscriptLayout(value: TranscriptLayout) {
  const next = isTranscriptLayout(value) ? value : TRANSCRIPT_LAYOUT_DEFAULT;
  try {
    localStorage.setItem(TRANSCRIPT_LAYOUT_KEY, next);
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<TranscriptLayout>(TRANSCRIPT_LAYOUT_CHANGE_EVENT, {
      detail: next,
    }),
  );
}

function isChangesView(value: unknown): value is ChangesView {
  return value === "list" || value === "tree";
}

export function loadChangesView(): ChangesView {
  try {
    const raw = localStorage.getItem(CHANGES_VIEW_KEY);
    return isChangesView(raw) ? raw : CHANGES_VIEW_DEFAULT;
  } catch {
    return CHANGES_VIEW_DEFAULT;
  }
}

export function saveChangesView(value: ChangesView) {
  try {
    localStorage.setItem(CHANGES_VIEW_KEY, value);
  } catch {
    // private mode / quota
  }
}

export function loadTranscriptAnchor(): boolean {
  return readFlag(TRANSCRIPT_ANCHOR_KEY) ?? TRANSCRIPT_ANCHOR_DEFAULT;
}

export function saveTranscriptAnchor(value: boolean) {
  writeFlag(TRANSCRIPT_ANCHOR_KEY, value);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<boolean>(TRANSCRIPT_ANCHOR_CHANGE_EVENT, {
      detail: value,
    }),
  );
}
