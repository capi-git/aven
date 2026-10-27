import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shell = readFileSync("src/personal-shell.css", "utf8");
const overlay = readFileSync("src/surfaces/FloatingSidebarWindow.css", "utf8");

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

  it("draws no shadow past the edge native code slides the overlay by", () => {
    expect(
      rule(
        overlay,
        /\.aven-floating-sidebar-overlay\s*\.personal-shell\s*\.personal-sidebar-slot\[data-floating="true"\]\s*> \.personal-sidebar \{\s*box-shadow/,
      ),
    ).toContain("box-shadow: none;");
    // The overlay itself paints nothing but the drawer and its menus.
    expect(overlay).toContain("background: transparent !important;");
  });
});
