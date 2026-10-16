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

const SIX_CONTROLS = [
  "Theme",
  "Accent colour",
  "Interface scale",
  "Glass",
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
      'input[type="range"][aria-label="Glass"]',
    )!;
  const checkedAccent = () =>
    container
      .querySelector(
        '[role="radiogroup"][aria-label="Accent colour"] [aria-checked="true"]',
      )
      ?.getAttribute("aria-label");

  it("shows exactly six controls without scope chips, the header pill or the dark/light note", async () => {
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
    ).toEqual(SIX_CONTROLS);
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
    expect(container.textContent).toContain(
      "Set the mood for your Work workspace.",
    );
  });

  it("opens with Glass read from the saved opacity, rewriting nothing", async () => {
    const before = Object.fromEntries(storage);
    await mount();
    expect(glass().value).toBe("55");
    expect(glass().getAttribute("aria-valuetext")).toBe("55%");
    expect(Object.fromEntries(storage)).toEqual(before);
    expect(loadWorkspaceTheme("work")).toMatchObject({
      opacity: 0.45,
      blur: 12,
      bodyGlass: false,
    });
    expect(loadStatusBarOpacity()).toBe(0.3);
  });

  it("moves opacity, blur, the desktop behind sessions and the status bar together", async () => {
    await mount();
    await input("Glass", "0");
    expect(glass().getAttribute("aria-valuetext")).toBe("Solid");
    expect(loadWorkspaceTheme("work")).toMatchObject({
      opacity: 1,
      blur: 0,
      bodyGlass: false,
    });
    expect(loadStatusBarOpacity()).toBe(1);
    expect(
      document.documentElement.style.getPropertyValue("--status-bar-opacity"),
    ).toBe("1");

    await input("Glass", "48");
    expect(loadWorkspaceTheme("work")).toMatchObject({
      opacity: 0.52,
      blur: 16,
      bodyGlass: true,
    });
    expect(loadStatusBarOpacity()).toBe(STATUS_BAR_OPACITY_DEFAULT);

    await input("Glass", "95");
    expect(loadWorkspaceTheme("work")).toMatchObject({
      opacity: 0.05,
      blur: 32,
      bodyGlass: true,
    });
    expect(loadStatusBarOpacity()).toBe(0.06);
    // The glass slider leaves colours alone.
    expect(loadWorkspaceTheme("work").colors?.dark?.accent).toBe("#446688");
  });

  it("disables Glass in light mode with a one-line note and keeps the dark value", async () => {
    saveWorkspaceTheme("work", { preference: "light" });
    await mount();
    expect(glass().disabled).toBe(true);
    expect(container.querySelector("#setting-glass")?.textContent).toContain(
      "Light mode always uses a solid window. Glass applies in dark mode.",
    );
    expect(loadWorkspaceTheme("work").opacity).toBe(0.45);
  });

  it("picks an accent from preset swatches for both modes, keeping backgrounds and glass", async () => {
    await mount();
    const swatches = Array.from(
      container.querySelectorAll(
        '[role="radiogroup"][aria-label="Accent colour"] [role="radio"]',
      ),
    ).map((swatch) => swatch.getAttribute("aria-label"));
    expect(swatches[0]).toBe("Aven blue");
    expect(swatches).toContain("Forest");
    // #446688 is no preset, so the custom choice is the selected one.
    expect(checkedAccent()).toBeUndefined();
    expect(buttonWithText("Custom…")?.hasAttribute("data-checked")).toBe(true);

    await click(container.querySelector('[role="radio"][aria-label="Forest"]'));
    expect(checkedAccent()).toBe("Forest");
    expect(buttonWithText("Custom…")?.hasAttribute("data-checked")).toBe(false);
    expect(loadWorkspaceTheme("work")).toMatchObject({
      opacity: 0.45,
      blur: 12,
      bodyGlass: false,
      colors: {
        dark: {
          background: "#112233",
          accent: "#a2c7aa",
          highlight: "#63896b",
        },
        light: {
          background: "#eeeeff",
          accent: "#486e4e",
          highlight: "#86a789",
        },
      },
    });
    expect(
      document.documentElement.style.getPropertyValue("--theme-accent-color"),
    ).toBe("#a2c7aa");

    await click(
      container.querySelector('[role="radio"][aria-label="Aven blue"]'),
    );
    expect(loadWorkspaceTheme("work").colors?.dark).toEqual({
      background: "#112233",
      accent: "#57b5ff",
      highlight: "#57b5ff",
    });
  });

  it("opens an accent-only picker from Custom… and uses one colour in both modes", async () => {
    await mount();
    const custom = buttonWithText("Custom…")!;
    expect(custom.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".settings-color-picker")).toBeNull();
    await click(custom);
    expect(custom.getAttribute("aria-expanded")).toBe("true");
    const picker = container.querySelector(".settings-color-picker")!;
    expect(picker).not.toBeNull();
    // Accent only: no background or highlight to choose between.
    expect(picker.querySelector('[role="radiogroup"]')).toBeNull();
    expect(
      picker.querySelector<HTMLInputElement>('input[aria-label="Accent hex"]')
        ?.value,
    ).toBe("#446688");
    const hex = await input("Accent hex", "#abcdef");
    await act(async () =>
      hex.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(loadWorkspaceTheme("work").colors).toEqual({
      dark: { background: "#112233", accent: "#abcdef" },
      light: { background: "#eeeeff", accent: "#abcdef" },
    });
    expect(checkedAccent()).toBeUndefined();
    expect(custom.hasAttribute("data-checked")).toBe(true);
    await click(custom);
    expect(container.querySelector(".settings-color-picker")).toBeNull();
  });

  it("sets interface scale from a menu instead of a live slider", async () => {
    await mount();
    expect(
      container.querySelector(
        'input[type="range"][aria-label="Interface scale"]',
      ),
    ).toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="listbox"][aria-label="Interface scale"]',
    )!;
    expect(trigger.textContent).toContain("100%");
    await act(async () => trigger.click());
    const options = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    expect(options.map((option) => option.textContent)).toEqual(
      expect.arrayContaining(["50%", "100%", "150%", "200%"]),
    );
    const option = options.find((node) => node.textContent === "150%")!;
    await act(async () => option.click());
    expect(localStorage.getItem("monocode.uiScale")).toBe("1.5");
    expect(trigger.textContent).toContain("150%");
    document.documentElement.style.removeProperty("zoom");
  });

  it("keeps one visibility control for a chat background and a saved 'empty only' choice", async () => {
    saveChatBackgroundPath("/pictures/dunes.jpg");
    saveChatBackgroundScope("empty");
    await mount();
    const card = container.querySelector("#setting-chat-background")!;
    expect(
      card.querySelector(
        'input[type="range"][aria-label="Background visibility"]',
      ),
    ).not.toBeNull();
    expect(card.querySelectorAll('input[type="range"]')).toHaveLength(1);
    expect(card.querySelector('[aria-label="Show background on"]')).toBeNull();
    expect(loadChatBackgroundScope()).toBe("empty");
  });

  it("copies this workspace's look to every workspace", async () => {
    await mount();
    await click(buttonWithText("Copy to all"));
    expect(loadWorkspaceTheme("personal")).toEqual(loadWorkspaceTheme("work"));
    expect(container.textContent).toContain(
      "Appearance applied to all workspaces.",
    );
  });

  it("restores the default theme, glass and device display settings", async () => {
    saveChatBackgroundScope("empty");
    await mount();
    await input("Glass", "10");
    await click(buttonWithText("Restore defaults"));
    expect(loadWorkspaceTheme("work")).toEqual(defaultWorkspaceTheme());
    expect(loadStatusBarOpacity()).toBe(STATUS_BAR_OPACITY_DEFAULT);
    expect(loadChatBackgroundScope()).toBe("all");
    expect(glass().value).toBe("48");
    expect(checkedAccent()).toBe("Aven blue");
  });
});
