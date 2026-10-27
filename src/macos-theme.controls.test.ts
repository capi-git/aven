import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Shared controls: one field, one mini switch, one focus ring and one grey
 * button fill, wherever a component draws them with utility classes.
 */
const read = (file: string) => readFileSync(file, "utf8");
const theme = read("src/macos-theme.css");

const tracked = (pattern: string) =>
  execFileSync("git", ["ls-files", pattern], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
const sources = tracked("src/*.tsx").filter((file) => !file.includes(".test."));

function rule(css: string, selector: string) {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`Missing ${selector}`);
  return css.slice(at, css.indexOf("}", at));
}

/** Every class string in the source files, with where it is. */
function classStrings() {
  return sources.flatMap((file) =>
    [...read(file).matchAll(/(?:className=|=\s*)(["`])([^"`]*?)\1/g)].map(
      (match) => ({ file, classes: match[2] }),
    ),
  );
}

describe("shared controls", () => {
  it("draws focus with the shared ring, never a raw accent ring", () => {
    const raw = classStrings()
      .filter(({ classes }) => /\bring-accent\b/.test(classes))
      .map(({ file, classes }) => `${file}: ${classes}`);
    expect(raw).toEqual([]);
  });

  it("fills grey buttons from the control steps, not ad-hoc greys", () => {
    const adHoc = classStrings()
      .filter(
        ({ classes }) =>
          /(?<![:\w/-])bg-content\/(8|10|12)\b/.test(classes) &&
          /hover:bg-content\/(12|15|18|20)\b/.test(classes),
      )
      .map(({ file, classes }) => `${file}: ${classes}`);
    expect(adHoc).toEqual([]);
  });

  it("gives compact panels one mini switch, white-knobbed on the accent", () => {
    const track = rule(theme, ".aven-switch-mini");
    expect(track).toContain("border-radius: var(--aven-radius-capsule);");
    expect(track).toContain("background: var(--aven-fill);");
    expect(rule(theme, ".aven-switch-mini::after")).toContain(
      "background: #fff;",
    );
    expect(rule(theme, '[aria-checked="true"] > .aven-switch-mini')).toContain(
      "background: var(--color-accent);",
    );
    for (const file of [
      "src/chrome/ModelSettings.tsx",
      "src/chrome/MemoryKeeper.tsx",
    ])
      expect(read(file)).toContain('className="aven-switch-mini"');
  });

  it("lights a popover's top edge as a panel menu's is lit", () => {
    expect(
      rule(
        read("src/chrome/Overlays.css"),
        ".aven-popover-frame .popover-backdrop",
      ),
    ).toContain("box-shadow: var(--aven-specular);");
    expect(read("src/chrome/ToolbarPanel.css")).toContain(
      "box-shadow: var(--aven-specular, none);",
    );
  });

  it("lifts buttons and rows by the shared steps, not literal greys", () => {
    // Pane headers and toolbars are being rebuilt in their own work.
    const toolbars = new Set([
      "src/chrome/TitleBar.css",
      "src/chrome/WorkspaceStatusBar.css",
      "src/chrome/WorkspaceFooter.css",
      "src/chrome/FooterUsage.css",
      "src/surfaces/BrowserPane.css",
      "src/surfaces/DetachedWorkspace.css",
      "src/surfaces/IosSimulatorPane.css",
      "src/surfaces/PdfViewer.css",
      "src/surfaces/WorkspaceStage.css",
    ]);
    const literal: string[] = [];
    for (const file of tracked("src/*.css").filter((f) => !toolbars.has(f))) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
      for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/:hover|:active/.test(selector)) continue;
        if (
          /background(?:-color)?:\s*color-mix\(\s*in srgb,\s*(?:var\(--color-content\)|currentColor)\s*[\d.]+%,\s*transparent\s*\)/.test(
            body,
          )
        )
          literal.push(`${file}: ${selector.trim()}`);
      }
    }
    expect(literal).toEqual([]);
    expect(theme).toMatch(
      /--aven-inverse-hover: color-mix\(\s*in srgb,\s*var\(--color-content\) 88%,\s*transparent\s*\);/,
    );
  });

  it("lifts list rows by the shared row fills", () => {
    // Tabs are being rebuilt with the pane headers.
    const rows = classStrings()
      .filter(({ file }) => file !== "src/chrome/SurfaceTabs.tsx")
      .filter(({ classes }) =>
        /(?<![\w:/-])hover:bg-content\/5\b/.test(classes),
      )
      .map(({ file, classes }) => `${file}: ${classes}`);
    expect(rows).toEqual([]);
  });

  it("draws every destructive button and warning in the one danger red", () => {
    const adHoc = classStrings()
      .filter(({ classes }) =>
        /\bbg-red-\d+\/\d+|text-red-600 dark:text-red-400|\btext-red-300\b/.test(
          classes,
        ),
      )
      .map(({ file, classes }) => `${file}: ${classes}`);
    expect(adHoc).toEqual([]);
    for (const token of [
      "--aven-danger-text",
      "--aven-danger-fill",
      "--aven-danger-fill-hover",
    ])
      expect(theme).toContain(`${token}:`);
  });

  it("gives every inverted default button one hover", () => {
    const adHoc = classStrings()
      .filter(({ classes }) =>
        /\bbg-content\b[^]*text-background-base/.test(classes),
      )
      .filter(({ classes }) =>
        /hover:(?:bg-content\/\d+|opacity-\d+)/.test(classes),
      )
      .map(({ file, classes }) => `${file}: ${classes}`);
    expect(adHoc).toEqual([]);
  });

  it("gives a bare `rounded` the control corner", () => {
    expect(read("src/index.css")).toContain("--radius: 6px;");
    expect(theme).toContain("--aven-radius-sm: 6px;");
  });
});
