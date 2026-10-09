// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "./SettingsView";
import {
  loadStatusBarOpacity,
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
    const toggle = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Match sidebars to workspace"]',
    )!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle.click());
    expect(loadWorkspaceTheme("work")).toEqual({
      ...original,
      matchPanels: true,
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click());
    expect(loadWorkspaceTheme("work")).toEqual(original);
  });

  it("replaces preset palettes with a picker that edits the chosen color", async () => {
    await act(async () => root.render(createElement(Harness)));
    expect(
      container.querySelector('[aria-label="Workspace palette"]'),
    ).toBeNull();
    expect(container.querySelector('[aria-label="Hue"]')).toBeNull();
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Background hex"]',
      )?.value,
    ).toBe("#112233");
    await clickText("Accent", '[role="radio"]');
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Accent hex"]',
      )?.value,
    ).toBe("#446688");
  });

  it("edits hex colors in the selected mode while retaining the other mode and glass", async () => {
    await act(async () => root.render(createElement(Harness)));
    await clickText("Accent", '[role="radio"]');
    const accent = await input("Accent hex", "#abcdef");
    await act(async () =>
      accent.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
    );
    await clickText("Background", '[role="radio"]');
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
    await clickText("Highlight", '[role="radio"]');
    const highlight = await input("Highlight hex", "#aabbcc");
    await act(async () =>
      highlight.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(loadWorkspaceTheme("work")).toMatchObject({
      opacity: 0.45,
      blur: 12,
      bodyGlass: false,
      colors: {
        dark: { background: "#123abc", accent: "#abcdef" },
        light: { highlight: "#aabbcc" },
      },
    });
  });

  it("adjusts the color from the keyboard and restores defaults", async () => {
    await act(async () => root.render(createElement(Harness)));
    const field = container.querySelector<HTMLElement>(
      '[role="slider"][aria-label="Background richness and brightness"]',
    )!;
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          shiftKey: true,
          bubbles: true,
        }),
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const brighter = loadWorkspaceTheme("work").colors!.dark!.background!;
    expect(brighter).not.toBe("#112233");
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Background hex"]',
      )?.value,
    ).toBe(brighter);
    await clickText("Restore defaults");
    expect(loadWorkspaceTheme("work")).toEqual(defaultWorkspaceTheme());
  });

  it("sets interface scale from a menu instead of a live slider", async () => {
    await act(async () => root.render(createElement(Harness)));
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
  it("saves the status bar tint separately from workspace glass and restores its default", async () => {
    await act(async () => root.render(createElement(Harness)));
    const original = loadWorkspaceTheme("work");
    await input("Status bar opacity", "25");
    expect(loadStatusBarOpacity()).toBe(0.25);
    expect(
      document.documentElement.style.getPropertyValue("--status-bar-opacity"),
    ).toBe("0.25");
    expect(loadWorkspaceTheme("work")).toEqual(original);
    await clickText("Restore defaults");
    expect(loadStatusBarOpacity()).toBe(STATUS_BAR_OPACITY_DEFAULT);
  });

  it("puts everyday display controls before window details and chat decoration", async () => {
    await act(async () => root.render(createElement(Harness)));
    const text = container.textContent!;
    expect(text.indexOf("Interface scale")).toBeLessThan(
      text.indexOf("Blur radius"),
    );
    expect(text.indexOf("Background opacity")).toBeLessThan(
      text.indexOf("Sidebar colour"),
    );
    expect(text.indexOf("Interface scale")).toBeLessThan(
      text.indexOf("Chat background"),
    );
  });
});
