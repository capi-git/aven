import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shell = readFileSync("src/personal-shell.css", "utf8");
const overlay = readFileSync("src/surfaces/FloatingSidebarWindow.css", "utf8");
const navigation = readFileSync("src/chrome/PersonalNavigation.css", "utf8");
const native = readFileSync("src-tauri/chromium/floating_sidebar.mm", "utf8");

/** The body of the rule whose selector ends `> .personal-sidebar {`. */
function rule(css: string, selector: RegExp) {
  const match = selector.exec(css);
  if (!match) throw new Error(`Missing ${selector}`);
  return css.slice(match.index, css.indexOf("}", match.index));
}

describe("the hover sidebar's drawer", () => {
  it("is flush with the window's edge and the workspace's top and bottom", () => {
    // Inset as a card it left a gutter where, over a page, the window
    // behind the workspace showed through: a dark band in light mode.
    const drawer = rule(
      shell,
      /\.personal-sidebar-slot\[data-floating="true"\]\s*> \.personal-sidebar \{\s*inset: 0 auto 0 0;/,
    );
    expect(drawer).toContain("height: 100%;");
    expect(drawer).toContain("border-radius: 0;");
    expect(drawer).toContain(
      "border-right: var(--aven-hairline) solid var(--aven-separator);",
    );
    expect(drawer).not.toContain("--aven-window-gutter");
    expect(shell).toMatch(
      /\.personal-sidebar-slot\[data-floating="true"\] \{\s*width: var\(--nav-width, 216px\);\s*border-radius: 0;/,
    );
  });

  it("keeps its shadow within how far native code hides the closed card", () => {
    const blur = /0 12px (\d+)px rgb\(0 0 0 \/ 0\.28\)/.exec(navigation);
    const reach = /kShadowReach = (\d+)/.exec(native);
    expect(Number(blur?.[1])).toBeLessThan(Number(reach?.[1]));
    // The overlay itself paints nothing but the card and its menus.
    expect(overlay).toContain("background: transparent !important;");
  });
});
