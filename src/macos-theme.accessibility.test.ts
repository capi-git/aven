// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: vi.fn((path: string) => path),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({})),
}));

import { applyThemeColors } from "./lib/appearance";

const read = (file: string) => readFileSync(file, "utf8");
const theme = read("src/macos-theme.css");

/** The body of the first rule whose selector ends with `selector {`. */
function rule(file: string, selector: string) {
  const css = read(file);
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`Missing ${selector} in ${file}`);
  return css.slice(at, css.indexOf("}", at));
}

/** The text of the first `@media (query)` block in `css`, to its end. */
function media(css: string, query: string) {
  const at = css.indexOf(`@media ${query} {`);
  if (at < 0) throw new Error(`Missing @media ${query}`);
  return css.slice(at, css.indexOf("\n}\n", at));
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** `color-mix(in srgb, top share%, bottom)` for opaque hex colours. */
function mix(top: string, share: number, bottom: string) {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `#${[1, 3, 5]
    .map((i) =>
      Math.round(channel(top, i) * share + channel(bottom, i) * (1 - share))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.className = "";
});

describe("controls stay visible with Increase contrast and Reduce transparency", () => {
  it("gives every filled control an edge that only Increase contrast draws", () => {
    expect(rule("src/macos-theme.css", ".personal-shell")).toContain(
      "--aven-control-edge: transparent;",
    );
    expect(media(theme, "(prefers-contrast: more)")).toContain(
      "--aven-control-edge: var(--aven-control-border);",
    );
    for (const [file, selector] of [
      ["src/surfaces/SettingsControls.css", ".settings-button"],
      ["src/surfaces/SettingsControls.css", ".settings-segmented"],
      ["src/surfaces/BrowserPane.css", ".browser-address"],
      [
        "src/chrome/Overlays.css",
        '.modal-panel[role="dialog"] :is(input, textarea, select)',
      ],
      ["src/surfaces/SettingsView.css", ".settings-search-field"],
      ["src/chrome/SettingsRail.css", ".settings-nav__search"],
      ["src/chrome/TeamCard.css", ".team-card-button"],
      ["src/surfaces/SessionRunStatus.css", ".session-run-stop"],
      [
        "src/chrome/BotSettingsSheet.css",
        '.modal-panel[role="dialog"] .bot-sheet-title-field:focus',
      ],
      ["src/surfaces/WorkspaceHome.css", ".workspace-home-actions button"],
    ])
      expect(rule(file, selector)).toContain("var(--aven-control-edge");
  });

  it("keeps controls and fields a step off the page when made solid", () => {
    const solid = media(
      theme,
      "(prefers-reduced-transparency: reduce), (prefers-contrast: more)",
    );
    // In light mode the control and field solids are the page's own white.
    expect(solid).toContain("--aven-control-bg: var(--aven-elevated-2);");
    expect(solid).toContain("--aven-field-bg: var(--aven-elevated-2);");
  });

  it("makes the inset panels solid in light mode as well as dark", () => {
    const shell = read("src/personal-shell.css");
    const solid = media(
      shell,
      "(prefers-reduced-transparency: reduce), (prefers-contrast: more)",
    );
    expect(solid).toContain(
      "html.theme-light .personal-shell[data-unified-toolbar]",
    );
  });

  it("draws card and overlay edges at full strength under Increase contrast", () => {
    const more = media(theme, "(prefers-contrast: more)");
    expect(more).toContain("--aven-glass-card-edge: var(--aven-line);");
    expect(more).toContain("--aven-glass-overlay-edge: var(--aven-line);");
  });
});

describe("text on an accent fill", () => {
  it("is black or white, whichever reads on the workspace's accent", () => {
    const foreground = () =>
      document.documentElement.style.getPropertyValue(
        "--theme-accent-foreground",
      );
    applyThemeColors({ dark: { accent: "#1e3a8a" } });
    expect(foreground()).toBe("#ffffff");
    applyThemeColors({ dark: { accent: "#ffd60a" } });
    expect(foreground()).toBe("#000000");
    applyThemeColors({});
    expect(foreground()).toBe("");
  });

  it("is what the accent-filled buttons use", () => {
    expect(theme).toMatch(
      /--aven-on-accent: var\(\s*--theme-accent-foreground,\s*var\(--color-background-base\)\s*\);/,
    );
    for (const [file, selector] of [
      [
        "src/surfaces/WorkspaceHome.css",
        ".workspace-home-actions .workspace-home-new",
      ],
    ])
      expect(rule(file, selector)).toContain("color: var(--aven-on-accent");
  });
});

describe("status text in light mode", () => {
  const white = "#ffffff";
  const grouped = mix("#000000", 0.035, white);

  it("reads lines added at 4.5:1 on white and on the grouped background", () => {
    expect(read("src/index.css")).toContain("--aven-git-add: #1a7f37;");
    expect(contrast("#1a7f37", white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#1a7f37", grouped)).toBeGreaterThanOrEqual(4.5);
    // Passing checks share the one green rather than a copy of their own.
    expect(rule("src/chrome/GitChangesPanel.css", ".git-changes")).toContain(
      "--git-ok: var(--aven-git-add);",
    );
    expect(rule("src/chrome/ShipFlow.css", ".ship-flow")).toContain(
      "--ship-ok: var(--aven-git-add);",
    );
  });

  it("reads Needs you at 4.5:1 on white and on its button's wash", () => {
    expect(read("src/index.css")).toMatch(
      /--aven-needs-you: color-mix\(\s*in srgb,\s*var\(--color-content\) 45%,/,
    );
    const needsYou = mix("#000000", 0.45, "#ff9500");
    expect(contrast(needsYou, white)).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(needsYou, mix("#ff9500", 0.22, white)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("reads the danger button at 4.5:1 on its wash", () => {
    // Light mode's destructive words take the deeper red, for every
    // destructive button, menu row and error.
    expect(
      rule("src/macos-theme.css", "html.theme-light .personal-shell"),
    ).toMatch(
      /--aven-danger-text: color-mix\(\s*in srgb,\s*var\(--color-content\) 15%,\s*var\(--color-red-600, #d70015\)\s*\);/,
    );
    expect(
      rule("src/surfaces/SettingsControls.css", ".settings-button-danger"),
    ).toContain("color: var(--aven-danger-text);");
    const text = mix("#000000", 0.15, "#d70015");
    expect(contrast(text, mix("#ff3b30", 0.2, white))).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});

describe("switches, focus and hit targets", () => {
  it("rings the switch track, more strongly under Increase contrast", () => {
    const css = read("src/surfaces/SettingsControls.css");
    expect(
      rule("src/surfaces/SettingsControls.css", ".settings-toggle-track"),
    ).toContain("box-shadow: inset 0 0 0 1px var(--settings-toggle-ring);");
    expect(media(css, "(prefers-contrast: more)")).toContain(
      "--settings-toggle-ring: var(--aven-control-border);",
    );
  });

  it("shows typing in the message box with a neutral lift, and the focus ring with Increase Contrast", () => {
    const typing = rule(
      "src/chrome/Composer.css",
      ".personal-shell .personal-composer [data-composer-box]:focus-within",
    );
    expect(typing).toContain(
      "border-color: color-mix(in srgb, var(--color-content) 24%, transparent);",
    );
    expect(typing).not.toContain("accent");
    expect(
      media(read("src/chrome/Composer.css"), "(prefers-contrast: more)"),
    ).toContain("border-color: var(--aven-focus-ring);");
    expect(
      rule("src/chrome/SettingsRail.css", ".settings-nav__search:focus-within"),
    ).toContain("var(--aven-field-focus)");
  });

  it("keeps the library tiles and the side panel's tabs at a 28px target", () => {
    expect(
      rule(
        "src/chrome/PersonalNavigation.css",
        ".personal-shell .personal-library-nav > :is(button, span)",
      ),
    ).toContain("min-height: 28px;");
    expect(
      rule("src/chrome/WorkspaceInspector.css", ".workspace-inspector-tab"),
    ).toContain("min-height: 28px;");
  });

  it("draws every segmented control's thumb from one token pair", () => {
    for (const [file, selector] of [
      [
        "src/surfaces/SettingsControls.css",
        '.settings-segmented button[aria-checked="true"]',
      ],
      ["src/chrome/AgentPill.css", '.agent-segment[aria-checked="true"]'],
      [
        "src/chrome/WorkspaceInspector.css",
        '.workspace-inspector-tab[aria-selected="true"]',
      ],
      [
        "src/chrome/ShipFlow.css",
        '.ship-flow-modes > button[aria-checked="true"]',
      ],
    ]) {
      const body = rule(file, selector);
      expect(body).toContain("background: var(--aven-thumb);");
      expect(body).toContain("box-shadow: var(--aven-thumb-shadow);");
      expect(read(file)).not.toMatch(
        /html\.theme-light [^{]*(aria-checked|aria-selected)="true"\]/,
      );
    }
  });
});
