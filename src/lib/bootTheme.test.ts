// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
// The first inline script in <head> sets the theme before anything paints.
const themeScript = new DOMParser()
  .parseFromString(indexHtml, "text/html")
  .querySelector("head script")!.textContent!;

const root = document.documentElement;
let store: Map<string, string>;
let prefersLight = false;

function runThemeScript() {
  new Function(themeScript)();
}

function theme(
  preference: "dark" | "light" | "system",
  dark = "#000000",
  light = "#ffffff",
) {
  return {
    hue: 207,
    saturation: 0,
    preference,
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
  root.removeAttribute("style");
  root.className = "";
});

afterEach(() => vi.unstubAllGlobals());

describe("startup theme", () => {
  it("paints the first frame in the active workspace's background", () => {
    save({
      version: 1,
      fallback: theme("dark", "#0a0a0a"),
      themes: { personal: theme("system", "#000000"), work: theme("dark", "#101820") },
    });
    runThemeScript();
    expect(root.style.getPropertyValue("--boot-background")).toBe("#000000");
    expect(root.classList.contains("theme-light")).toBe(false);

    save(
      { version: 1, fallback: theme("dark"), themes: { work: theme("dark", "#101820") } },
      "work",
    );
    runThemeScript();
    expect(root.style.getPropertyValue("--boot-background")).toBe("#101820");
  });

  it("follows the system appearance and falls back when the profile has no theme", () => {
    prefersLight = true;
    save({ version: 1, fallback: theme("system", "#000000", "#f4f4f4"), themes: {} });
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
});
