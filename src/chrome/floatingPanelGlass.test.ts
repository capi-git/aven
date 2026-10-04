import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The rule body for the Mac-only selector that ends with `target`. */
function macRule(file: string, target: string) {
  const css = readFileSync(file, "utf8");
  const rules = css.split(/\n}\n/);
  const rule = rules.find(
    (block) =>
      block.includes("html.is-mac:not(.theme-light)") &&
      block.includes(`${target} {`),
  );
  if (!rule) throw new Error(`Missing Mac rule for ${target} in ${file}`);
  return rule;
}

describe("floating panels on macOS", () => {
  // WebKit drops the CSS blur for a frame whenever the panel's text repaints,
  // letting the transcript behind flash through on hover.
  it.each([
    [
      "src/chrome/PersonalNavigation.css",
      ".personal-sidebar.sidebar-glass.personal-navigation",
      "--personal-navigation",
    ],
    [
      "src/chrome/WorkspaceInspector.css",
      ".workspace-inspector",
      "--personal-inspector",
    ],
  ])(
    "%s skips the second blur and uses a near-opaque tint",
    (file, target, prefix) => {
      const rule = macRule(file, target);
      expect(rule).toContain(`${prefix}-blur: none;`);
      expect(rule).toMatch(
        new RegExp(
          `${prefix}-overlay: color-mix\\(\\s*in srgb,\\s*var\\(--aven-popup\\) 94%`,
        ),
      );
    },
  );
});
