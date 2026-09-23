// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  document.documentElement.classList.remove("theme-light");
  vi.unstubAllGlobals();
});

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
