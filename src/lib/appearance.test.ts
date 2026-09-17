import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_BACKGROUND_OPACITY_DEFAULT,
  CHAT_BACKGROUND_SCOPE_DEFAULT,
  loadChatBackgroundOpacity,
  loadChatBackgroundPath,
  loadChatBackgroundScope,
  loadTranscriptLayout,
  saveChatBackgroundOpacity,
  saveChatBackgroundPath,
  saveChatBackgroundScope,
  saveTranscriptLayout,
  TRANSCRIPT_LAYOUT_DEFAULT,
  loadTranscriptAnchor,
  saveTranscriptAnchor,
  TRANSCRIPT_ANCHOR_DEFAULT,
  loadThemePreference,
  saveThemePreference,
  resolveColorScheme,
  THEME_PREFERENCE_DEFAULT,
  normalizeThemeColor,
  themeForeground,
  applyThemeColors,
  hasLegacyAppearancePreferences,
  loadThemeHue,
  loadThemeSaturation,
  loadSidebarOpacity,
  loadSidebarBlur,
  loadBodyGlass,
} from "./appearance";

describe("custom theme colors", () => {
  it("normalizes only plain opaque hex colors", () => {
    expect(normalizeThemeColor(" #AbC ")).toBe("#aabbcc");
    expect(normalizeThemeColor("#000000")).toBe("#000000");
    expect(normalizeThemeColor("#Ff11Aa")).toBe("#ff11aa");
    for (const value of [
      null,
      1,
      "black",
      "#abcd",
      "#12345678",
      "var(--x)",
      "url(test)",
      "#nothex",
    ])
      expect(normalizeThemeColor(value)).toBeNull();
  });

  it("keeps body text readable on black, white and mid-tone custom backgrounds", () => {
    expect(themeForeground("#000000")).toBe("#ffffff");
    expect(themeForeground("#ffffff")).toBe("#000000");
    expect(themeForeground("#777777")).toBe("#000000");
    expect(themeForeground("#303040")).toBe("#ffffff");
  });
});

describe("light workspace surfaces", () => {
  let properties: Map<string, string>;
  beforeEach(() => {
    properties = new Map();
    vi.stubGlobal("document", {
      documentElement: {
        classList: { contains: (name: string) => name === "theme-light" },
        style: {
          setProperty: (name: string, value: string) =>
            properties.set(name, value),
          removeProperty: (name: string) => properties.delete(name),
        },
      },
    });
  });
  afterEach(() => {
    applyThemeColors();
    vi.unstubAllGlobals();
  });

  it("keeps dark custom backgrounds dark when their text requires white", () => {
    for (const background of ["#000000", "#303040"]) {
      applyThemeColors({ light: { background } });
      expect(properties.get("--theme-content-color")).toBe("#ffffff");
      expect(properties.get("--theme-background-color")).toBe(background);
      expect(properties.get("--theme-light-surface-color")).toBe(background);
    }
  });

  it("lifts a pale frame toward white while keeping dark text", () => {
    applyThemeColors({ light: { background: "#e9edf5" } });
    expect(properties.get("--theme-background-color")).toBe("#e9edf5");
    expect(properties.get("--theme-content-color")).toBe("#000000");
    expect(properties.get("--theme-light-surface-color")).toBe(
      "color-mix(in srgb, #e9edf5 32%, #ffffff)",
    );
  });

  it("clears the derived surface when the next workspace has no custom background", () => {
    applyThemeColors({ light: { background: "#303040" } });
    applyThemeColors({ light: { accent: "#64718d" } });
    expect(properties.has("--theme-background-color")).toBe(false);
    expect(properties.has("--theme-content-color")).toBe(false);
    expect(properties.has("--theme-light-surface-color")).toBe(false);
    expect(properties.get("--theme-accent-color")).toBe("#64718d");
  });
});

const KEY = "monocode.transcriptLayout";
const SCHEME_KEY = "monocode.colorScheme";
const ANCHOR_KEY = "monocode.transcriptAnchor";
const CHAT_BACKGROUND_PATH_KEY = "monocode.chatBackgroundPath";
const CHAT_BACKGROUND_OPACITY_KEY = "monocode.chatBackgroundOpacity";
const CHAT_BACKGROUND_SCOPE_KEY = "monocode.chatBackgroundScope";

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

describe("Aven appearance defaults", () => {
  beforeEach(mockLocalStorage);

  it("uses a dark, opaque logo-matched tint without writing legacy settings", () => {
    expect(loadThemeHue()).toBe(207);
    expect(loadThemeSaturation()).toBe(16);
    expect(loadThemePreference()).toBe("dark");
    expect(loadSidebarOpacity()).toBe(1);
    expect(loadSidebarBlur()).toBe(0);
    expect(loadBodyGlass()).toBe(false);
    expect(hasLegacyAppearancePreferences()).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it("preserves explicitly saved legacy appearance, including old stock values", () => {
    localStorage.setItem("monocode.themeHue", "240");
    localStorage.setItem("monocode.themeSaturation", "8");
    localStorage.setItem("monocode.colorScheme", "system");
    localStorage.setItem("monocode.sidebarOpacity", "0.15");
    localStorage.setItem("monocode.sidebarBlur", "12");
    localStorage.setItem("monocode.bodyGlass", "1");
    expect(hasLegacyAppearancePreferences()).toBe(true);
    expect(loadThemeHue()).toBe(240);
    expect(loadThemeSaturation()).toBe(8);
    expect(loadThemePreference()).toBe("system");
    expect(loadSidebarOpacity()).toBe(0.15);
    expect(loadSidebarBlur()).toBe(12);
    expect(loadBodyGlass()).toBe(true);
    expect(localStorage.getItem("monocode.sidebarOpacity")).toBe("0.15");
  });

  it("retains the old tint when a legacy preference omitted the default hue", () => {
    localStorage.setItem("monocode.sidebarOpacity", "0.4");
    localStorage.setItem("monocode.themeSaturation", "22");
    expect(loadThemeHue()).toBe(180);
    expect(loadThemeSaturation()).toBe(22);
    expect(loadSidebarOpacity()).toBe(0.4);
    expect(localStorage.getItem("monocode.themeHue")).toBeNull();
  });

  it.each([
    "monocode.themeHue",
    "monocode.themeSaturation",
    "monocode.colorScheme",
    "monocode.sidebarOpacity",
    "monocode.sidebarBlur",
    "monocode.bodyGlass",
  ])("recognizes explicit preference presence at %s", (key) => {
    localStorage.setItem(key, "0");
    expect(hasLegacyAppearancePreferences()).toBe(true);
  });
});

describe("transcript layout setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it("defaults to the centered chat layout", () => {
    expect(TRANSCRIPT_LAYOUT_DEFAULT).toBe("chat");
    expect(loadTranscriptLayout()).toBe("chat");
  });

  it("persists the chat layout", () => {
    saveTranscriptLayout("chat");
    expect(localStorage.getItem(KEY)).toBe("chat");
    expect(loadTranscriptLayout()).toBe("chat");
    saveTranscriptLayout("full");
    expect(loadTranscriptLayout()).toBe("full");
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(KEY, "bubbles");
    expect(loadTranscriptLayout()).toBe("chat");
  });

  it("preserves a previously selected full-width layout", () => {
    localStorage.setItem(KEY, "full");
    expect(loadTranscriptLayout()).toBe("full");
    expect(localStorage.getItem(KEY)).toBe("full");
  });
});

describe("transcript prompt-to-top setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(ANCHOR_KEY);
  });

  it("defaults to on", () => {
    expect(TRANSCRIPT_ANCHOR_DEFAULT).toBe(true);
    expect(loadTranscriptAnchor()).toBe(true);
  });

  it("persists across loads", () => {
    saveTranscriptAnchor(true);
    expect(loadTranscriptAnchor()).toBe(true);
    saveTranscriptAnchor(false);
    expect(loadTranscriptAnchor()).toBe(false);
  });
});

describe("chat background setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(CHAT_BACKGROUND_PATH_KEY);
    localStorage.removeItem(CHAT_BACKGROUND_OPACITY_KEY);
    localStorage.removeItem(CHAT_BACKGROUND_SCOPE_KEY);
  });

  it("stores and clears the app-owned background path", () => {
    expect(loadChatBackgroundPath()).toBeNull();
    saveChatBackgroundPath("/app-data/backgrounds/chat-background.webp");
    expect(loadChatBackgroundPath()).toBe(
      "/app-data/backgrounds/chat-background.webp",
    );
    saveChatBackgroundPath(null);
    expect(loadChatBackgroundPath()).toBeNull();
  });

  it("defaults and clamps background visibility", () => {
    expect(loadChatBackgroundOpacity()).toBe(CHAT_BACKGROUND_OPACITY_DEFAULT);
    saveChatBackgroundOpacity(1);
    expect(loadChatBackgroundOpacity()).toBe(0.65);
    saveChatBackgroundOpacity(0);
    expect(loadChatBackgroundOpacity()).toBe(0.05);
  });

  it("persists where the background is shown", () => {
    expect(loadChatBackgroundScope()).toBe(CHAT_BACKGROUND_SCOPE_DEFAULT);
    saveChatBackgroundScope("empty");
    expect(loadChatBackgroundScope()).toBe("empty");
    saveChatBackgroundScope("all");
    expect(loadChatBackgroundScope()).toBe("all");
    localStorage.setItem(CHAT_BACKGROUND_SCOPE_KEY, "transcript");
    expect(loadChatBackgroundScope()).toBe(CHAT_BACKGROUND_SCOPE_DEFAULT);
  });
});

function mockSystemScheme(scheme: "dark" | "light") {
  Object.defineProperty(globalThis, "window", {
    value: {
      matchMedia: (query: string) => ({
        matches: query.includes("light") && scheme === "light",
      }),
    },
    configurable: true,
  });
}

describe("theme preference setting", () => {
  beforeEach(mockLocalStorage);
  afterEach(() => {
    localStorage.removeItem(SCHEME_KEY);
    Reflect.deleteProperty(globalThis, "window");
  });

  it("defaults to dark", () => {
    expect(THEME_PREFERENCE_DEFAULT).toBe("dark");
    expect(loadThemePreference()).toBe("dark");
  });

  it("persists each preference", () => {
    for (const value of ["system", "light", "dark"] as const) {
      saveThemePreference(value);
      expect(localStorage.getItem(SCHEME_KEY)).toBe(value);
      expect(loadThemePreference()).toBe(value);
    }
  });

  it("ignores unknown stored values", () => {
    localStorage.setItem(SCHEME_KEY, "solarized");
    expect(loadThemePreference()).toBe(THEME_PREFERENCE_DEFAULT);
  });

  it("resolves system against the OS appearance", () => {
    mockSystemScheme("light");
    expect(resolveColorScheme("system")).toBe("light");
    mockSystemScheme("dark");
    expect(resolveColorScheme("system")).toBe("dark");
  });

  it("keeps explicit picks regardless of the OS appearance", () => {
    mockSystemScheme("light");
    expect(resolveColorScheme("dark")).toBe("dark");
    mockSystemScheme("dark");
    expect(resolveColorScheme("light")).toBe("light");
  });

  it("falls back to dark without matchMedia", () => {
    expect(resolveColorScheme("system")).toBe("dark");
  });
});
