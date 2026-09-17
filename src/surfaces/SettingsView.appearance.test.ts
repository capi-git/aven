// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./SettingsView";
import {
  loadWorkspaceTheme,
  saveWorkspaceTheme,
  useActivateWorkspaceTheme,
  WORKSPACE_THEME_PRESETS,
  defaultWorkspaceTheme,
} from "../lib/workspaceThemes";

vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  IS_MAC: true,
  HAS_NATIVE_GLASS: true,
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: vi.fn().mockResolvedValue(undefined) }),
}));

function Harness() {
  useActivateWorkspaceTheme("work");
  return createElement(SettingsView, {
    section: "appearance",
    cwd: "~",
    sessions: [],
    besideRail: true,
    onClose: () => {},
    onOpenSession: () => {},
    onArchiveSession: () => {},
    onDeleteSession: () => {},
    onOpenWhatsNew: () => {},
  });
}

describe("workspace appearance settings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    document.documentElement.classList.remove("theme-light", "match-workspace-panels");
    saveWorkspaceTheme("work", {
      preference: "dark",
      opacity: 0.45,
      blur: 12,
      bodyGlass: false,
      colors: {
        dark: {
          background: "#112233",
          accent: "#446688",
          highlight: "#8899aa",
        },
        light: {
          background: "#eeeeff",
          accent: "#112244",
          highlight: "#557799",
        },
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.documentElement.classList.remove("theme-light", "match-workspace-panels");
    vi.unstubAllGlobals();
  });

  async function clickText(text: string, selector = "button") {
    const button = Array.from(
      container.querySelectorAll<HTMLButtonElement>(selector),
    ).find((element) => element.textContent === text)!;
    expect(button).not.toBeUndefined();
    await act(async () => button.click());
  }

  async function input(label: string, value: string, event = "input") {
    const element = container.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(element, value);
      element.dispatchEvent(new Event(event, { bubbles: true }));
    });
    return element;
  }

  it("toggles sidebar matching while preserving workspace colors and glass settings", async () => {
    await act(async () => root.render(createElement(Harness)));
    const original = loadWorkspaceTheme("work");
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Match sidebars to workspace"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle.click());
    expect(loadWorkspaceTheme("work")).toEqual({ ...original, matchPanels: true });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click());
    expect(loadWorkspaceTheme("work")).toEqual(original);
  });

  it("offers 19 real palettes and makes Black dark and opaque without changing saved light colors", async () => {
    saveWorkspaceTheme("work", { preference: "light" });
    const light = loadWorkspaceTheme("work").colors!.light;
    await act(async () => root.render(createElement(Harness)));
    expect(
      container.querySelectorAll('[aria-label="Workspace palette"] button'),
    ).toHaveLength(19);
    await clickText("Black");
    expect(loadWorkspaceTheme("work")).toMatchObject({
      preference: "dark",
      opacity: 1,
      blur: 0,
      bodyGlass: true,
      colors: { dark: { background: "#000000" }, light },
    });
    expect(container.textContent).toContain(
      "Lower background opacity to see desktop blur",
    );
  });

  it("edits native and hex colors in the selected mode while retaining the other palette and glass", async () => {
    await act(async () => root.render(createElement(Harness)));
    await input("Accent color", "#abcdef", "change");
    const hex = await input("Background hex", "#123abc");
    await act(async () =>
      hex.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(loadWorkspaceTheme("work").colors!.dark).toMatchObject({
      background: "#123abc",
      accent: "#abcdef",
    });
    await clickText("Light", '[role="radio"]');
    expect(container.textContent).toContain("Light colors");
    await input("Highlight color", "#aabbcc", "change");
    expect(loadWorkspaceTheme("work").colors!.light!.highlight).toBe("#aabbcc");
    expect(loadWorkspaceTheme("work").colors!.dark!.background).toBe("#123abc");
    await clickText("Ocean");
    expect(loadWorkspaceTheme("work")).toMatchObject({
      opacity: 0.45,
      blur: 12,
      bodyGlass: false,
      colors: {
        light: WORKSPACE_THEME_PRESETS.find(
          (preset) => preset.name === "Ocean",
        )!.colors.light,
      },
    });
  });

  it("clears current-mode custom colors when tint changes and restores Cove on Restore defaults", async () => {
    await act(async () => root.render(createElement(Harness)));
    await input("Hue", "160");
    expect(loadWorkspaceTheme("work").colors?.dark).toBeUndefined();
    expect(loadWorkspaceTheme("work").colors?.light?.background).toBe(
      "#eeeeff",
    );
    await clickText("Restore defaults");
    expect(loadWorkspaceTheme("work")).toEqual(defaultWorkspaceTheme());
  });
});
