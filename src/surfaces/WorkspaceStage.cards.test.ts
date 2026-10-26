import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORKSPACE_EDGE } from "./WorkspaceStage";

/** The body of the first rule whose selector list ends with `selector {`. */
function rule(file: string, selector: string) {
  const css = readFileSync(file, "utf8");
  const block = css
    .split(/\n}\n/)
    .find((entry) => entry.trimEnd().includes(`${selector} {`));
  if (!block) throw new Error(`Missing ${selector} in ${file}`);
  return block.slice(block.indexOf(`${selector} {`));
}

describe("panes as cards", () => {
  it("keeps the panes' outer gap equal to the panels' window gutter", () => {
    const css = readFileSync("src/macos-theme.css", "utf8");
    const gutter = /--aven-window-gutter: (\d+(?:\.\d+)?)px;/.exec(css)?.[1];
    expect(Number(gutter)).toBe(WORKSPACE_EDGE);
  });

  it("draws each pane as a rounded card from the shared tokens, without a glass layer of its own", () => {
    const card = rule(
      "src/surfaces/WorkspaceStage.css",
      ".workspace-stage-surface",
    );
    expect(card).toContain("border: 1px solid var(--aven-glass-card-edge);");
    expect(card).toContain("border-radius: var(--aven-radius-pane);");
    expect(card).toContain("box-shadow: var(--aven-control-shadow);");
    // The window already provides the glass; a filter per card is a new
    // compositing layer for every pane.
    expect(card).not.toMatch(/backdrop-filter|background:/);
    const header = rule(
      "src/surfaces/WorkspaceStage.css",
      ".workspace-stage-header",
    );
    expect(header).toMatch(
      /border-radius: calc\(var\(--aven-radius-pane\) - 1px\)\s+calc\(var\(--aven-radius-pane\) - 1px\) 0 0;/,
    );
  });

  it("leaves the gap as the divider, drawn only while it is used", () => {
    const line = rule(
      "src/surfaces/WorkspaceStage.css",
      ".workspace-stage-sash::after",
    );
    expect(line).toContain("background: transparent;");
    const css = readFileSync("src/surfaces/WorkspaceStage.css", "utf8");
    expect(css).toMatch(
      /\.workspace-stage-sash:hover::after,\s*\.workspace-stage-sash:focus-visible::after,\s*\.workspace-stage-sash:active::after \{\s*background: var\(--color-accent\);/,
    );
  });

  it("fits the native browser page inside its card on macOS and Windows", () => {
    const host = rule("src/surfaces/BrowserPane.css", ".browser-native-host");
    // macOS reads this radius and rounds the page's own bottom corners.
    expect(host).toMatch(
      /border-radius: 0 0 calc\(var\(--aven-radius-pane\) - 1px\)\s+calc\(var\(--aven-radius-pane\) - 1px\);/,
    );
    // Windows draws the page square, so it sits inside the curve instead.
    const windows = rule(
      "src/surfaces/BrowserPane.css",
      "html:not(.is-mac) .browser-native-host",
    );
    expect(windows).toContain("margin: 0 2px 2px;");
    expect(windows).toContain("border-radius: 0;");
    // Nothing flattens the cards or the page's curve again in the shell.
    const shell = readFileSync("src/personal-shell.css", "utf8");
    expect(shell).not.toMatch(
      /\.(workspace-stage-surface|browser-native-host)[^{]*\{[^}]*border-radius: 0;/,
    );
  });
});
