import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createSkillLabel, SkillPicker } from "./SkillPicker";
import { ompCommandsFromRpcData } from "../lib/harness/piSkills";
import { PLAN_COMMAND } from "../lib/plan";
import { COMPACT_COMMAND } from "../lib/compact";
import { rankSkillMatches, type Skill, type SkillMatch } from "../lib/skills";

const unranked = (skills: Skill[]): SkillMatch[] =>
  skills.map((skill) => ({ skill, positions: [], descriptionPositions: [] }));

function render(props: {
  skills: SkillMatch[];
  query: string;
  active: number;
}): string {
  return renderToStaticMarkup(
    createElement(SkillPicker, {
      ...props,
      creating: false,
      cwd: "/repo",
      onActive: vi.fn(),
      onPick: vi.fn(),
      onStartCreate: vi.fn(),
      onStartAdd: vi.fn(),
      onCancelCreate: vi.fn(),
      onCreate: vi.fn(),
    }),
  );
}

describe("native command picker", () => {
  it("renders native commands and argument hints alongside Aven shortcuts", () => {
    const native: Skill[] = ompCommandsFromRpcData({
      commands: [
        { name: "plan", source: "builtin", description: "OMP planning" },
        {
          name: "compact",
          source: "builtin",
          input: { hint: "[instructions]" },
        },
        {
          name: "workflow",
          source: "custom",
          description: "Choose planners and reviewers",
          input: { hint: "<reviewer> [path]" },
        },
        {
          name: "mcp",
          source: "builtin",
          subcommands: [{ name: "list", usage: "list --all" }],
        },
      ],
    }).map((command) => ({ ...command, kind: "native" }));
    const html = render({
      skills: unranked([PLAN_COMMAND, COMPACT_COMMAND, ...native]),
      query: "",
      active: 0,
    });
    expect(html).toContain("/omp:plan");
    expect(html).toContain("/omp:compact");
    expect(html).toContain("/plan");
    expect(html).toContain("/compact");
    expect(html).toContain("/workflow");
    expect(html).toContain("Choose planners and reviewers");
    expect(html).toContain("&lt;reviewer&gt; [path]");
    expect(html).toContain("omp · custom");
    expect(html).toContain("list --all");
  });
});

describe("skill picker rows", () => {
  const review: Skill = {
    kind: "file",
    name: "review-pr",
    description: "Review pull requests.",
    invocation: "review-pr",
    path: "/repo/.agents/skills/review-pr/SKILL.md",
    scope: "project",
    source: "agents",
  };

  it("accents the characters the query matched", () => {
    const html = render({
      skills: rankSkillMatches([review], "rpr"),
      query: "rpr",
      active: 0,
    });
    expect(html).toContain('<span class="text-accent">r</span>');
    expect(html).toContain('<span class="text-accent">pr</span>');
  });

  it("ends the list with a create row the keyboard can highlight", () => {
    const idle = render({
      skills: unranked([review]),
      query: "tidy",
      active: 0,
    });
    expect(idle).toContain("Create skill &quot;tidy&quot;");
    expect(idle.match(/aria-selected="true"/g)).toHaveLength(1);
    const create = render({
      skills: unranked([review]),
      query: "tidy",
      active: 1,
    });
    expect(create).toMatch(
      /aria-selected="true"[^>]*>(?:(?!<\/button>).)*Create skill/,
    );
  });

  it("closes with an Add a skill row after Create skill", () => {
    const idle = render({ skills: unranked([review]), query: "", active: 0 });
    expect(idle.indexOf("New skill")).toBeLessThan(
      idle.indexOf("Add a skill…"),
    );
    expect(idle).toContain("GitHub or skills.sh");
    const add = render({ skills: unranked([review]), query: "", active: 2 });
    expect(add.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(add).toMatch(
      /aria-selected="true"[^>]*>(?:(?!<\/button>).)*Add a skill…/,
    );
  });

  it("highlights nothing when no skill matches, so Enter can send", () => {
    const html = render({ skills: [], query: "tmp", active: -1 });
    expect(html).toContain("No matching commands or skills");
    expect(html).not.toContain('aria-selected="true"');
  });

  it("names the skill a create row would make", () => {
    expect(createSkillLabel("")).toBe("New skill");
    expect(createSkillLabel("Tidy Imports")).toBe(
      'Create skill "tidy-imports"',
    );
  });
});
