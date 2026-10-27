import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PANE_GUTTER, WORKSPACE_EDGE } from "./WorkspaceStage";

/** The body of the first rule whose selector list ends with `selector {`. */
function rule(file: string, selector: string) {
  const css = readFileSync(file, "utf8");
  const block = css
    .split(/\n}\n/)
    .find((entry) => entry.trimEnd().includes(`${selector} {`));
  if (!block) throw new Error(`Missing ${selector} in ${file}`);
  return block.slice(block.indexOf(`${selector} {`));
}

const hairlineBelow =
  "box-shadow: inset 0 calc(-1 * var(--aven-hairline)) 0 var(--aven-separator);";

describe("flush panes", () => {
  it("lays panes against the workspace's edges, one pixel apart", () => {
    expect(WORKSPACE_EDGE).toBe(0);
    // Native browser pages cannot be drawn over, so the divider needs a real
    // gap of its own between two panes.
    expect(PANE_GUTTER * 2).toBe(1);
  });

  it("draws each pane square, with no edge, fill or glass of its own", () => {
    const pane = rule(
      "src/surfaces/WorkspaceStage.css",
      ".workspace-stage-surface",
    );
    expect(pane).toContain("border: 0;");
    expect(pane).toContain("border-radius: 0;");
    // The window already provides the glass; a filter per pane is a new
    // compositing layer for every pane.
    expect(pane).not.toMatch(/backdrop-filter|background:|box-shadow:/);
    // Nothing rounds the panes again in the shell.
    const shell = readFileSync("src/personal-shell.css", "utf8");
    expect(shell).not.toMatch(
      /\.workspace-stage-surface[^{]*\{[^}]*border-radius: (?!0;)/,
    );
  });

  it("ends every tab row in a pane with the shared hairline", () => {
    expect(
      rule("src/surfaces/WorkspaceStage.css", ".workspace-stage-header"),
    ).toContain(hairlineBelow);
    expect(rule("src/chrome/TitleBar.css", ".aven-tab-bar")).toContain(
      hairlineBelow,
    );
  });

  it("divides panes with a resting hairline that turns to the accent while used", () => {
    const line = rule(
      "src/surfaces/WorkspaceStage.css",
      ".workspace-stage-sash::after",
    );
    expect(line).toContain("background: var(--aven-separator);");
    expect(
      rule(
        "src/surfaces/WorkspaceStage.css",
        '.workspace-stage-sash[data-direction="right"]::after',
      ),
    ).toContain("width: var(--aven-hairline);");
    const css = readFileSync("src/surfaces/WorkspaceStage.css", "utf8");
    expect(css).toMatch(
      /\.workspace-stage-sash:hover::after,\s*\.workspace-stage-sash:focus-visible::after,\s*\.workspace-stage-sash:active::after \{\s*background: var\(--color-accent\);/,
    );
    // A split inside a tab uses the same line.
    expect(readFileSync("src/surfaces/PaneTree.tsx", "utf8")).toContain(
      "w-(--aven-hairline) bg-(--aven-separator)",
    );
  });

  it("keeps the docked sidebar's and side panel's resting hairline", () => {
    const shell = readFileSync("src/personal-shell.css", "utf8");
    const divider = rule(
      "src/personal-shell.css",
      ".personal-shell .personal-panel-resizer::after",
    );
    expect(divider).toContain("width: var(--aven-hairline, 1px);");
    expect(divider).toContain(
      "background: var(--aven-separator, var(--personal-sidebar-edge));",
    );
    // The iOS look hid it at rest behind the floating cards' gap.
    expect(shell).not.toMatch(
      /\.personal-panel-resizer:not\([^)]*:hover[\s\S]*?\)::after \{\s*background: transparent;/,
    );
  });

  it("keeps the native browser page square on macOS and Windows", () => {
    const host = rule("src/surfaces/BrowserPane.css", ".browser-native-host");
    // Chromium reads this radius; at 0 it rounds none of the page's corners.
    expect(host).toContain("border-radius: 0;");
    expect(readFileSync("src/surfaces/BrowserPane.css", "utf8")).not.toContain(
      "html:not(.is-mac) .browser-native-host",
    );
  });
});
