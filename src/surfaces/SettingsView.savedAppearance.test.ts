// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/*
 * One real saved profile, written the way earlier Aven versions stored it:
 * the Work workspace follows the system theme on a custom black background at
 * 35% opacity, blur 11, with the desktop shown behind sessions and sidebars
 * matched; the device keeps a 21% status bar and an 80% interface scale; the
 * sidebar colour is Graphite (no wash). Settings simplifications must leave
 * this look exactly as it was until the person changes a control.
 */
const WORK_THEME = {
  hue: 207,
  saturation: 0,
  preference: "system",
  opacity: 0.35,
  blur: 11,
  bodyGlass: true,
  matchPanels: true,
  colors: {
    dark: { background: "#000000", accent: "#57b5ff", highlight: "#57b5ff" },
    light: { background: "#ffffff", accent: "#0a0a0a", highlight: "#737373" },
  },
  sidebarTint: "none",
  sidebarTintStrength: 28,
};
const SAVED_PROFILE: Record<string, string> = {
  "monocode.personal.workspaceThemes.v1": JSON.stringify({
    version: 1,
    fallback: {
      hue: 207,
      saturation: 0,
      preference: "system",
      opacity: 0.52,
      blur: 16,
      bodyGlass: true,
      matchPanels: false,
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
    },
    themes: { work: WORK_THEME },
  }),
  "monocode.workspaceProfiles.v1": JSON.stringify({
    version: 1,
    activeProfileId: "work",
    profiles: [
      { id: "personal", name: "Personal", icon: "home" },
      { id: "work", name: "Work", icon: "briefcase" },
    ],
  }),
  "aven.statusBarOpacity": "0.21",
  "monocode.uiScale": "0.8",
};

/** What the profile computed to before Appearance settings were simplified. */
const DARK_LOOK = {
  classes: [
    "glass-body",
    "has-native-glass",
    "has-native-glass-tint",
    "is-mac",
    "match-workspace-panels",
  ],
  style: {
    "--aven-titlebar-scale": "1.25",
    "--chat-background-opacity": "0.24",
    "--sidebar-opacity": "0.35",
    "--status-bar-opacity": "0.21",
    // Saved with the former blue default, it follows the neutral default.
    "--theme-accent-color": "#e8e8ea",
    // Text on the accent: black reads on the near-white.
    "--theme-accent-foreground": "#000000",
    "--theme-background-color": "#000000",
    "--theme-content-color": "#ffffff",
    "--theme-highlight-color": "#a1a1a6",
    "--theme-hue": "207",
    "--theme-light-surface-color": "#000000",
    "--theme-saturation": "0%",
  },
  blur: 11,
  glass: {
    enabled: true,
    // The saved 0.35 above the glass floor: 0.2 + 0.8 × 0.35.
    tint: { r: 0, g: 0, b: 0, alpha: 0.48 },
  },
  windowColor: undefined,
  zoom: 0.8,
};
const LIGHT_LOOK = {
  ...DARK_LOOK,
  classes: [
    "glass-body",
    "has-native-glass",
    "is-mac",
    "match-workspace-panels",
    "theme-light",
  ],
  style: {
    ...DARK_LOOK.style,
    "--theme-accent-color": "#0a0a0a",
    "--theme-accent-foreground": "#ffffff",
    "--theme-background-color": "#ffffff",
    "--theme-content-color": "#000000",
    "--theme-highlight-color": "#737373",
    "--theme-light-surface-color": "color-mix(in srgb, #ffffff 32%, #ffffff)",
  },
  glass: { enabled: false },
  windowColor: "#ffffff",
};

vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  IS_MAC: true,
  HAS_NATIVE_GLASS: true,
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(),
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/window", () => {
  const nativeWindow = {
    setBackgroundColor: vi.fn().mockResolvedValue(undefined),
  };
  return { getCurrentWindow: () => nativeWindow };
});
vi.mock("@tauri-apps/api/webview", () => {
  const webview = { setZoom: vi.fn().mockResolvedValue(undefined) };
  return { getCurrentWebview: () => webview };
});
vi.mock("../lib/sounds", async (original) => ({
  ...(await original<typeof import("../lib/sounds")>()),
  playCue: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;
let storage: Map<string, string>;

function systemScheme(scheme: "dark" | "light") {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        media: query,
        matches:
          query === "(prefers-color-scheme: light)" && scheme === "light",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

/** Every inline custom property and zoom the appearance code painted. */
function paintedStyle() {
  const style = document.documentElement.style;
  const painted: Record<string, string> = {};
  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index);
    painted[name] = style.getPropertyValue(name).trim();
  }
  return painted;
}

function look() {
  const calls = vi.mocked(invoke).mock.calls;
  const last = (command: string) =>
    calls.filter(([name]) => name === command).at(-1)?.[1];
  const windowColors = vi.mocked(getCurrentWindow().setBackgroundColor).mock
    .calls;
  return {
    classes: [...document.documentElement.classList].sort(),
    style: Object.fromEntries(Object.entries(paintedStyle()).sort()),
    blur: (last("set_window_background_blur") as { radius: number })?.radius,
    glass: last("set_window_glass_enabled"),
    windowColor: windowColors.at(-1)?.[0],
    zoom: vi.mocked(getCurrentWebview().setZoom).mock.calls.at(-1)?.[0],
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.mocked(invoke).mockImplementation(async (command: string) =>
    command === "set_window_glass_enabled" ? true : undefined,
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage = new Map(Object.entries(SAVED_PROFILE));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  document.documentElement.className = "";
  document.documentElement.style.cssText = "";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.documentElement.className = "";
  document.documentElement.style.cssText = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a saved appearance profile", () => {
  it.each([
    ["dark", DARK_LOOK],
    ["light", LIGHT_LOOK],
  ] as const)(
    "looks the same in %s mode at startup and with Appearance settings open",
    async (scheme, expected) => {
      systemScheme(scheme);
      const appearance = await import("../lib/appearance");
      const { useActivateWorkspaceTheme } =
        await import("../lib/workspaceThemes");
      const { SettingsView } = await import("./SettingsView");
      let showSettings = false;
      function Workspace() {
        useActivateWorkspaceTheme("work");
        return showSettings
          ? createElement(SettingsView, {
              section: "appearance",
              workspaceName: "Work",
              cwd: "~",
              sessions: [],
              besideRail: true,
              onClose: () => {},
              onOpenSession: () => {},
              onArchiveSession: () => {},
              onDeleteSession: () => {},
              onOpenWhatsNew: () => {},
            })
          : null;
      }

      // The app's own startup order: paint, render the workspace, then let
      // the window take its native appearance once the frame is drawn.
      appearance.initAppearance();
      await act(async () => root.render(createElement(Workspace)));
      await act(async () => appearance.activateWindowAppearance());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(look()).toEqual(expected);
      const stored = Object.fromEntries(storage);

      // Opening Appearance settings must neither repaint nor rewrite anything.
      showSettings = true;
      await act(async () => root.render(createElement(Workspace)));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(look()).toEqual(expected);
      expect(Object.fromEntries(storage)).toEqual(stored);
    },
  );
});
