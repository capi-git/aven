import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");
const theme = read("src/macos-theme.css");

/** The body of the first rule whose selector ends with `selector {`. */
function rule(file: string, selector: string) {
  const css = read(file);
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`Missing ${selector} in ${file}`);
  return css.slice(at, css.indexOf("}", at));
}

/** A token's value as declared in the shell's shared materials. */
function token(name: string) {
  const match = new RegExp(`${name}: ([^;]+);`).exec(theme);
  if (!match) throw new Error(`Missing ${name}`);
  return match[1].trim();
}

describe("the pro look's shapes", () => {
  it("keeps one scale: small controls, rounder conversation, capsule tags", () => {
    expect(token("--aven-radius-sm")).toBe("6px");
    expect(token("--aven-radius-row")).toBe("6px");
    expect(token("--aven-radius-md")).toBe("8px");
    expect(token("--aven-radius-lg")).toBe("10px");
    expect(token("--aven-radius-card")).toBe("10px");
    expect(token("--aven-radius-overlay")).toBe("10px");
    expect(token("--aven-radius-bubble")).toBe("12px");
    expect(token("--aven-radius-xl")).toBe("12px");
    expect(token("--aven-radius-sheet")).toBe("12px");
    expect(token("--aven-radius-capsule")).toBe("999px");
    // A segmented control's thumb nests 2px inside its track.
    expect(token("--aven-radius-track")).toBe("7px");
    expect(token("--aven-radius-thumb")).toBe(
      "calc(var(--aven-radius-track) - 2px)",
    );
  });

  it("gives buttons, tabs and fields the control corner, not a capsule", () => {
    for (const [file, selector] of [
      ["src/chrome/TitleBar.css", ".aven-tab-button"],
      [
        "src/surfaces/SettingsControls.css",
        ".settings-select,\n.settings-button",
      ],
      ["src/chrome/TeamCard.css", ".team-card-button"],
      ["src/surfaces/WorkspaceHome.css", ".workspace-home-actions button"],
      [
        "src/chrome/Composer.css",
        ".personal-shell .personal-composer-actions > button",
      ],
      ["src/surfaces/SessionRunStatus.css", ".session-run-stop"],
      ["src/surfaces/BrowserPane.css", ".browser-address"],
      ["src/surfaces/SettingsView.css", ".settings-search-field"],
      ["src/chrome/AgentPill.css", ".agent-pill"],
    ])
      expect(rule(file, selector)).toMatch(
        /border-radius: var\(--aven-radius-sm(, 6px)?\);/,
      );
  });

  it("keeps status chips, counts and tags as capsules", () => {
    for (const [file, selector] of [
      [
        "src/chrome/DevPreviewChip.css",
        '.dev-preview-chip[data-placement="terminal"]',
      ],
      ["src/surfaces/BotChat.css", ".bot-wake-label"],
      ["src/chrome/TitleBar.css", ".personal-shell .personal-tab-group-chip"],
    ])
      expect(rule(file, selector)).toContain(
        "border-radius: var(--aven-radius-capsule);",
      );
    expect(
      rule("src/surfaces/SettingsControls.css", ".settings-group-scope"),
    ).toContain("border-radius: 999px;");
  });

  it("draws every segmented control on the track and thumb corners", () => {
    for (const [file, track, thumb] of [
      [
        "src/surfaces/SettingsControls.css",
        ".settings-segmented",
        ".settings-segmented button",
      ],
      ["src/chrome/AgentPill.css", ".agent-segmented", ".agent-segment"],
      [
        "src/chrome/WorkspaceInspector.css",
        ".workspace-inspector-tabs",
        ".workspace-inspector-tab",
      ],
      [
        "src/chrome/ShipFlow.css",
        ".ship-flow-modes",
        ".ship-flow-modes > button",
      ],
    ]) {
      expect(rule(file, track)).toMatch(
        /border-radius: var\(--aven-radius-track(, 7px)?\);/,
      );
      expect(rule(file, thumb)).toMatch(
        /border-radius: var\(--aven-radius-thumb(, 5px)?\);/,
      );
    }
  });

  it("rounds the conversation: the message box, messages and its cards", () => {
    expect(
      rule("src/chrome/Composer.css", ".personal-shell .personal-composer"),
    ).toContain("--composer-radius: var(--aven-radius-xl);");
    expect(
      rule(
        "src/surfaces/AgentTranscript.css",
        ".personal-shell .personal-user-bubble",
      ),
    ).toContain("border-radius: var(--aven-radius-bubble);");
    expect(rule("src/chrome/TeamCard.css", ".team-card")).toContain(
      "border-radius: var(--aven-radius-lg, 10px);",
    );
    expect(rule("src/surfaces/BotChat.css", ".bot-fix-card")).toContain(
      "border-radius: var(--aven-radius-lg);",
    );
    expect(
      rule("src/surfaces/WorkspaceHome.css", ".workspace-home-panel"),
    ).toContain("border-radius: var(--aven-radius-xl, 12px);");
  });

  it("titles pages at 20px semibold rather than a large title", () => {
    expect(read("src/index.css")).toContain("--text-ui-title: 20px;");
    for (const [file, selector] of [
      ["src/surfaces/SettingsControls.css", ".settings-page-header h1"],
      ["src/surfaces/WorkspaceHome.css", ".workspace-home-title h1"],
    ])
      expect(rule(file, selector)).toContain("font-weight: 600;");
  });

  it("keeps navigation and list rows at IDE density", () => {
    expect(
      rule(
        "src/chrome/PersonalNavigation.css",
        ".personal-shell .personal-navigation .personal-task-card",
      ),
    ).toContain("min-height: 28px;");
    expect(
      rule("src/chrome/SettingsRail.css", ".settings-nav__item"),
    ).toContain("min-height: 28px;");
    expect(
      rule(
        "src/chrome/WorkspaceMenuPanel.css",
        ".workspace-menu-panel-compact .workspace-menu-panel-item",
      ),
    ).toContain("min-height: 26px;");
    // File tree and Changes rows: 26px.
    expect(read("src/chrome/FileTree.tsx")).toContain(
      "flex h-6.5 w-full cursor-default items-center",
    );
    expect(read("src/chrome/GitChangesPanel.tsx")).toContain(
      "group flex h-6.5 w-full items-center",
    );
  });

  it("presses subtly and grows popups a little from their control", () => {
    const motion = read("src/motion.css");
    expect(motion).toContain("--aven-press-scale: 0.98;");
    expect(motion).toContain("--aven-pop-scale: 0.97;");
  });
});
