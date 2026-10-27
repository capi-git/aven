// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolbarPanelTheme } from "../chrome/ToolbarPanel";
import { usePanelWindowTheme } from "./usePanelWindowTheme";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function Probe({ theme }: { theme?: ToolbarPanelTheme }) {
  usePanelWindowTheme("test-panel-window", theme);
  return null;
}

const style = () => document.documentElement.style;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  const html = document.documentElement;
  html.className = "";
  html.removeAttribute("style");
});

describe("a native panel window's palette", () => {
  it("marks the window before any snapshot, so an early error is not opaque", async () => {
    await act(async () => root.render(createElement(Probe)));
    expect(document.documentElement.classList).toContain("test-panel-window");
    expect(document.documentElement.classList).not.toContain("theme-light");
  });

  it("takes the owner's mode, text and accent, so shared tokens resolve as in the workspace", async () => {
    const light: ToolbarPanelTheme = {
      mode: "light",
      accent: "#0a0a0a",
      background: "#ffffff",
      text: "#000000",
    };
    await act(async () => root.render(createElement(Probe, { theme: light })));
    expect(document.documentElement.classList).toContain("theme-light");
    expect(style().colorScheme).toBe("light");
    expect(style().getPropertyValue("--theme-content-color")).toBe("#000000");
    expect(style().getPropertyValue("--theme-accent-color")).toBe("#0a0a0a");

    const dark: ToolbarPanelTheme = { mode: "dark", accent: "#e8e8ea" };
    await act(async () => root.render(createElement(Probe, { theme: dark })));
    expect(document.documentElement.classList).not.toContain("theme-light");
    expect(style().colorScheme).toBe("dark");
    expect(style().getPropertyValue("--theme-content-color")).toBe("");
    expect(style().getPropertyValue("--theme-accent-color")).toBe("#e8e8ea");
  });
});

describe("native panel windows", () => {
  it("all take their owner's palette the same way", () => {
    for (const [file, windowClass] of [
      [
        "src/surfaces/WorkspaceMenuPanelWindow.tsx",
        "workspace-menu-panel-window",
      ],
      ["src/surfaces/AccessPanelWindow.tsx", "access-panel-window"],
      ["src/surfaces/UsagePanelWindow.tsx", "usage-panel-window"],
    ])
      expect(readFileSync(file, "utf8")).toContain(
        `usePanelWindowTheme("${windowClass}"`,
      );
  });

  it("load the workspace's stylesheets before choosing which window to draw", () => {
    const main = readFileSync("src/main.tsx", "utf8");
    const route = main.indexOf("floatingSidebar");
    for (const sheet of [
      'import "./index.css";',
      'import "./personal-shell.css";',
      'import "./macos-theme.css";',
      'import "./motion.css";',
    ]) {
      expect(main).toContain(sheet);
      expect(main.indexOf(sheet)).toBeLessThan(route);
    }
  });

  it("stay solid, like the menus and popovers in the workspace window", () => {
    // The owner never asks a panel for frost (usagePanel.ts).
    expect(readFileSync("src/lib/usagePanel.ts", "utf8")).toMatch(
      /glass: false,\n\s*\};/,
    );
  });
});
