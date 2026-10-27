import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * What the sidebar shows at rest and what waits for the pointer or the
 * keyboard. Rows are their mark and name at rest; actions take no room until
 * the row is hovered, holds keyboard focus or has its menu open, and they are
 * only faded and narrowed, never removed, so Tab still reaches them. Status
 * that needs the person (waiting, unread) never hides.
 */
type Rule = { selectors: string[]; body: Map<string, string> };

/** Every style rule in a stylesheet, nested @media rules included. */
function rules(file: string): Rule[] {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const found: Rule[] = [];
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = splitSelectors(selector.trim().replace(/\s+/g, " "));
    const declarations = new Map<string, string>();
    for (const part of body.split(";")) {
      const at = part.indexOf(":");
      if (at < 0) continue;
      declarations.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
    }
    found.push({ selectors, body: declarations });
  }
  return found;
}

/** Splits a selector list on its top-level commas only. */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out;
}

/**
 * What every rule listing exactly this selector declares, later rules
 * winning, as the cascade would for that one selector.
 */
function ruleFor(all: Rule[], selector: string) {
  const matches = all.filter((rule) => rule.selectors.includes(selector));
  if (!matches.length) throw new Error(`No rule for ${selector}`);
  return new Map(matches.flatMap((rule) => [...rule.body]));
}

/** Rules whose selector names `target` (in its last compound) and `state`. */
function rulesNaming(all: Rule[], target: string, state: string) {
  return all.filter((rule) =>
    rule.selectors.some(
      (selector) =>
        selector.includes(state) && lastCompound(selector).includes(target),
    ),
  );
}

function lastCompound(selector: string) {
  // The subject: what follows the last descendant space outside parentheses.
  let depth = 0;
  let at = 0;
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === "(") depth++;
    else if (selector[i] === ")") depth--;
    else if (selector[i] === " " && depth === 0) at = i + 1;
  }
  return selector.slice(at);
}

const NAV = "src/chrome/PersonalNavigation.css";
const nav = rules(NAV);
const ROW = ".personal-shell .personal-navigation";

describe("project rows at rest and on hover", () => {
  it("keeps every row action laid out but narrowed and faded at rest, so Tab still reaches it", () => {
    const rest = ruleFor(nav, `${ROW} .personal-project-row-action`);
    expect(rest.get("width")).toBe("0");
    expect(rest.get("opacity")).toBe("0");
    expect(rest.get("pointer-events")).toBe("none");
    expect(rest.get("overflow")).toBe("hidden");
    // Not display: none or visibility: hidden, which would drop them from
    // the Tab order.
    expect(rest.get("display")).toBe("grid");
    expect(rest.has("visibility")).toBe(false);
    for (const rule of nav)
      if (
        rule.selectors.some((selector) =>
          lastCompound(selector).includes("personal-project-row-action"),
        )
      ) {
        expect(rule.body.get("display")).not.toBe("none");
        expect(rule.body.get("visibility")).not.toBe("hidden");
      }
  });

  it("shows the actions on hover, on keyboard focus anywhere in the row and while ··· is open", () => {
    const reveal = nav.find((rule) =>
      rule.selectors.some(
        (selector) =>
          selector.includes(":hover") &&
          selector.includes(":focus-within") &&
          selector.includes('.personal-project-more[aria-expanded="true"]') &&
          selector.endsWith(".personal-project-row-action"),
      ),
    );
    expect(reveal).toBeDefined();
    expect(reveal!.body.get("width")).toBe("24px");
    expect(reveal!.body.get("opacity")).toBe("1");
    expect(reveal!.body.get("pointer-events")).toBe("auto");
    // An open project keeps its fold chevron at rest: it says it is open.
    expect(reveal!.selectors).toContain(
      `${ROW} .personal-project-disclosure[aria-expanded="true"]`,
    );
  });

  it("keeps the waiting dot and the unread count at rest, small and grey or amber", () => {
    for (const target of [
      ".personal-project-waiting",
      ".personal-project-unread",
    ])
      for (const rule of nav)
        if (
          rule.selectors.some((selector) =>
            lastCompound(selector).includes(target),
          )
        ) {
          expect(rule.body.get("display")).not.toBe("none");
          expect(rule.body.get("opacity")).not.toBe("0");
          expect(rule.body.get("visibility")).not.toBe("hidden");
        }
    expect(
      ruleFor(nav, `${ROW} .personal-project-waiting`).get("background"),
    ).toBe("var(--color-amber-400)");
    const unread = ruleFor(nav, `${ROW} .personal-project-unread`);
    expect(unread.get("height")).toBe("16px");
    expect(unread.get("color")).toBe("var(--aven-label-secondary)");
    expect(unread.get("background")).toBe("var(--aven-fill-tertiary)");
  });

  it("moves changed files and a memory update behind hover and focus", () => {
    expect(ruleFor(nav, `${ROW} .personal-project-files`).get("display")).toBe(
      "none",
    );
    expect(ruleFor(nav, `${ROW} .personal-project-memory`).get("display")).toBe(
      "none",
    );
    for (const target of [
      ".personal-project-files",
      ".personal-project-memory",
    ]) {
      const shown = rulesNaming(nav, target, ":is(:hover, :focus-within)");
      expect(shown.length, target).toBeGreaterThan(0);
      expect(shown.some((rule) => rule.body.get("display") !== "none")).toBe(
        true,
      );
    }
  });
});

describe("one grid for every sidebar row", () => {
  it("draws library, project, chat and workspace rows 28px high with a 16px mark column", () => {
    expect(
      ruleFor(
        nav,
        ".personal-shell .personal-library-nav > :is(button, span)",
      ).get("height"),
    ).toBe("28px");
    expect(
      ruleFor(nav, ".personal-shell .personal-library-icon").get("width"),
    ).toBe("16px");
    expect(ruleFor(nav, `${ROW} .personal-project-open`).get("height")).toBe(
      "28px",
    );
    expect(ruleFor(nav, `${ROW} .personal-project-symbol`).get("width")).toBe(
      "16px",
    );
    expect(ruleFor(nav, `${ROW} .personal-task-card`).get("min-height")).toBe(
      "28px",
    );
    expect(ruleFor(nav, `${ROW} .personal-task-lead`).get("width")).toBe(
      "16px",
    );
    expect(
      ruleFor(nav, ".personal-shell .personal-profile-name").get("height"),
    ).toBe("28px");
    expect(
      ruleFor(nav, `${ROW} .personal-projects-heading`).get("height"),
    ).toBe("28px");
  });

  it("starts every label 8px + 16px + 8px in, so names line up down the sidebar", () => {
    // Padding, then the 16px mark, then the gap: library, workspace,
    // project and chat rows all put their text at 32px.
    const library = ruleFor(
      nav,
      ".personal-shell .personal-library-nav > :is(button, span)",
    );
    expect(library.get("padding")).toBe("0 8px");
    expect(library.get("gap")).toBe("8px");
    const name = ruleFor(nav, ".personal-shell .personal-profile-name");
    expect(name.get("padding-inline")).toBe("8px");
    expect(name.get("gap")).toBe("8px");
    const project = ruleFor(nav, `${ROW} .personal-project-open`);
    expect(project.get("padding")).toBe("0 8px");
    expect(project.get("gap")).toBe("8px");
    expect(ruleFor(nav, `${ROW} .personal-task-card`).get("padding")).toBe(
      "5px 8px",
    );
    expect(ruleFor(nav, `${ROW} .personal-other-task`).get("gap")).toBe("8px");
    // Quiet lines under a project start with the chat titles.
    expect(ruleFor(nav, `${ROW} .personal-tasks-empty`).get("padding")).toBe(
      "4px 8px 4px 32px",
    );
  });
});

describe("the workspace row and section headings", () => {
  it("keeps New chat at rest and shows the workspace menu's chevron on hover or focus", () => {
    expect(
      ruleFor(nav, ".personal-shell .personal-profile-picker").get("opacity"),
    ).toBe("0");
    const shown = nav.find((rule) =>
      rule.selectors.some(
        (selector) =>
          selector.includes(
            ".personal-profile-header:is(:hover, :focus-within)",
          ) && selector.endsWith(".personal-profile-picker"),
      ),
    );
    expect(shown?.body.get("opacity")).toBe("1");
    expect(
      ruleFor(nav, ".personal-shell .personal-profile-new").has("opacity"),
    ).toBe(false);
  });

  it("keeps the section headings quiet, their buttons on hover or focus", () => {
    const heading = ruleFor(nav, `${ROW} .personal-projects-heading`);
    expect(heading.get("color")).toBe("var(--aven-label-secondary)");
    expect(heading.get("font-weight")).toBe("500");
    expect(heading.get("font-size")).toBe("var(--text-ui-caption)");
    expect(
      ruleFor(nav, ".personal-shell .personal-projects-heading > button").get(
        "opacity",
      ),
    ).toBe("0");
    expect(
      ruleFor(
        nav,
        ".personal-shell .personal-projects-heading:focus-within > button",
      ).get("opacity"),
    ).toBe("1");
  });
});

describe("the footer", () => {
  it("keeps Settings, Add project and the workspaces at rest, New workspace on hover or focus", () => {
    expect(ruleFor(nav, `${ROW} .personal-workspace-add`).get("opacity")).toBe(
      "0",
    );
    const shown = nav.find((rule) =>
      rule.selectors.some(
        (selector) =>
          selector.includes(
            ".personal-workspace-switcher:is(:hover, :focus-within)",
          ) && selector.endsWith(".personal-workspace-add"),
      ),
    );
    expect(shown?.body.get("opacity")).toBe("1");
    expect(ruleFor(nav, `${ROW} .personal-workspace-tool`).has("opacity")).toBe(
      false,
    );
  });
});

describe("Home's project cards", () => {
  const home = rules("src/surfaces/WorkspaceHome.css");
  it("show their tools only on hover, keyboard focus or an open menu", () => {
    expect(ruleFor(home, ".workspace-home-agent-tools").get("opacity")).toBe(
      "0",
    );
    const shown = ruleFor(
      home,
      ".workspace-home-agent:is(:hover, :focus-within) .workspace-home-agent-tools",
    );
    expect(shown.get("opacity")).toBe("1");
    expect(
      ruleFor(
        home,
        '.workspace-home-agent-tools:has([aria-expanded="true"])',
      ).get("opacity"),
    ).toBe("1");
  });
});

describe("the toolbar's strip", () => {
  const bar = rules("src/chrome/WorkspaceStatusBar.css");
  const extras = ":is(.personal-title-browser-new, .personal-title-board-open)";
  it("keeps New chat at rest and shows New browser and Open board on hover, focus or the tour", () => {
    expect(ruleFor(bar, `.workspace-status-bar ${extras}`).get("opacity")).toBe(
      "0",
    );
    const shown = ruleFor(
      bar,
      `.workspace-status-bar:is(:hover, :focus-within) ${extras}`,
    );
    expect(shown.get("opacity")).toBe("1");
    expect(
      bar.some((rule) =>
        rule.selectors.includes(
          `html:has(.aven-tour) .workspace-status-bar ${extras}`,
        ),
      ),
    ).toBe(true);
    // New chat is never faded.
    expect(
      bar.some((rule) =>
        rule.selectors.some((selector) =>
          selector.includes("personal-title-session-new"),
        ),
      ),
    ).toBe(false);
  });
});
