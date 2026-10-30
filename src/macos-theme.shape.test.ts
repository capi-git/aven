import { execFileSync } from "node:child_process";
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
    ).toContain("border-radius: var(--aven-radius-capsule);");
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
    // Every menu's rows (Menu.css): 26px.
    expect(rule("src/chrome/Menu.css", ".aven-menu-item")).toContain(
      "min-height: var(--aven-menu-row);",
    );
    expect(theme).toContain("--aven-menu-row: 26px;");
    // File tree and Changes rows: 26px.
    expect(read("src/chrome/FileTree.tsx")).toContain(
      "flex h-6.5 w-full cursor-default items-center",
    );
    expect(read("src/chrome/GitChangesPanel.tsx")).toContain(
      "group flex h-6.5 w-full items-center",
    );
  });

  it("keeps controls flat: a fill, no outline, ring or lift", () => {
    // Dark and light both drop the iOS look's lift and top-edge light.
    expect(theme.match(/--aven-control-shadow: none;/g)?.length).toBe(2);
    expect(token("--aven-control-edge")).toBe("transparent");
    // Fields, chips, the agent pill and segmented tracks draw only the
    // Increase contrast edge.
    for (const [file, selector] of [
      ["src/surfaces/SettingsView.css", ".settings-scope-line"],
      ["src/surfaces/SettingsView.css", ".settings-search-field"],
      ["src/chrome/AgentPill.css", ".agent-pill"],
      ["src/chrome/Menu.css", ".aven-menu-search"],
      ["src/chrome/WorkspaceThemePopover.css", ".workspace-theme-schemes"],
      ["src/surfaces/ScheduledInbox.css", ".scheduled-days"],
      [
        "src/surfaces/UtilityViews.css",
        '[data-app-search] input[aria-label="Search"]',
      ],
      ["src/chrome/SharedWork.css", ".shared-work-bar"],
    ]) {
      const body = rule(file, selector);
      expect(body).toMatch(
        /border: 1px solid var\(--aven-control-edge, transparent\);/,
      );
      expect(body).not.toMatch(
        /box-shadow: var\(--aven-(glass-sheen|specular)/,
      );
    }
    // The active tab is a fill; its edge is the Increase contrast one.
    expect(read("src/chrome/TitleBar.css")).toMatch(
      /--aven-tab-selected-edge: inset 0 0 0 1px\s+var\(--aven-control-edge, transparent\);/,
    );
  });

  it("keeps the primary buttons a solid fill without a shadow", () => {
    for (const [file, selector] of [
      [
        "src/surfaces/WorkspaceHome.css",
        ".workspace-home-actions .workspace-home-new",
      ],
      ["src/chrome/GitChangesPanel.css", ".git-ship-button"],
      ["src/chrome/TeamCard.css", '.team-card-button[data-variant="primary"]'],
    ])
      expect(rule(file, selector)).not.toMatch(/box-shadow: (?!none)/);
  });

  it("steps secondary buttons' fill from rest to hover to pressed", () => {
    expect(token("--aven-control-bg")).toBe("var(--aven-fill-tertiary)");
    expect(token("--aven-control-hover")).toBe("var(--aven-fill-secondary)");
    expect(token("--aven-control-pressed")).toBe("var(--aven-fill)");
    expect(theme).toMatch(
      /\.settings-button:not\(\.settings-button-danger\),[\s\S]*?\):active:not\(:disabled\) \{\s*background: var\(--aven-control-pressed\);/,
    );
  });

  it("keeps three solid steps when Reduce transparency or Increase contrast makes controls solid", () => {
    const solid = theme.slice(
      theme.indexOf(
        "@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {",
      ),
    );
    const block = solid.slice(0, solid.indexOf("\n}\n"));
    expect(block).toContain("--aven-control-bg: var(--aven-elevated-2);");
    expect(block).toMatch(
      /--aven-control-hover: color-mix\(\s*in srgb,\s*var\(--color-content\) 20%,/,
    );
    expect(block).toContain("--aven-control-pressed: var(--aven-elevated-3);");
    // Light mode's steps are 4%, 6% and 8%.
    expect(block).toMatch(
      /html\.theme-light \.personal-shell \{\s*--aven-control-hover: color-mix\(\s*in srgb,\s*var\(--color-content\) 6%,/,
    );
    // Engines without backdrop filters get solid steps too.
    const fallback = theme.slice(theme.indexOf("@supports not ("));
    expect(fallback).toMatch(/--aven-control-hover: color-mix\(/);
    expect(fallback).toMatch(/--aven-control-pressed: color-mix\(/);
  });

  it("gives Tailwind fields and buttons the shared tokens and contrast edge", () => {
    // Fields share one class: the field fill, the control corner, the
    // Increase contrast edge and the shared focus ring.
    const field = rule("src/macos-theme.css", ".aven-field");
    expect(field).toContain(
      "border: 1px solid var(--aven-control-edge, transparent);",
    );
    expect(field).toContain("border-radius: var(--aven-radius-sm);");
    expect(field).toContain("background: var(--aven-field-bg);");
    expect(theme).toMatch(
      /\.aven-field:focus-visible,[^{]*\{\s*outline: 2px solid var\(--aven-field-focus\);/,
    );
    const button =
      "border border-(color:--aven-control-edge) bg-(--aven-control-bg)";
    for (const file of [
      "src/chrome/ProjectSearch.tsx",
      "src/chrome/QuestionForm.tsx",
      "src/chrome/ColorPickerPopover.tsx",
      "src/chrome/ProjectCustomizePopover.tsx",
      "src/chrome/PersonalWorkspaceSwitcher.tsx",
      "src/chrome/ProjectMemoryDialog.tsx",
      "src/chrome/AddSkillDialog.tsx",
      "src/chrome/SwitchBranchDialog.tsx",
      "src/chrome/RememberButton.tsx",
      "src/chrome/SkillPicker.tsx",
      "src/surfaces/DiffCommentComposer.tsx",
    ])
      expect(read(file)).toMatch(/className="aven-field[ "]/);
    for (const file of [
      "src/surfaces/RaceView.tsx",
      "src/chrome/CommandPalette.tsx",
      "src/chrome/ApplyWorkspaceThemeButton.tsx",
    ]) {
      expect(read(file)).toContain(button);
      expect(read(file)).toContain("hover:bg-(--aven-control-hover)");
    }
  });

  it("keeps a hover fill on the automation example presets", () => {
    expect(read("src/surfaces/ScheduledInbox.css")).toMatch(
      /\.scheduled-examples \.scheduled-preset:hover,\s*\.scheduled-examples \.scheduled-preset\[aria-pressed="true"\] \{\s*background: var\(--aven-control-hover/,
    );
  });

  it("draws a hairline one device pixel thick at every display scale", () => {
    for (const [dppx, width] of [
      ["1.25", "0.8px"],
      ["1.5", "0.6667px"],
      ["1.75", "0.5715px"],
      ["2", "0.5px"],
      ["2.5", "0.4px"],
      ["3", "0.3334px"],
    ]) {
      const at = theme.indexOf(`@media (min-resolution: ${dppx}dppx) {`);
      expect(at).toBeGreaterThan(0);
      expect(theme.slice(at, theme.indexOf("\n}\n", at))).toContain(
        `--aven-hairline: ${width};`,
      );
    }
    // The Mac toolbar cancels the interface zoom; its hairline does not.
    expect(read("src/personal-shell.css")).toMatch(
      /calc\(-1 \* var\(--aven-hairline\) \/ var\(--aven-toolbar-zoom, 1\)\)/,
    );
  });

  it("fills Settings groups and Home's cards, edged only in light mode", () => {
    expect(token("--aven-resting-card-edge")).toBe("var(--aven-control-edge)");
    expect(
      rule("src/macos-theme.css", "html.theme-light .personal-shell"),
    ).toContain("--aven-resting-card-edge: var(--aven-glass-card-edge);");
    for (const [file, selector] of [
      ["src/surfaces/SettingsControls.css", ".settings-group-surface"],
      ["src/surfaces/WorkspaceHome.css", ".workspace-home-panel"],
    ])
      expect(rule(file, selector)).toMatch(
        /border: 1px solid var\(--aven-resting-card-edge/,
      );
    // Cards in the chat keep their edge.
    expect(rule("src/chrome/TeamCard.css", ".team-card")).toContain(
      "border: 1px solid var(--aven-glass-card-edge",
    );
  });

  it("writes capsules with the token, and no corner fallback that disagrees with it", () => {
    const files = execFileSync("git", ["ls-files", "src/*.css"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    const literal: string[] = [];
    const disagree: string[] = [];
    for (const file of files) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
      for (const [declaration] of css.matchAll(/radius:\s*(?:999|99)px/g))
        literal.push(`${file}: ${declaration}`);
      for (const [, name, fallback] of css.matchAll(
        /var\((--aven-radius-[a-z]+), (\d+px)\)/g,
      )) {
        const value = token(name);
        if (/^\d+px$/.test(value) && value !== fallback)
          disagree.push(`${file}: ${name} ${value} ≠ ${fallback}`);
      }
    }
    expect(literal).toEqual([]);
    expect(disagree).toEqual([]);
  });

  it("presses subtly and grows popups a little from their control", () => {
    const motion = read("src/motion.css");
    expect(motion).toContain("--aven-press-scale: 0.98;");
    expect(motion).toContain("--aven-pop-scale: 0.97;");
  });
});

describe("no pixel art", () => {
  const tracked = (pattern: string) =>
    execFileSync("git", ["ls-files", pattern], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);

  it("draws marks and art in round dots, never crisp square pixels", () => {
    // Aven's own mark is drawn from the app icon's grid; nothing else is.
    const crisp = tracked("src/*.tsx")
      .filter((file) => !file.includes(".test."))
      .filter((file) => /crispEdges|crisp-edges/.test(read(file)));
    expect(crisp).toEqual(["src/chrome/AvenMark.tsx"]);
  });

  it("moves things smoothly: no stepped sprite timing or pixelated images", () => {
    const stepped = tracked("src/*.css").filter((file) =>
      /steps\(|step-end|step-start|image-rendering:\s*pixelated/.test(
        read(file).replace(/\/\*[\s\S]*?\*\//g, ""),
      ),
    );
    expect(stepped).toEqual([]);
  });

  it("labels the helm's menu in the system font, with round effort dots and a room line", () => {
    const helm = read("src/chrome/ComposerHelm.css");
    expect(helm).not.toMatch(/polygon\(/);
    expect(rule("src/chrome/ComposerHelm.css", ".helm-pips i")).toContain(
      "border-radius: 50%;",
    );
    expect(rule("src/chrome/ComposerHelm.css", ".helm-room")).toContain(
      "height: 2px;",
    );
    expect(read("src/chrome/ComposerHelm.tsx")).not.toMatch(/pixelFont|"▶"/);
  });
});
