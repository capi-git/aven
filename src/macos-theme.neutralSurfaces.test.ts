import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Surfaces are grey. The accent fills primary controls (Send, a switch that
 * is on, a slider's fill) and draws keyboard focus; colour otherwise stays on
 * small things that mean something: status words, diff and Git letters,
 * provider marks and critters. These checks keep accent washes, glows and
 * borders from creeping back onto rows, cards and drop hints.
 */
/** Tracked files under src; git's `*` also crosses folders. */
const tracked = (pattern: string) =>
  execFileSync("git", ["ls-files", pattern], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

const ACCENT =
  "--(?:color-accent|personal-accent|personal-highlight|toolbar-panel-accent|agent-pill-accent)";
/** A partial accent mix into nothing or into glass: a wash, glow or edge. */
const ACCENT_WASH = new RegExp(
  // The accent may carry a nested fallback: var(--personal-accent, var(...)).
  `color-mix\\(\\s*in srgb,\\s*var\\(${ACCENT}(?:[^()]|\\([^()]*\\))*\\)\\s*\\d+%,\\s*(?:transparent|var\\(\\s*--(?:aven-glass|composer-glass))`,
);
const SURFACE_PROPERTY =
  /^\s*(background(?:-color)?|border(?:-[a-z]+)*|box-shadow)\s*:/;

/** Every declaration on a surface property, with its rule's selector. */
function surfaceDeclarations(file: string) {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const found: { selector: string; declaration: string }[] = [];
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const declaration of body.split(";")) {
      if (SURFACE_PROPERTY.test(declaration))
        found.push({
          selector: selector.trim(),
          declaration: declaration.trim(),
        });
    }
  }
  return found;
}

describe("neutral surfaces", () => {
  it("washes no row, card, glow or edge in the accent", () => {
    const washes = tracked("src/*.css").flatMap((file) =>
      surfaceDeclarations(file)
        // Keyboard focus may keep the accent ring.
        .filter(({ selector }) => !/:focus/.test(selector))
        .filter(({ declaration }) => ACCENT_WASH.test(declaration))
        .map(
          ({ selector, declaration }) =>
            `${file}: ${selector} → ${declaration}`,
        ),
    );
    expect(washes).toEqual([]);
  });

  it("selects rows in grey", () => {
    const root = readFileSync("src/index.css", "utf8");
    const shell = readFileSync("src/personal-shell.css", "utf8");
    expect(root).toContain(
      "--aven-selected: color-mix(in srgb, var(--color-content) 10%, transparent);",
    );
    expect(shell).toMatch(
      /--personal-selected: color-mix\(\s*in srgb,\s*var\(--color-content\) 10%,\s*transparent\s*\);/,
    );
  });

  it("keeps accent tints out of component class names", () => {
    const tinted = tracked("src/*.tsx")
      .filter((file) => !file.includes(".test."))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .map((line, index) => ({ line, at: `${file}:${index + 1}` })),
      )
      .filter(({ line }) =>
        /\b(?:bg-accent\/\d+|border-accent\/\d+|bg-teal-|bg-sky-|bg-cyan-|bg-blue-)/.test(
          line,
        ),
      )
      // Search matches are marked in the accent, as text selection is.
      .filter(
        ({ line }) =>
          !line.includes('<mark className="rounded-sm bg-accent/35'),
      )
      .map(({ at, line }) => `${at}: ${line.trim()}`);
    expect(tinted).toEqual([]);
  });
});
