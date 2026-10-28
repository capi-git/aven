import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Menus, popovers, dialogs and toasts open on the body, outside the shell.
 * The document's own tokens must give them the shell's surface and fills,
 * or every popover reads a step lighter than the menus beside it.
 */
const read = (file: string) => readFileSync(file, "utf8");
const html = read("index.html");
const root = read("src/index.css");
const shell = read("src/personal-shell.css");

/** The body of the first rule whose selector ends with `selector {`. */
function rule(css: string, selector: string) {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`Missing ${selector}`);
  return css.slice(at, css.indexOf("\n}", at));
}

/** `name: value` in a rule body, whitespace collapsed. */
function value(body: string, name: string) {
  const match = new RegExp(`${name}:([^;]+);`).exec(body);
  return match?.[1]
    .replace(/\s+/g, " ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .trim();
}

describe("surfaces on the body", () => {
  it("lets the boot rule follow the workspace palette", () => {
    // The boot rule is unlayered, so it outranks Tailwind's @theme.
    expect(value(rule(html, ":root"), "--color-background-base")).toMatch(
      /^var\(--theme-background-color, hsl\(/,
    );
  });

  it("gives popovers on the body the shell's popup surface", () => {
    expect(value(rule(root, ":root"), "--aven-popup")).toBe(
      "color-mix(in srgb, var(--color-background-base) 87%, var(--color-content))",
    );
    expect(value(rule(shell, ".personal-shell"), "--aven-popup")).toBe(
      "color-mix(in srgb, var(--personal-main-surface) 87%, var(--color-content))",
    );
    // Light: the shell's surface is its frame lifted toward white.
    expect(value(rule(root, "html.theme-light"), "--aven-popup")).toBe(
      "var(--theme-light-surface-color, var(--color-background-base))",
    );
    expect(
      value(rule(shell, "html.theme-light .personal-shell"), "--aven-popup"),
    ).toBe("var(--personal-main-surface)");
  });

  it("uses the shell's hover, line and selected fills", () => {
    const pairs = [
      ["--aven-hover", "--personal-hover"],
      ["--aven-line", "--personal-line"],
      ["--aven-selected", "--personal-selected"],
      ["--aven-muted", "--personal-muted"],
    ];
    for (const [scheme, rootSelector, shellSelector] of [
      ["dark", ":root", ".personal-shell"],
      ["light", "html.theme-light", "html.theme-light .personal-shell"],
    ])
      for (const [ours, theirs] of pairs)
        expect(value(rule(root, rootSelector), ours), `${scheme} ${ours}`).toBe(
          value(rule(shell, shellSelector), theirs),
        );
  });
});
