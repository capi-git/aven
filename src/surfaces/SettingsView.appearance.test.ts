// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./SettingsView";
import {
  loadChatBackgroundScope,
  loadStatusBarOpacity,
  saveChatBackgroundPath,
  saveChatBackgroundScope,
  saveStatusBarOpacity,
  STATUS_BAR_OPACITY_DEFAULT,
} from "../lib/appearance";
import {
  loadWorkspaceTheme,
  saveWorkspaceTheme,
  useActivateWorkspaceTheme,
  defaultWorkspaceTheme,
} from "../lib/workspaceThemes";
import { initMotionPreference, playMotion } from "../lib/motion";

vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  IS_MAC: true,
  HAS_NATIVE_GLASS: true,
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("../lib/sounds", async (original) => ({
  ...(await original<typeof import("../lib/sounds")>()),
  playCue: vi.fn(),
}));

const APPEARANCE_CONTROLS = [
  "Theme",
  "Accent colour",
  "Interface scale",
  "Opacity",
  "Translucency",
  "Frame",
  "Reduce motion",
  "Dot pointer",
  "Chat background",
  "Use for all workspaces",
];

function Harness() {
  useActivateWorkspaceTheme("work");
  return createElement(SettingsView, {
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
  });
}

describe("workspace appearance settings", () => {
  let container: HTMLDivElement;
  let root: Root;
  let storage: Map<string, string>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          media: query,
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    document.documentElement.classList.remove(
      "theme-light",
      "match-workspace-panels",
    );
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
    saveStatusBarOpacity(0.3);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.documentElement.classList.remove(
      "theme-light",
      "match-workspace-panels",
    );
    document.documentElement.style.cssText = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount() {
    await act(async () => root.render(createElement(Harness)));
  }

  async function click(element: Element | null | undefined) {
    expect(element).toBeTruthy();
    await act(async () => (element as HTMLElement).click());
  }

  function buttonWithText(text: string) {
    return Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === text,
    );
  }

  async function input(label: string, value: string) {
    const element = container.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    )!;
    expect(element).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return element;
  }

  const glass = () =>
    container.querySelector<HTMLInputElement>(
      'input[type="range"][aria-label="Opacity"]',
    )!;
  const frost = () =>
    container.querySelector<HTMLInputElement>(
      'input[type="range"][aria-label="Translucency"]',
    )!;
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 220));
    });
  const checkedAccent = () =>
    container
      .querySelector(
        '[role="radiogroup"][aria-label="Accent colour"] [aria-checked="true"]',
      )
      ?.getAttribute("aria-label");

  it("shows exactly its eight controls without scope chips, the header pill or the dark/light note", async () => {
    await mount();
    const controls = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".settings-row[id], .settings-background-card[id]",
      ),
    );
    expect(
      controls.map(
        (control) =>
          control.querySelector(".settings-row-label")?.textContent ??
          control.querySelector(".text-ui-body")?.textContent,
      ),
    ).toEqual(APPEARANCE_CONTROLS);
    for (const control of controls)
      expect(
        control.querySelector(".settings-row-description, p")?.textContent,
      ).toBeTruthy();
    expect(container.querySelector(".settings-group-scope")).toBeNull();
    expect(container.querySelector(".settings-scope-line")).toBeNull();
    const text = container.textContent!.toLowerCase();
    for (const removed of [
      "saved separately",
      "Workspace colors",
      "Background opacity",
      "Blur radius",
      "Include workspace",
      "Status bar opacity",
      "Match sidebars",
      "Sidebar colour",
      "Highlight",
      "Same appearance across workspaces",
      "device display preferences",
    ])
      expect(text).not.toContain(removed.toLowerCase());
  });

  it("opens with Opacity and Translucency read from the saved look, rewriting nothing", async () => {
    const before = Object.fromEntries(storage);
    await mount();
    expect(glass().value).toBe("45");
    expect(glass().getAttribute("aria-valuetext")).toBe("45%");
    expect(frost().value).toBe("81");
    expect(frost().disabled).toBe(false);
    expect(Object.fromEntries(storage)).toEqual(before);
    expect(loadWorkspaceTheme("work")).toMatchObject({
      opacity: 0.45,
      blur: 12,
      bodyGlass: false,
    });
    expect(loadStatusBarOpacity()).toBe(0.3);
  });

  it("sets opacity and blur separately, each keeping the other", async () => {
    await mount();
    await input("Translucency", "50");
    await settle();
    expect(loadWorkspaceTheme("work")).toMatchObject({
      opacity: 0.45,
      blur: 32,
    });

    await input("Opacity", "100");
    await settle();
    expect(glass().getAttribute("aria-valuetext")).toBe("Solid");
    expect(frost().disabled).toBe(true);
    expect(loadWorkspaceTheme("work")).toMatchObject({
      opacity: 1,
      blur: 32,
      bodyGlass: false,
    });
    expect(loadStatusBarOpacity()).toBe(1);
    expect(
      document.documentElement.style.getPropertyValue("--status-bar-opacity"),
    ).toBe("1");

    await input("Opacity", "52");
    await settle();
    expect(loadWorkspaceTheme("work")).toMatchObject({
      opacity: 0.52,
      blur: 32,
      bodyGlass: true,
    });
    expect(loadStatusBarOpacity()).toBe(STATUS_BAR_OPACITY_DEFAULT);

    // A quick move of one slider then the other saves both.
    await input("Opacity", "5");
    await input("Translucency", "100");
    await settle();
    expect(loadWorkspaceTheme("work")).toMatchObject({
      opacity: 0.05,
      blur: 0,
      bodyGlass: true,
    });
    expect(frost().getAttribute("aria-valuetext")).toBe("Clear");
    expect(loadStatusBarOpacity()).toBe(0.06);
    // The glass sliders leave colours alone.
    expect(loadWorkspaceTheme("work").colors?.dark?.accent).toBe("#446688");
  });

  it("restores the default theme, glass and device display settings", async () => {
    saveChatBackgroundScope("empty");
    await mount();
    await input("Opacity", "90");
    await click(buttonWithText("Restore defaults"));
    expect(loadWorkspaceTheme("work")).toEqual(defaultWorkspaceTheme());
    expect(loadStatusBarOpacity()).toBe(STATUS_BAR_OPACITY_DEFAULT);
    expect(loadChatBackgroundScope()).toBe("all");
    expect(glass().value).toBe("52");
    expect(frost().value).toBe("75");
    expect(checkedAccent()).toBe("Neutral");
  });

  it("turns every animation off with Reduce motion, and keeps it through Restore defaults", async () => {
    const stop = initMotionPreference();
    await mount();
    const reduce = container.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Reduce motion"]',
    )!;
    expect(reduce.getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.getAttribute("data-motion")).toBe("full");

    await click(reduce);
    expect(reduce.getAttribute("aria-checked")).toBe("true");
    expect(storage.get("aven.reduceMotion")).toBe("1");
    expect(document.documentElement.getAttribute("data-motion")).toBe("reduce");
    expect(playMotion(document.createElement("div"), "fade")).toBe(false);

    await click(buttonWithText("Restore defaults"));
    expect(reduce.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.getAttribute("data-motion")).toBe("reduce");

    await click(reduce);
    expect(document.documentElement.getAttribute("data-motion")).toBe("full");
    stop();
    document.documentElement.removeAttribute("data-motion");
  });
});
