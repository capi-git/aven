// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AVEN_SOLID_DARK_BACKGROUND,
  AVEN_THEME_COLORS,
  BLACK_THEME_COLORS,
} from "./appearance";

const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
// The first inline script in <head> sets the theme before anything paints.
const themeScript = new DOMParser()
  .parseFromString(indexHtml, "text/html")
  .querySelector("head script")!.textContent!;

const root = document.documentElement;
let store: Map<string, string>;
let prefersLight = false;
let platform = "MacIntel";

function runThemeScript() {
  new Function(themeScript)();
}

function theme(
  preference: "dark" | "light" | "system",
  dark = "#000000",
  light = "#ffffff",
  opacity?: number,
) {
  return {
    hue: 207,
    saturation: 0,
    preference,
    ...(opacity === undefined ? {} : { opacity }),
    colors: {
      dark: { background: dark, accent: "#57b5ff" },
      light: { background: light, accent: "#0a0a0a" },
    },
  };
}

function save(themes: unknown, activeProfileId = "personal") {
  store.set("monocode.personal.workspaceThemes.v1", JSON.stringify(themes));
  store.set(
    "monocode.workspaceProfiles.v1",
    JSON.stringify({ profiles: [], activeProfileId }),
  );
}

beforeEach(() => {
  store = new Map();
  prefersLight = false;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("light") && prefersLight,
  }));
  // happy-dom reports the host's platform; pin it so every host agrees.
  platform = "MacIntel";
  vi.spyOn(navigator, "platform", "get").mockImplementation(() => platform);
  root.removeAttribute("style");
  root.className = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("startup theme", () => {
  it("paints the first frame in the active workspace's background", () => {
    save({
      version: 1,
      fallback: theme("dark", "#0a0a0a"),
      themes: {
        personal: theme("system", "#000000"),
        work: theme("dark", "#101820"),
      },
    });
    runThemeScript();
    expect(root.style.getPropertyValue("--boot-background")).toBe("#000000");
    expect(root.classList.contains("theme-light")).toBe(false);

    save(
      {
        version: 1,
        fallback: theme("dark"),
        themes: { work: theme("dark", "#101820") },
      },
      "work",
    );
    runThemeScript();
    expect(root.style.getPropertyValue("--boot-background")).toBe("#101820");
  });

  it("follows the system appearance and falls back when the profile has no theme", () => {
    prefersLight = true;
    save({
      version: 1,
      fallback: theme("system", "#000000", "#f4f4f4"),
      themes: {},
    });
    runThemeScript();
    expect(root.classList.contains("theme-light")).toBe(true);
    expect(root.style.getPropertyValue("--boot-background")).toBe("#f4f4f4");
  });

  it("ignores missing, corrupt or unsafe values", () => {
    runThemeScript();
    expect(root.style.getPropertyValue("--boot-background")).toBe("");
    store.set("monocode.personal.workspaceThemes.v1", "{not json");
    runThemeScript();
    expect(root.style.getPropertyValue("--boot-background")).toBe("");
    // The rest of startup styling still runs.
    store.set("monocode.bodyGlass", "1");
    runThemeScript();
    expect(root.classList.contains("glass-body")).toBe(true);
    save({ themes: { personal: theme("dark", "url(javascript:alert(1))") } });
    runThemeScript();
    expect(root.style.getPropertyValue("--boot-background")).toBe("");
  });

  it("keeps the floating sidebar layer see-through from its first frame", () => {
    const styles = new DOMParser()
      .parseFromString(indexHtml, "text/html")
      .querySelector("head style")!.textContent!;
    expect(styles).toMatch(
      /html\.aven-floating-sidebar-overlay #root \{\s*background: transparent !important;/,
    );
    const workspace = window.location.href;
    try {
      window.history.replaceState(null, "", "/index.html?floatingSidebar=1");
      runThemeScript();
      expect(root.classList.contains("aven-floating-sidebar-overlay")).toBe(
        true,
      );
      root.className = "";
      window.history.replaceState(null, "", "/index.html");
      runThemeScript();
      expect(root.classList.contains("aven-floating-sidebar-overlay")).toBe(
        false,
      );
    } finally {
      window.history.replaceState(null, "", workspace);
    }
  });
});

describe("Solid startup", () => {
  const boot = () => root.style.getPropertyValue("--boot-background");

  it("uses the colours appearance.ts paints next", () => {
    for (const color of [
      AVEN_SOLID_DARK_BACKGROUND,
      AVEN_THEME_COLORS.dark.background,
      BLACK_THEME_COLORS.dark.accent,
      BLACK_THEME_COLORS.dark.highlight,
    ])
      expect(themeScript).toContain(`"${color}"`);
  });

  it("starts a Solid window with Aven's black in grey, and glass in black", () => {
    save({
      version: 1,
      fallback: theme("dark", "#000000", "#ffffff", 1),
      themes: {},
    });
    runThemeScript();
    expect(boot()).toBe("#0a0a0a");
    save({
      version: 1,
      fallback: theme("dark", "#000000", "#ffffff", 0.52),
      themes: {},
    });
    runThemeScript();
    expect(boot()).toBe("#000000");
  });

  it("keeps custom backgrounds, the Black palette and light mode as saved", () => {
    save({
      version: 1,
      fallback: theme("dark", "#101820", "#ffffff", 1),
      themes: {},
    });
    runThemeScript();
    expect(boot()).toBe("#101820");
    save({
      version: 1,
      fallback: {
        preference: "dark",
        opacity: 1,
        colors: {
          dark: {
            background: "#000000",
            accent: "#c4c4c8",
            highlight: "#85858f",
          },
        },
      },
      themes: {},
    });
    runThemeScript();
    expect(boot()).toBe("#000000");
    save({
      version: 1,
      fallback: theme("light", "#000000", "#f4f4f4", 1),
      themes: {},
    });
    runThemeScript();
    expect(root.classList.contains("theme-light")).toBe(true);
    expect(boot()).toBe("#f4f4f4");
  });

  it("starts grey where the platform has no glass, whatever the saved opacity", () => {
    platform = "Win32";
    save({
      version: 1,
      fallback: theme("dark", "#000000", "#ffffff", 0.52),
      themes: {},
    });
    runThemeScript();
    expect(boot()).toBe("#0a0a0a");
    // A first launch has no saved theme yet; light mode keeps its own white.
    store.clear();
    root.removeAttribute("style");
    runThemeScript();
    expect(boot()).toBe("#0a0a0a");
    root.removeAttribute("style");
    store.set("monocode.colorScheme", "light");
    runThemeScript();
    expect(boot()).toBe("");
  });
});
