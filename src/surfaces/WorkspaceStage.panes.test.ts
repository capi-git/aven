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

describe("panes as cards", () => {
  it("lays panes against the workspace's edges, 6px apart", () => {
    expect(WORKSPACE_EDGE).toBe(0);
    // Native browser pages cannot be drawn over, so the gap between two
    // cards is real space, not a painted line.
    expect(PANE_GUTTER * 2).toBe(6);
  });

  it("draws each pane as its own rounded card, with no glass of its own", () => {
    const pane = rule(
      "src/surfaces/WorkspaceStage.css",
      ".workspace-stage-surface",
    );
    expect(pane).toContain(
      "border: 1px solid var(--aven-pane-edge, transparent);",
    );
    expect(pane).toContain(
      "border-radius: var(--aven-radius-pane-card, 10px);",
    );
    expect(pane).toContain("background: var(--aven-pane-fill, transparent);");
    // The window already provides the glass; a filter per pane is a new
    // compositing layer for every pane.
    expect(pane).not.toMatch(/backdrop-filter|box-shadow:/);
    // The card around the panes steps back only while panes show.
    const shell = readFileSync("src/personal-shell.css", "utf8");
    expect(shell).toMatch(
      /\.personal-main\.body-glass\[data-panes\] \{[^}]*--aven-pane-fill: var\(--aven-inset-panel\);[^}]*background: transparent;/,
    );
    // A chat background shows through the panes.
    expect(shell).toMatch(
      /html\.has-chat-background:not\(\.chat-background-empty-only\)[^{]*\[data-panes\] \{\s*--aven-pane-fill: transparent;/,
    );
  });

  it("rounds a closed pane's rail like an open pane's card", () => {
    expect(
      rule("src/surfaces/WorkspaceStage.css", ".workspace-pane-rail"),
    ).toContain("border-radius: var(--aven-radius-pane-card, 10px);");
  });

  it("ends every tab row in a pane with the shared hairline", () => {
    expect(
      rule("src/surfaces/WorkspaceStage.css", ".workspace-stage-header"),
    ).toContain(hairlineBelow);
    expect(rule("src/chrome/TitleBar.css", ".aven-tab-bar")).toContain(
      hairlineBelow,
    );
  });

  it("divides panes by their gap: no line in a 9px target, unchanged while used", () => {
    const line = rule(
      "src/surfaces/WorkspaceStage.css",
      ".workspace-stage-sash::after",
    );
    expect(line).toContain("background: transparent;");
    expect(
      rule(
        "src/surfaces/WorkspaceStage.css",
        '.workspace-stage-sash[data-direction="right"]::after',
      ),
    ).toContain("width: var(--aven-hairline);");
    expect(
      rule(
        "src/surfaces/WorkspaceStage.css",
        '.workspace-stage-sash[data-direction="right"]',
      ),
    ).toContain("width: 9px;");
    expect(
      rule(
        "src/surfaces/WorkspaceStage.css",
        '.workspace-stage-sash[data-direction="down"]',
      ),
    ).toContain("height: 9px;");
    const css = readFileSync("src/surfaces/WorkspaceStage.css", "utf8");
    // Pointing at it or dragging changes only the cursor.
    expect(css).not.toMatch(/\.workspace-stage-sash[^{]*:hover/);
    expect(css).not.toMatch(/\.aven-pane-seam[^{]*:hover/);
    // Grabbing one focuses it, which must not draw the keyboard's line.
    expect(css).toMatch(
      /\.workspace-stage:not\(\[data-resizing="true"\]\)\s*\.workspace-stage-sash:focus-visible:not\(:active\)::after/,
    );
    // A split inside a tab uses the same line.
    expect(readFileSync("src/surfaces/PaneTree.tsx", "utf8")).toContain(
      "w-(--aven-hairline) bg-(--aven-separator)",
    );
  });

  it("draws no line beside a docked sidebar or side panel until you go to resize", () => {
    const divider = rule(
      "src/personal-shell.css",
      ".personal-shell .personal-panel-resizer::after",
    );
    expect(divider).toContain("background: transparent;");
    // Pointing at it or dragging changes only the cursor; the keyboard's
    // focus still shows where it is.
    const shell = readFileSync("src/personal-shell.css", "utf8");
    expect(shell).not.toMatch(/\.personal-panel-resizer:hover::after/);
    expect(shell).not.toMatch(
      /\.personal-panel-resizer\[data-resizing[^{]*::after/,
    );
    expect(shell).not.toMatch(/-divider:hover \{/);
    // Grabbing an edge focuses it, which must not draw the keyboard's line.
    expect(shell).toMatch(
      /\.personal-panel-resizer:focus-visible:not\(\s*\[data-resizing="true"\],\s*:active\s*\)::after \{[^}]*width: 2px;/,
    );
  });

  it("is a size container only with a wallpaper, as resizing one is slow", () => {
    const stage = rule("src/surfaces/WorkspaceStage.css", ".workspace-stage");
    expect(stage).not.toContain("container-type");
    expect(stage).toContain("contain: layout size style;");
    expect(
      rule(
        "src/surfaces/WorkspaceStage.css",
        "html.has-chat-background .workspace-stage",
      ),
    ).toContain("container-type: size;");
  });

  it("never restyles every element when a resize starts or ends", () => {
    const index = readFileSync("src/index.css", "utf8");
    expect(index).not.toMatch(/is-resizing[^{]*\*/);
    expect(index).not.toMatch(/is-window-resizing/);
    // The frost pause is off the Mac only.
    expect(readFileSync("src/main.tsx", "utf8")).toContain(
      'if (!IS_MAC) void import("./frost-pause.css");',
    );
    for (const path of [
      "src/hooks/useDragResize.ts",
      "src/surfaces/WorkspaceStage.tsx",
      "src/surfaces/PaneTree.tsx",
      "src/surfaces/ProjectTerminalDock.tsx",
      "src/chrome/GitHistoryGraph.tsx",
    ])
      expect(readFileSync(path, "utf8")).not.toContain(
        "document.body.style.cursor",
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
