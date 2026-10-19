// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const platform = vi.hoisted(() => ({ HAS_NATIVE_GLASS: true, IS_MAC: true }));
vi.mock("./platform", () => platform);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => path),
}));
vi.mock("@tauri-apps/api/window", () => {
  const nativeWindow = {
    setBackgroundColor: vi.fn().mockResolvedValue(undefined),
  };
  return { getCurrentWindow: vi.fn(() => nativeWindow) };
});

let appearance: typeof import("./appearance");
let storage: Map<string, string>;
const root = document.documentElement;
const GREY = "#0a0a0a";
const background = () =>
  root.style.getPropertyValue("--theme-background-color");
const windowColors = () =>
  vi.mocked(getCurrentWindow().setBackgroundColor).mock.calls.map(([c]) => c);
const glassCalls = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([name]) => name === "set_window_glass_enabled")
    .map(([, args]) => args);
/** Let queued tint refreshes and IPC acknowledgements settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function reload() {
  vi.resetModules();
  appearance = await import("./appearance");
}

/** Dark mode with Aven's default palette at a window opacity. */
function avenDark(opacity: number) {
  appearance.applyThemePreference("dark");
  appearance.applyThemeColors(appearance.AVEN_THEME_COLORS);
  appearance.applySidebarOpacity(opacity);
}

describe("Solid window colour", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(async (name) =>
      name === "set_window_glass_enabled" ? true : undefined,
    );
    platform.HAS_NATIVE_GLASS = true;
    platform.IS_MAC = true;
    storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
    });
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    root.className = "";
    root.style.cssText = "";
    await reload();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("paints Aven's default black as neutral grey on the page and the native window", async () => {
    avenDark(1);
    expect(background()).toBe(GREY);
    expect(root.style.getPropertyValue("--theme-content-color")).toBe(
      "#ffffff",
    );
    expect(root.style.getPropertyValue("--theme-accent-color")).toBe("#57b5ff");
    await appearance.activateWindowAppearance();
    expect(windowColors()).toEqual([GREY]);
    // Solid has no glass, so no tint goes to the window.
    expect(glassCalls()).toEqual([{ enabled: false }]);
  });

  it.each([0.95, 0.52, 0.05])(
    "keeps black glass exactly at %s opacity",
    async (opacity) => {
      avenDark(opacity);
      expect(background()).toBe("#000000");
      await appearance.activateWindowAppearance();
      expect(glassCalls()).toEqual([
        { enabled: true, tint: { r: 0, g: 0, b: 0, alpha: opacity } },
      ]);
      expect(windowColors()).toEqual([]);
    },
  );

  it("keeps a custom background and the Black palette as saved at Solid", async () => {
    appearance.applyThemePreference("dark");
    appearance.applyThemeColors({ dark: { background: "#123456" } });
    appearance.applySidebarOpacity(1);
    expect(background()).toBe("#123456");
    await appearance.activateWindowAppearance();
    expect(windowColors()).toEqual(["#123456"]);

    appearance.applyThemeColors(appearance.BLACK_THEME_COLORS);
    expect(background()).toBe("#000000");
    await settle();
    expect(windowColors()).toEqual(["#123456", "#000000"]);
  });

  it("leaves light mode unchanged at Solid", async () => {
    appearance.applyThemePreference("light");
    appearance.applyThemeColors(appearance.AVEN_THEME_COLORS);
    appearance.applySidebarOpacity(1);
    expect(background()).toBe("#ffffff");
    expect(root.style.getPropertyValue("--theme-content-color")).toBe(
      "#000000",
    );
    await appearance.activateWindowAppearance();
    expect(windowColors()).toEqual(["#ffffff"]);
    // Dark mode in the same Solid window is grey.
    appearance.applyThemePreference("dark");
    expect(background()).toBe(GREY);
    await settle();
    expect(windowColors()).toEqual(["#ffffff", GREY]);
  });

  it("switches live both ways as the slider crosses Solid, without saving anything", async () => {
    avenDark(0.52);
    await appearance.activateWindowAppearance();
    vi.mocked(invoke).mockClear();

    appearance.applySidebarOpacity(1);
    // The page turns grey in the same pass, before the window answers.
    expect(background()).toBe(GREY);
    expect(root.classList.contains("has-native-glass-tint")).toBe(false);
    await settle();
    expect(glassCalls()).toEqual([{ enabled: false }]);
    expect(windowColors()).toEqual([GREY]);

    appearance.applySidebarOpacity(0.6);
    expect(background()).toBe("#000000");
    await settle();
    expect(glassCalls()).toEqual([
      { enabled: false },
      { enabled: true, tint: { r: 0, g: 0, b: 0, alpha: 0.6 } },
    ]);

    appearance.applySidebarOpacity(1);
    expect(background()).toBe(GREY);
    await settle();
    expect(windowColors()).toEqual([GREY, GREY]);
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("repaints once when a workspace switch crosses Solid", async () => {
    // A glass workspace with its own colour...
    appearance.applyThemePreference("dark");
    appearance.applyThemeColors({ dark: { background: "#204060" } });
    appearance.applySidebarOpacity(0.5);
    await appearance.activateWindowAppearance();
    vi.mocked(invoke).mockClear();
    // ...to a Solid one on Aven's palette, applied as the workspace hook does.
    appearance.applyThemeColors(appearance.AVEN_THEME_COLORS);
    appearance.applySidebarOpacity(1);
    expect(background()).toBe(GREY);
    await settle();
    expect(glassCalls()).toEqual([{ enabled: false }]);
    expect(windowColors()).toEqual([GREY]);
  });

  it("starts a saved Solid workspace grey, with no black frame first", async () => {
    storage.set(
      "monocode.personal.workspaceThemes.v1",
      JSON.stringify({
        version: 1,
        fallback: {
          hue: 207,
          saturation: 0,
          preference: "dark",
          opacity: 1,
          blur: 0,
          bodyGlass: false,
          matchPanels: false,
          colors: {
            dark: { ...appearance.AVEN_THEME_COLORS.dark },
            light: { ...appearance.AVEN_THEME_COLORS.light },
          },
        },
        themes: {},
      }),
    );
    const saved = storage.get("monocode.personal.workspaceThemes.v1");
    const { useActivateWorkspaceTheme } = await import("./workspaceThemes");
    appearance.initAppearance();
    // The page stays opaque in its theme colour until the window answers.
    expect(root.classList.contains("native-glass-pending")).toBe(true);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    const reactRoot = createRoot(container);
    function Workspace() {
      useActivateWorkspaceTheme("personal");
      return null;
    }
    act(() => reactRoot.render(createElement(Workspace)));
    // The workspace's first commit is grey before the window is shown.
    expect(background()).toBe(GREY);
    expect(windowColors()).toEqual([]);
    await appearance.activateWindowAppearance();
    expect(windowColors()).toEqual([GREY]);
    expect(glassCalls()).toEqual([{ enabled: false }]);
    expect(root.classList.contains("native-glass-pending")).toBe(false);
    expect(storage.get("monocode.personal.workspaceThemes.v1")).toBe(saved);
    act(() => reactRoot.unmount());
  });

  it("paints grey on a platform without glass, whatever the saved opacity", async () => {
    platform.HAS_NATIVE_GLASS = false;
    platform.IS_MAC = false;
    await reload();
    avenDark(0.52);
    expect(background()).toBe(GREY);
    await appearance.activateWindowAppearance();
    expect(windowColors()).toEqual([GREY]);
    expect(glassCalls()).toEqual([{ enabled: false }]);
  });
});
