import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { transform } from "lightningcss";
import { describe, expect, it } from "vitest";

/**
 * WebKit finds the rules a pointer or focus move can change by the class, id
 * or tag beside the state in the same compound. A bare `:hover` or
 * `:focus-within` inside `:is()` or `:not()`, before a descendant, has none:
 * then every element whose state changes checks the rule against everything
 * under it. Focusing the message box changes `:focus-within` on all its
 * ancestors, so one such rule made each chat switch walk the whole page
 * (a full extra style pass). Write `:is(.row:hover, .row:focus-within) .x`,
 * not `.row:is(:hover, :focus-within) .x`. See docs/PERFORMANCE.md.
 */
const STATES = new Set([
  "hover",
  "focus",
  "focus-within",
  "focus-visible",
  "active",
]);
const NESTED = new Set(["is", "not", "where", "any", "matches"]);

type Component = {
  type: string;
  kind?: string;
  value?: string;
  name?: string;
  selectors?: Component[][];
};

/** States in a compound before a combinator with no class, id or tag beside them. */
function unkeyed(selector: Component[], ancestor = false): string[] {
  const compounds: Component[][] = [[]];
  for (const part of selector)
    if (part.type === "combinator") compounds.push([]);
    else compounds[compounds.length - 1].push(part);
  return compounds.flatMap((compound, index) => {
    const before = ancestor || index < compounds.length - 1;
    const keyed = compound.some((part) =>
      ["class", "id", "type"].includes(part.type),
    );
    return compound.flatMap((part) => {
      if (part.type !== "pseudo-class" || !part.kind) return [];
      if (STATES.has(part.kind) && before && !keyed) return [`:${part.kind}`];
      if (NESTED.has(part.kind) && part.selectors)
        return part.selectors.flatMap((inner) => unkeyed(inner, before));
      return [];
    });
  });
}

/** Stylesheets still awaiting the rewrite; none today. */
const PENDING = new Set<string>();

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

describe("pointer and focus rules", () => {
  it("name a class, id or tag beside each state, so WebKit can key them", () => {
    const found: string[] = [];
    for (const file of stylesheets("src")) {
      if (PENDING.has(file)) continue;
      // Tailwind's own directives are not plain CSS; its variants are
      // checked below.
      const code = readFileSync(file, "utf8").replace(
        /^@(import|source|custom-variant|theme|utility|plugin|apply)[^;{]*;/gm,
        "",
      );
      transform({
        filename: file,
        code: Buffer.from(code),
        errorRecovery: true,
        visitor: {
          Rule: {
            style(rule) {
              for (const selector of rule.value.selectors) {
                const states = unkeyed(selector as Component[]);
                if (states.length)
                  found.push(
                    `${file}:${rule.value.loc.line + 1} ${states.join(" ")}`,
                  );
              }
              return undefined;
            },
          },
        },
      });
    }
    expect(found).toEqual([]);
  });

  it("replace Tailwind's group variants, which hide the group's class", () => {
    const css = readFileSync("src/index.css", "utf8");
    for (const state of ["hover", "focus-within", "focus-visible"])
      expect(css).toMatch(new RegExp(`&:where\\(\\.group:${state} \\*\\)`));
    // Tailwind's named groups (`group-hover/name`) keep the flaw.
    const named: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
          if (/group-[a-z-]+\/[a-z]/.test(readFileSync(path, "utf8")))
            named.push(path);
      }
    };
    walk("src");
    expect(named).toEqual([]);
  });
});
