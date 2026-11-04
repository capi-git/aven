// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WebKit finds the rules a hover or focus change could affect by the class, id
 * or tag written in the same compound as the pseudo-class. One written alone
 * inside `:is()` or `:not()`, or beside only an attribute, is filed under
 * "any element". If such a rule then reaches other elements, every hover or
 * focus change walks the subtree of every element it touches: 10 ms a tab
 * switch in the speed test, for one focus move. Write `.row:hover .tools`,
 * `.row:focus-within .tools`, or `:not(:where(.row:hover))`.
 */
const DYNAMIC = new Set([
  "hover",
  "focus-within",
  "focus-visible",
  "focus",
  "active",
]);
const LOGICAL = new Set(["is", "not", "where", "has", "matches"]);

type Compound = {
  text: string;
  keyed: boolean;
  dynamic: string[];
  nested: { name: string; list: Compound[][] }[];
};

function parseSelectorList(
  source: string,
  from = 0,
  inParens = false,
): { list: Compound[][]; end: number } {
  const list: Compound[][] = [];
  let complex: Compound[] = [];
  const fresh = (): Compound => ({
    text: "",
    keyed: false,
    dynamic: [],
    nested: [],
  });
  let compound = fresh();
  const close = () => {
    if (compound.text) complex.push(compound);
    compound = fresh();
  };
  let at = from;
  while (at < source.length) {
    const char = source[at];
    if (char === ")" && inParens) {
      close();
      list.push(complex);
      return { list, end: at + 1 };
    }
    if (char === ",") {
      close();
      list.push(complex);
      complex = [];
      at += 1;
    } else if (/[\s>+~]/.test(char)) {
      close();
      at += 1;
    } else if (char === "[") {
      const end = source.indexOf("]", at) + 1;
      compound.text += source.slice(at, end);
      at = end;
    } else if (char === ":") {
      let end = at + 1;
      if (source[end] === ":") end += 1;
      const nameStart = end;
      while (end < source.length && /[\w-]/.test(source[end])) end += 1;
      const name = source.slice(nameStart, end);
      compound.text += source.slice(at, end);
      if (source[end] === "(") {
        if (LOGICAL.has(name)) {
          const inner = parseSelectorList(source, end + 1, true);
          compound.nested.push({ name, list: inner.list });
          compound.text += `(${source.slice(end + 1, inner.end)}`;
          at = inner.end;
        } else {
          let depth = 1;
          let scan = end + 1;
          while (depth > 0 && scan < source.length) {
            if (source[scan] === "(") depth += 1;
            if (source[scan] === ")") depth -= 1;
            scan += 1;
          }
          compound.text += source.slice(end, scan);
          at = scan;
        }
      } else {
        if (DYNAMIC.has(name)) compound.dynamic.push(name);
        at = end;
      }
    } else if (char === "*") {
      compound.text += char;
      at += 1;
    } else {
      // A class, id or tag: what WebKit can file the rule under.
      let end = at + 1;
      while (end < source.length && /[\w\\-]/.test(source[end])) {
        if (source[end] === "\\") end += 1;
        end += 1;
      }
      compound.text += source.slice(at, end);
      compound.keyed = true;
      at = end;
    }
  }
  close();
  list.push(complex);
  return { list, end: at };
}

/** Pseudo-classes in `selector` filed under "any element" that reach others. */
function unkeyedDynamicPseudos(selector: string): string[] {
  const found: string[] = [];
  const visit = (complex: Compound[], reachesOthers: boolean) => {
    complex.forEach((compound, index) => {
      const reach = reachesOthers || index < complex.length - 1;
      if (compound.dynamic.length && !compound.keyed && reach)
        found.push(...compound.dynamic);
      for (const { name, list } of compound.nested)
        for (const inner of list) visit(inner, reach || name === "has");
    });
  };
  for (const complex of parseSelectorList(selector).list) visit(complex, false);
  return found;
}

function filesUnder(folder: string, suffix: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return filesUnder(path, suffix);
    return path.endsWith(suffix) ? [path] : [];
  });
}

function selectorsIn(css: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...bare.matchAll(/([^{};]+)\{/g)]
    .map((match) => match[1].trim())
    .filter((head) => !head.startsWith("@"));
}

describe("query containers around a lot of content", () => {
  // A query container restyles everything inside it when its size changes:
  // 20 ms per sidebar toggle around the stage and a chat in the speed test.
  it("keeps a chat from being one, and the stage unless a wallpaper needs it", () => {
    const transcript = readFileSync("src/surfaces/AgentTranscript.css", "utf8");
    expect(transcript).not.toMatch(
      /\.agent-transcript \{[^}]*\bcontainer(-type)?:/,
    );
    expect(transcript).not.toMatch(/@container personal-transcript/);
    const stage = readFileSync("src/surfaces/WorkspaceStage.css", "utf8");
    expect(stage).not.toMatch(
      /^\.workspace-stage \{[^}]*\bcontainer(-type)?:/m,
    );
    expect(stage).toMatch(
      /html\.has-chat-background \.workspace-stage,\s*\.workspace-stage:has\([^{]*\{\s*container-type: size;/,
    );
  });
});

describe("hover and focus rules WebKit can find by class", () => {
  it("tells a keyed rule from an unkeyed one", () => {
    for (const unkeyed of [
      ".row:is(:hover, :focus-within) .tools",
      ".row:not(:hover, [data-open]) .tools",
      "[data-strip]:hover > .tabs",
      ".tool:is(:where(.group):hover *)",
      ".box:has(:focus)",
    ])
      expect(unkeyedDynamicPseudos(unkeyed), unkeyed).not.toEqual([]);
    for (const keyed of [
      ".row:hover .tools",
      ".row:focus-within .tools",
      "div[data-strip]:hover > .tabs",
      ".row:not(:where(.row:hover), [data-open]) .tools",
      ".tool:where(.group:hover *)",
      // Only the element itself: nothing else to walk.
      ".outline:not(:hover, :focus-within)",
      ".sash:is(:hover, :active)::after",
    ])
      expect(unkeyedDynamicPseudos(keyed), keyed).toEqual([]);
  });

  it("holds for every stylesheet", () => {
    const offenders = filesUnder("src", ".css").flatMap((file) =>
      selectorsIn(readFileSync(file, "utf8"))
        .filter((selector) => unkeyedDynamicPseudos(selector).length > 0)
        .map((selector) => `${file}: ${selector.replace(/\s+/g, " ")}`),
    );
    expect(offenders).toEqual([]);
  });

  it("holds for Tailwind's variants: its group and has forms hide the class", () => {
    const css = readFileSync("src/index.css", "utf8");
    for (const variant of [
      "group-hover",
      "group-focus-visible",
      "group-focus-within",
    ])
      expect(css).toContain(`@custom-variant ${variant} `);
    const offenders = filesUnder("src", ".tsx").filter((file) =>
      /\b(?:group-(?:hover|focus-visible|focus-within|focus|active)\/|has-(?:hover|focus|focus-within|focus-visible|active):|peer-(?:hover|focus)[\w/-]*:|group-(?:focus|active):)/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
