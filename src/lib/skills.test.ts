vi.mock("./harness/registry", () => ({
  getHarness: (id: string) =>
    id === "pi" || id === "omp"
      ? {
          commands: {
            discover: async () => [],
            rawSlashCommands: id === "omp",
          },
        }
      : undefined,
}));

import { describe, expect, it, vi } from "vitest";
import { PLAN_COMMAND } from "./plan";
import {
  BUILTIN_CREATE_SKILL,
  BUILTIN_COMPUTER_USE_SKILL,
  applySkillsToTurn,
  blankSkillMarkdown,
  injectSkillPrompt,
  isValidSkillName,
  isNativeCommandPrompt,
  mergeCatalog,
  readSkillBody,
  rankSkillMatches,
  rankSkills,
  sameSkillList,
  replaceSlashToken,
  skillNamesInText,
  skillTextParts,
  slashTokenAt,
  slugSkillName,
  type Skill,
} from "./skills";

describe("native command composer behavior", () => {
  it("filters commands by alias and inserts their invocation with arguments intact", () => {
    const workflow: Skill = {
      kind: "native",
      source: "omp",
      name: "orchestrate",
      invocation: "orchestrate",
      description: "Choose agents",
      aliases: ["review"],
    };
    expect(rankSkills([workflow], "review")).toEqual([workflow]);
    const text = "/rev foo";
    expect(
      replaceSlashToken(
        text,
        slashTokenAt(text, 4, true)!,
        workflow.invocation,
      ),
    ).toBe("/orchestrate foo");
    expect(slashTokenAt("/Review_Code", 12, true)?.query).toBe("Review_Code");
    expect(slashTokenAt("/Review_Code", 12)).toBeNull();
  });

  it("only treats leading command tokens as native invocations", () => {
    expect(isNativeCommandPrompt("/workflow foo @README.md", "omp")).toBe(true);
    expect(isNativeCommandPrompt("/omp:plan investigate", "omp")).toBe(true);
    for (const text of [
      "Explain /workflow",
      "> /workflow",
      "/tmp/file.ts",
      "/tmp\\file.ts",
      "hello",
    ]) {
      expect(isNativeCommandPrompt(text, "omp")).toBe(false);
    }
    expect(isNativeCommandPrompt("/review foo", "claude")).toBe(false);
  });
});

const review: Skill = {
  kind: "file",
  name: "review-pr",
  description: "Review pull requests against team standards.",
  invocation: "review-pr",
  path: "/tmp/.agents/skills/review-pr/SKILL.md",
  scope: "project",
  source: "agents",
};

const native: Skill = {
  kind: "file",
  name: "cursor-only",
  description: "Cursor native helper",
  invocation: "cursor-only",
  path: "/tmp/.cursor/skills/cursor-only/SKILL.md",
  scope: "project",
  source: "cursor",
};

const piNative: Skill = {
  kind: "native",
  name: "architect",
  description: "Design before implementation.",
  invocation: "skill:architect",
  source: "pi",
};

const piFile: Skill = {
  kind: "file",
  name: "pi-file",
  description: "A file discovered by the existing scanner.",
  invocation: "pi-file",
  path: "/tmp/.pi/skills/pi-file/SKILL.md",
  scope: "project",
  source: "pi",
};

describe("slashTokenAt", () => {
  it("reads the /token the cursor is in", () => {
    expect(slashTokenAt("/cre", 4)).toEqual({
      start: 0,
      end: 4,
      query: "cre",
    });
    expect(slashTokenAt("please /rev", 11)).toEqual({
      start: 7,
      end: 11,
      query: "rev",
    });
    expect(slashTokenAt("/skill:arch", 11)).toEqual({
      start: 0,
      end: 11,
      query: "skill:arch",
    });
  });

  it("ignores URLs and paths", () => {
    expect(slashTokenAt("https://example.com", 12)).toBeNull();
    expect(slashTokenAt("/Users/me", 4)).toBeNull();
    expect(slashTokenAt("foo/bar", 4)).toBeNull();
  });

  it("closes after a space", () => {
    expect(slashTokenAt("/review-pr now", 14)).toBeNull();
  });
});

describe("replaceSlashToken", () => {
  it("inserts an exact invocation and a trailing space", () => {
    expect(
      replaceSlashToken(
        "/cre",
        { start: 0, end: 4, query: "cre" },
        "create-skill",
      ),
    ).toBe("/create-skill ");
    expect(
      replaceSlashToken(
        "x /r y",
        { start: 2, end: 4, query: "r" },
        "review-pr",
      ),
    ).toBe("x /review-pr y");
    expect(
      replaceSlashToken(
        "/arch",
        { start: 0, end: 5, query: "arch" },
        "skill:architect",
      ),
    ).toBe("/skill:architect ");
  });
});

describe("skillNamesInText", () => {
  it("collects unique /skill tokens", () => {
    expect(skillNamesInText("/create-skill write a deploy skill")).toEqual([
      "create-skill",
    ]);
    expect(skillNamesInText("/review-pr /create-skill /review-pr")).toEqual([
      "review-pr",
      "create-skill",
    ]);
    expect(skillNamesInText("path /tmp/foo")).toEqual([]);
  });
});

describe("skillTextParts", () => {
  const names = new Set(["review-pr", "create-skill", "skill:architect"]);

  it("marks known /skill tokens", () => {
    expect(skillTextParts("/review-pr look at auth", names)).toEqual([
      { text: "/review-pr", skill: true },
      { text: " look at auth", skill: false },
    ]);
  });

  it("marks a known namespaced invocation", () => {
    expect(skillTextParts("/skill:architect inspect this", names)).toEqual([
      { text: "/skill:architect", skill: true },
      { text: " inspect this", skill: false },
    ]);
  });

  it("leaves unknown /tokens as plain text", () => {
    expect(skillTextParts("see /not-a-skill please", names)).toEqual([
      { text: "see /not-a-skill please", skill: false },
    ]);
  });

  it("splits multiple skills", () => {
    expect(skillTextParts("/review-pr then /create-skill", names)).toEqual([
      { text: "/review-pr", skill: true },
      { text: " then ", skill: false },
      { text: "/create-skill", skill: true },
    ]);
  });

  it("ignores skill tokens inside Markdown blockquotes", () => {
    const text = "/review-pr\n> /create-skill\n  > /review-pr";
    expect(slashTokenAt(text, text.indexOf("/create-skill") + 3)).toBeNull();
    expect(skillNamesInText(text)).toEqual(["review-pr"]);
    expect(
      skillTextParts(text, names)
        .filter((part) => part.skill)
        .map((part) => part.text),
    ).toEqual(["/review-pr"]);
  });
});

describe("applySkillsToTurn", () => {
  it("leaves Pi-native skill commands unchanged", async () => {
    await expect(
      applySkillsToTurn("/skill:architect inspect this", {
        harness: "pi",
        cwd: "/repo",
      }),
    ).resolves.toBe("/skill:architect inspect this");
  });
});

describe("injectSkillPrompt", () => {
  it("prefixes invoked skill bodies and keeps the user text", () => {
    const out = injectSkillPrompt("/review-pr look at auth", [review], {
      "review-pr": "# Review\n\nBe strict.",
    });
    expect(out).toContain("## /review-pr");
    expect(out).toContain("Be strict.");
    expect(out).toContain("Skill file: /tmp/.agents/skills/review-pr/SKILL.md");
    expect(out).toContain(
      "Resolve relative resources from this file's directory.",
    );
    expect(out.endsWith("/review-pr look at auth")).toBe(true);
  });

  it("returns the original text when nothing matches", () => {
    expect(injectSkillPrompt("hello", [], {})).toBe("hello");
  });
});

describe("mergeCatalog", () => {
  it("includes usable built-in desktop instructions without requiring an external skill package", async () => {
    expect(mergeCatalog([])).toContainEqual(BUILTIN_COMPUTER_USE_SKILL);
    const body = await readSkillBody(BUILTIN_COMPUTER_USE_SKILL);
    expect(body).toContain('--aven-desktop \'{"action":"status"}\'');
    expect(body).toContain("Settings → Skills & tools → Desktop control");
    expect(body).toContain("Agent actions never trigger permission prompts");
    expect(body).not.toContain("orca skills get");
  });
  it("lets .agents win, then Aven create-skill, then provider skills", () => {
    const catalog = mergeCatalog([
      {
        name: "review-pr",
        description: "from agents",
        path: "/p/.agents/skills/review-pr/SKILL.md",
        scope: "project",
        source: "agents",
      },
      {
        name: "review-pr",
        description: "from claude",
        path: "/p/.claude/skills/review-pr/SKILL.md",
        scope: "project",
        source: "claude",
      },
      {
        name: "create-skill",
        description: "claude native",
        path: "/home/.claude/skills/create-skill/SKILL.md",
        scope: "user",
        source: "claude",
      },
      {
        name: "cursor-only",
        description: "native",
        path: "/p/.cursor/skills/cursor-only/SKILL.md",
        scope: "project",
        source: "cursor",
      },
    ]);
    expect(catalog.find((s) => s.name === "review-pr")?.description).toBe(
      "from agents",
    );
    expect(catalog.find((s) => s.name === "create-skill")).toEqual(
      BUILTIN_CREATE_SKILL,
    );
    expect(catalog.find((s) => s.name === "cursor-only")?.source).toBe(
      "cursor",
    );
  });
});

describe("rankSkills", () => {
  const personal: Skill = {
    kind: "file",
    name: "standup",
    description: "Summarize yesterday's work.",
    invocation: "standup",
    path: "/home/.agents/skills/standup/SKILL.md",
    scope: "user",
    source: "agents",
  };

  it("lists project, then personal skills, then Aven's own for an empty query", () => {
    const ranked = rankSkills(
      [BUILTIN_CREATE_SKILL, personal, PLAN_COMMAND, native, review],
      "",
    );
    expect(ranked.map((s) => s.name)).toEqual([
      "cursor-only",
      "review-pr",
      "standup",
      "create-skill",
      "plan",
    ]);
  });

  it("lists recently used skills first, most recent first", () => {
    const ranked = rankSkillMatches(
      [BUILTIN_CREATE_SKILL, personal, PLAN_COMMAND, native, review],
      "",
      { recent: ["plan", "missing", "standup"] },
    );
    expect(ranked.map((row) => row.skill.name)).toEqual([
      "plan",
      "standup",
      "cursor-only",
      "review-pr",
      "create-skill",
    ]);
  });

  it("puts Aven's own commands after the user's skills unless the query starts their name", () => {
    const pair: Skill = {
      ...personal,
      name: "pairing-notes",
      invocation: "pairing-notes",
    };
    expect(rankSkills([PLAN_COMMAND, pair], "pn")[0]?.name).toBe(
      "pairing-notes",
    );
    expect(rankSkills([PLAN_COMMAND, pair], "pl")[0]?.name).toBe("plan");
  });

  it("lets a recent skill win a near tie", () => {
    const one: Skill = {
      ...personal,
      name: "deploy-a",
      invocation: "deploy-a",
    };
    const two: Skill = {
      ...personal,
      name: "deploy-b",
      invocation: "deploy-b",
    };
    expect(rankSkills([one, two], "dep")[0]?.name).toBe("deploy-a");
    expect(
      rankSkillMatches([one, two], "dep", { recent: ["deploy-b"] })[0]?.skill
        .name,
    ).toBe("deploy-b");
  });

  it("matches descriptions by word, after every name match, and only a few", () => {
    const rows: Skill[] = Array.from({ length: 300 }, (_, index) => ({
      kind: "file",
      name: `skill-${index}`,
      description:
        index % 2
          ? "Prepare a reviewable change for every team."
          : "Rename files to match the convention.",
      invocation: `skill-${index}`,
      path: `/p/.agents/skills/skill-${index}/SKILL.md`,
      scope: "project",
      source: "agents",
    }));
    const ranked = rankSkillMatches([...rows, review], "rev");
    expect(ranked[0]?.skill.name).toBe("review-pr");
    // 150 descriptions have a word starting "rev"; ten are enough to show.
    expect(ranked).toHaveLength(1 + 10);
    expect(ranked.slice(1).every((row) => row.positions.length === 0)).toBe(
      true,
    );
    expect(ranked[1]?.descriptionPositions).toEqual([10, 11, 12]);
  });

  it("does not match a description by scattered letters or a single letter", () => {
    const deploy: Skill = {
      ...personal,
      name: "ship",
      invocation: "ship",
      description: "Run every environment variable check.",
    };
    expect(rankSkills([deploy], "rvc")).toEqual([]);
    expect(rankSkills([deploy], "c")).toEqual([]);
    // Three or more letters may match inside a word.
    expect(rankSkills([deploy], "iron")).toEqual([deploy]);
  });

  it("reports matched characters in the invocation the picker shows", () => {
    expect(rankSkillMatches([review], "rpr")[0]?.positions).toEqual([0, 7, 8]);
    // Pi shows `/skill:architect`; the name starts after the prefix.
    expect(rankSkillMatches([piNative], "arch")[0]?.positions).toEqual([
      6, 7, 8, 9,
    ]);
    expect(rankSkillMatches([piNative], "skill")[0]?.positions).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it("fuzzy-matches names ahead of descriptions", () => {
    const ranked = rankSkills([native, review, BUILTIN_CREATE_SKILL], "rev");
    expect(ranked[0]?.name).toBe("review-pr");
  });

  it("ranks native Pi rows with project skills", () => {
    const ranked = rankSkills([review, piNative, piFile], "");
    expect(ranked.map((skill) => skill.name)).toEqual([
      "architect",
      "pi-file",
      "review-pr",
    ]);
  });

  it("matches the displayed invocation", () => {
    expect(rankSkills([review, piNative], "skill")).toEqual([piNative]);
    expect(rankSkills([review, piNative], "skill:arch")).toEqual([piNative]);
  });

  it("gives the built-in row its exact invocation", () => {
    expect(BUILTIN_CREATE_SKILL.invocation).toBe("create-skill");
  });

  it("keeps every Pi result when the composer removes the default cap", () => {
    const rows: Skill[] = Array.from({ length: 75 }, (_, index) => ({
      kind: "native",
      name: `skill-${String(index).padStart(2, "0")}`,
      description: "Pi skill",
      invocation: `skill:skill-${String(index).padStart(2, "0")}`,
      source: "pi",
    }));

    expect(rankSkills(rows, "")).toHaveLength(50);
    expect(rankSkills(rows, "", Number.POSITIVE_INFINITY)).toHaveLength(75);
    expect(
      rankSkills(rows, "skill-74", Number.POSITIVE_INFINITY)[0]?.name,
    ).toBe("skill-74");
  });
});

describe("sameSkillList", () => {
  it("compares rows by value and order", () => {
    expect(
      sameSkillList([review, native], [{ ...review }, { ...native }]),
    ).toBe(true);
    expect(sameSkillList([review, native], [native, review])).toBe(false);
    expect(
      sameSkillList([review], [{ ...review, description: "Changed." }]),
    ).toBe(false);
    expect(
      sameSkillList([review], [{ ...review, path: "/elsewhere/SKILL.md" }]),
    ).toBe(false);
    expect(sameSkillList([review], [review, native])).toBe(false);
  });
});

describe("skill names", () => {
  it("slugs and validates", () => {
    expect(slugSkillName("Review PR")).toBe("review-pr");
    expect(isValidSkillName("review-pr")).toBe(true);
    expect(isValidSkillName("Review")).toBe(false);
    expect(isValidSkillName("-nope")).toBe(false);
  });

  it("writes a starter SKILL.md", () => {
    const md = blankSkillMarkdown("review-pr");
    expect(md).toContain("name: review-pr");
    expect(md).toContain("# Review Pr");
  });
});
