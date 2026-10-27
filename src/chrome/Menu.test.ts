import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * One menu: every menu, picker list and switcher draws its rows from
 * Menu.css, so a context menu, the workspace switcher and the composer's
 * + menu read as one family, in the workspace window and in the separate
 * native menu windows alike.
 */
const read = (file: string) => readFileSync(file, "utf8");
const theme = read("src/macos-theme.css");
const menu = read("src/chrome/Menu.css").replace(/\/\*[\s\S]*?\*\//g, "");

const tracked = (pattern: string) =>
  execFileSync("git", ["ls-files", pattern], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

function token(name: string) {
  const match = new RegExp(`${name}: ([^;]+);`).exec(theme);
  if (!match) throw new Error(`Missing ${name}`);
  return match[1].trim();
}

/** Every `property: value` declared in Menu.css. */
function declarations(property: string) {
  return [
    ...menu.matchAll(new RegExp(`(?:^|[;{\\s])${property}: ([^;]+);`, "g")),
  ].map((match) => match[1].trim());
}

/** Source files that render a menu's rows inside a popover. */
const MENUS = [
  "src/chrome/AddProjectMenu.tsx",
  "src/chrome/BranchPicker.tsx",
  "src/chrome/Composer.tsx",
  "src/chrome/CwdPicker.tsx",
  "src/chrome/FileMentionPicker.tsx",
  "src/chrome/InboxFiltersMenu.tsx",
  "src/chrome/ModelPicker.tsx",
  "src/chrome/OrchestrationPreview.tsx",
  "src/chrome/SecondOpinionButton.tsx",
  "src/chrome/SessionFiltersMenu.tsx",
  "src/chrome/SkillPicker.tsx",
  "src/chrome/WorkspaceMenuPanel.tsx",
  "src/chrome/WorkspaceProfileMenu.tsx",
  "src/chrome/AccessPanel.tsx",
  "src/surfaces/RaceReviewerPicker.tsx",
  "src/surfaces/SettingsControls.tsx",
  "src/surfaces/TranscriptSelectionMenu.tsx",
];

describe("one menu", () => {
  it("nests 26px rows 4px inside a 10px menu, so their 6px corners are concentric", () => {
    expect(token("--aven-menu-row")).toBe("26px");
    expect(token("--aven-menu-inset")).toBe("4px");
    expect(token("--aven-menu-row-x")).toBe("8px");
    expect(token("--aven-menu-icon")).toBe("14px");
    expect(token("--aven-menu-icon-rich")).toBe("16px");
    const overlay = Number.parseFloat(token("--aven-radius-overlay"));
    const inset = Number.parseFloat(token("--aven-menu-inset"));
    expect(Number.parseFloat(token("--aven-radius-row"))).toBe(overlay - inset);
  });

  it("writes no literal corner, row height, glyph size or text size in the menu", () => {
    for (const radius of declarations("border-radius"))
      expect(radius).toMatch(/^var\(--aven-radius-/);
    for (const height of declarations("min-height"))
      expect(height).toMatch(/^(0|var\(--aven-menu-row\))$/);
    for (const size of declarations("font-size"))
      expect(size).toMatch(/^var\(--text-ui-/);
    for (const property of ["width", "height"])
      for (const size of declarations(property))
        expect(size).toMatch(
          /^(100%|1px|var\(--aven-(menu-icon(-rich)?|field-height)\))$/,
        );
  });

  it("draws every row in the menu's own grey, never the accent", () => {
    expect(menu).not.toMatch(/color-mix\(\s*in srgb,\s*var\(--color-accent/);
    expect(menu).toMatch(
      /--aven-menu-hover: color-mix\(in srgb, var\(--aven-menu-ink\) 9%, transparent\);/,
    );
    // The ink follows a ToolbarPanel's palette in a native menu window.
    expect(menu).toContain(
      "--aven-menu-ink: var(--toolbar-panel-text, var(--color-content));",
    );
  });

  it("builds each menu from the shared rows", () => {
    for (const file of MENUS) {
      const source = read(file);
      expect(source, file).toMatch(/import "(\.\/|\.\.\/chrome\/)Menu\.css";/);
      expect(source, file).toMatch(/className=\{?[`"]aven-menu[\s"`$]/);
      expect(source, file).toContain("aven-menu-item");
    }
  });

  it("leaves no popover menu with rows of its own", () => {
    // The window toolbar's overflow menu belongs to the pane-header work.
    const allowed = new Set(["src/chrome/WorkspaceStatusBar.tsx"]);
    const own = tracked("src/*.tsx")
      .filter((file) => !file.includes(".test.") && !allowed.has(file))
      .filter((file) => {
        const source = read(file);
        return (
          source.includes("<Popover") &&
          /role="menuitem(radio|checkbox)?"/.test(source) &&
          !source.includes("aven-menu-item")
        );
      });
    expect(own).toEqual([]);
  });
});
