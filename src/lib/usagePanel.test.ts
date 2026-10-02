// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyThemeColors } from "./appearance";
import { usagePanelTheme, useUsagePanelTheme } from "./usagePanel";

let shell: HTMLDivElement;
let host: HTMLDivElement;
let root: Root;
const themes: ReturnType<typeof usagePanelTheme>[] = [];

function Probe({ open }: { open: boolean }) {
  themes.push(useUsagePanelTheme(open));
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  themes.length = 0;
  shell = document.createElement("div");
  shell.className = "personal-shell";
  shell.style.setProperty("--personal-main-surface", "#575757");
  shell.style.setProperty("--personal-accent", "#aaaab8");
  shell.style.setProperty("--color-content", "#ffffff");
  host = document.createElement("div");
  shell.append(host);
  document.body.append(shell);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  shell.remove();
  document.documentElement.classList.remove(
    "theme-light",
    "has-native-glass",
    "glass-body",
  );
  document.documentElement.style.removeProperty("--sidebar-opacity");
  vi.unstubAllGlobals();
});

/** The root state `initAppearance` and the active workspace theme leave behind. */
function glassWorkspace(opacity = "0.52") {
  const root = document.documentElement;
  root.classList.add("has-native-glass", "glass-body");
  root.style.setProperty("--sidebar-opacity", opacity);
}

function stubMedia(matching: string[]) {
  const listeners = new Map<string, Set<() => void>>();
  const matches = new Set(matching);
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return matches.has(query);
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => {
      if (!listeners.has(query)) listeners.set(query, new Set());
      listeners.get(query)!.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) =>
      listeners.get(query)?.delete(listener),
  }));
  return (query: string, value: boolean) => {
    if (value) matches.add(query);
    else matches.delete(query);
    for (const listener of listeners.get(query) ?? []) listener();
  };
}

async function mutate(action: () => void) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("usage panel workspace palette", () => {
  it("uses the same raised popup surface for all toolbar panels", () => {
    shell.style.setProperty("--aven-popup", "#24312e");
    expect(usagePanelTheme().background).toBe("#24312e");
  });
  it("captures the main surface and readable foreground, not just the accent", () => {
    expect(usagePanelTheme()).toEqual({
      mode: "dark",
      background: "#575757",
      accent: "#aaaab8",
      text: "#ffffff",
      glass: false,
    });
  });

  it("updates an open panel when the workspace palette or scheme changes", async () => {
    await act(async () => root.render(createElement(Probe, { open: true })));
    await mutate(() => {
      shell.style.setProperty("--personal-main-surface", "#faf4e6");
      shell.style.setProperty("--personal-accent", "#8f6b25");
      shell.style.setProperty("--color-content", "#000000");
      document.documentElement.classList.add("theme-light");
    });
    expect(themes.at(-1)).toEqual({
      mode: "light",
      background: "#faf4e6",
      accent: "#8f6b25",
      text: "#000000",
      glass: false,
    });
    const palette = themes.at(-1);
    await mutate(() => shell.classList.add("unrelated-state"));
    expect(themes.at(-1)).toBe(palette);
  });

  it("stops observing while closed and picks up changes before reopening", async () => {
    await act(async () => root.render(createElement(Probe, { open: true })));
    await act(async () => root.render(createElement(Probe, { open: false })));
    const renders = themes.length;
    await mutate(() =>
      shell.style.setProperty("--personal-main-surface", "#2b1c23"),
    );
    expect(themes).toHaveLength(renders);
    await act(async () => root.render(createElement(Probe, { open: true })));
    expect(themes.at(-1)?.background).toBe("#2b1c23");
  });
});

describe("usage panel native glass", () => {
  it("carries the workspace opacity when the window shows native glass", () => {
    glassWorkspace();
    expect(usagePanelTheme()).toMatchObject({
      mode: "dark",
      glass: true,
      opacity: 0.52,
    });
  });

  it("stays opaque in light appearance, without native glass, at full opacity or with workspace glass off", () => {
    const opaque = () => {
      const theme = usagePanelTheme();
      expect(theme.glass).toBe(false);
      expect(theme).not.toHaveProperty("opacity");
    };
    opaque();
    glassWorkspace();
    document.documentElement.classList.add("theme-light");
    opaque();
    document.documentElement.classList.remove("theme-light");
    document.documentElement.classList.remove("has-native-glass");
    opaque();
    glassWorkspace("1");
    opaque();
    glassWorkspace();
    document.documentElement.classList.remove("glass-body");
    opaque();
  });

  it("respects Reduce transparency and Increase contrast", () => {
    glassWorkspace();
    stubMedia(["(prefers-reduced-transparency: reduce)"]);
    expect(usagePanelTheme().glass).toBe(false);
    stubMedia(["(prefers-contrast: more)"]);
    expect(usagePanelTheme().glass).toBe(false);
    stubMedia([]);
    expect(usagePanelTheme().glass).toBe(true);
  });

  it("follows opacity, workspace and accessibility changes while open", async () => {
    glassWorkspace();
    const setMedia = stubMedia([]);
    await act(async () => root.render(createElement(Probe, { open: true })));
    expect(themes.at(-1)).toMatchObject({ glass: true, opacity: 0.52 });
    await mutate(() =>
      document.documentElement.style.setProperty("--sidebar-opacity", "0.3"),
    );
    expect(themes.at(-1)).toMatchObject({ glass: true, opacity: 0.3 });
    await mutate(() =>
      setMedia("(prefers-reduced-transparency: reduce)", true),
    );
    expect(themes.at(-1)?.glass).toBe(false);
    await mutate(() =>
      setMedia("(prefers-reduced-transparency: reduce)", false),
    );
    expect(themes.at(-1)?.glass).toBe(true);
    await mutate(() => document.documentElement.classList.add("theme-light"));
    expect(themes.at(-1)?.glass).toBe(false);
  });

  it("uses the accent the active workspace paints on the document root", () => {
    // The real cascade: the shell's accent resolves the workspace color that
    // `useActivateWorkspaceTheme` applies to the root for the active workspace.
    applyThemeColors({ dark: { accent: "#c5afe0", background: "#21192c" } });
    shell.style.setProperty(
      "--personal-accent",
      "var(--theme-accent-color, #000000)",
    );
    expect(usagePanelTheme().accent).toBe("#c5afe0");
    applyThemeColors({});
  });
});
