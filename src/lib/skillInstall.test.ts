import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: [] as ((event: { payload: unknown }) => void)[],
  unlisten: vi.fn(),
  invalidateSkills: vi.fn(),
  invalidateProjectFiles: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    _event: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    native.handlers.push(handler);
    return native.unlisten;
  },
}));
vi.mock("./skills", () => ({ invalidateSkills: native.invalidateSkills }));
vi.mock("./fileIndex", () => ({
  invalidateProjectFiles: native.invalidateProjectFiles,
}));

import {
  cliFailureText,
  forgetSkillListsAfterInstall,
  initialSelection,
  installRequest,
  installResult,
  NODE_MISSING,
  parseFindResults,
  parseInstallJson,
  parseSkillList,
  parseSkillSource,
  pickFoundSkill,
  runSkillsCli,
  stripAnsi,
  successLine,
  type SkillsCliOutcome,
} from "./skillInstall";

const outcome = (patch: Partial<SkillsCliOutcome> = {}): SkillsCliOutcome => ({
  status: "finished",
  code: 0,
  stdout: "",
  stderr: "",
  installed: [],
  ...patch,
});

beforeEach(() => {
  native.invoke.mockReset();
  native.unlisten.mockReset();
  native.handlers = [];
  native.invalidateSkills.mockReset();
  native.invalidateProjectFiles.mockReset();
});

describe("parseSkillSource", () => {
  it("accepts owner/repo, GitHub and skills.sh links, and names", () => {
    expect(parseSkillSource("  nutlope/hallmark ")).toEqual({
      ok: true,
      source: {
        kind: "repo",
        cli: "nutlope/hallmark",
        label: "nutlope/hallmark",
      },
    });
    expect(parseSkillSource("owner/repo/skills/web-design")).toMatchObject({
      ok: true,
      source: { cli: "owner/repo/skills/web-design" },
    });
    expect(parseSkillSource("https://github.com/nutlope/hallmark/")).toEqual({
      ok: true,
      source: {
        kind: "repo",
        cli: "https://github.com/nutlope/hallmark",
        label: "nutlope/hallmark",
      },
    });
    expect(parseSkillSource("github.com/owner/repo.git")).toMatchObject({
      ok: true,
      source: { cli: "https://github.com/owner/repo.git", label: "owner/repo" },
    });
    expect(
      parseSkillSource("https://github.com/owner/repo/tree/main/skills/x"),
    ).toMatchObject({
      ok: true,
      source: { cli: "https://github.com/owner/repo/tree/main/skills/x" },
    });
    expect(
      parseSkillSource("https://skills.sh/nutlope/hallmark/hallmark"),
    ).toEqual({
      ok: true,
      source: {
        kind: "repo",
        cli: "nutlope/hallmark",
        label: "nutlope/hallmark",
        preselect: "hallmark",
      },
    });
    expect(parseSkillSource("nutlope/hallmark@hallmark")).toEqual({
      ok: true,
      source: {
        kind: "repo",
        cli: "nutlope/hallmark",
        label: "nutlope/hallmark",
        preselect: "hallmark",
      },
    });
    expect(parseSkillSource("hallmark")).toEqual({
      ok: true,
      source: { kind: "name", query: "hallmark", label: "hallmark" },
    });
  });

  it.each([
    "",
    "   ",
    "nutlope/hall mark",
    "owner/repo; rm -rf ~",
    "owner/repo&&id",
    "owner/$(whoami)",
    "owner/`id`",
    "owner/repo|cat",
    "owner/repo>out",
    "owner/../etc",
    "./skills",
    "../skills",
    "/etc/passwd",
    "~/skills",
    "C:\\skills",
    "-g",
    "--list",
    "-owner/repo",
    "git@github.com:owner/repo.git",
    "http://github.com/owner/repo",
    "https://gitlab.com/owner/repo",
    "https://github.com.evil.test/owner/repo",
    "https://github.com/owner",
    "https://skills.sh/a/b/c/d",
    "file:///tmp/x",
    "owner/repo@bad;name",
    "näme",
    "a".repeat(201),
  ])("refuses %j", (raw) => {
    const result = parseSkillSource(raw);
    expect(result.ok).toBe(false);
  });
});

// Captured from `skills add <local folder> --list` (skills 1.7.4), logo
// trimmed to its last line.
const LIST_OUTPUT =
  "\u001b[38;5;238m╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝\u001b[0m\n\n┌   skills \n│\n│  Tip: use the --yes (-y) and --global (-g) flags to install without prompts.\n\u001b[?25l│\n◇  Source: /tmp/skillfix/src\n\u001b[?25h\u001b[?25l│\n◇  Local path validated\n\u001b[?25h\u001b[?25l│\n◇  Found 2 skills\n\u001b[?25h\n│\n◇  Available Skills\n│\n│    alpha\n│\n│      Alpha does the first thing. Use when asked.\n│\n│    beta-tool\n│\n│      Beta tool helps with the second thing.\n\n│\n└  Use --skill <name> to install specific skills\n\n";

describe("parseSkillList", () => {
  it("reads names and descriptions from the CLI's list", () => {
    expect(parseSkillList(LIST_OUTPUT)).toEqual([
      {
        name: "alpha",
        description: "Alpha does the first thing. Use when asked.",
      },
      {
        name: "beta-tool",
        description: "Beta tool helps with the second thing.",
      },
    ]);
  });

  it("reads plain bars, group titles, and output without a guide", () => {
    const ascii = [
      "o  Available Skills",
      "|",
      "Design Skills",
      "|    hallmark",
      "|",
      "|      Make pages look designed.",
      "",
      "General",
      "|    polish",
      "|      Polish UI.",
      "|    hallmark",
      "—  Use --skill <name> to install specific skills",
      "|    after-the-end",
    ].join("\r\n");
    expect(parseSkillList(ascii)).toEqual([
      { name: "hallmark", description: "Make pages look designed." },
      { name: "polish", description: "Polish UI." },
    ]);
    const bare = "Available Skills\n  one\n    First.\n  two\n";
    expect(parseSkillList(bare)).toEqual([
      { name: "one", description: "First." },
      { name: "two", description: "" },
    ]);
  });

  it("finds nothing when the list is missing", () => {
    expect(parseSkillList("■  Failed to clone repository")).toEqual([]);
    expect(parseSkillList("◇  Available Skills\n│\n└  Use --skill")).toEqual(
      [],
    );
  });

  it("strips colors and cursor codes", () => {
    expect(
      stripAnsi("\u001b[32m✓\u001b[0m done\u001b[?25h\u001b]0;t\u0007"),
    ).toBe("✓ done");
  });
});

describe("skills.sh lookups", () => {
  const FIND_OUTPUT =
    "\u001b[38;5;102mInstall with\u001b[0m npx skills add <owner/repo@skill>\n\n" +
    "\u001b[38;5;145mnutlope/hallmark@hallmark\u001b[0m \u001b[36m12.4K installs\u001b[0m\n" +
    "\u001b[38;5;102m└ https://skills.sh/nutlope/hallmark/hallmark\u001b[0m\n\n" +
    "someone/designs@hallmark-lite 3 installs\n" +
    "other/fork@Hallmark 1 install\n";

  it("reads results and picks the most-installed exact name", () => {
    const results = parseFindResults(FIND_OUTPUT);
    expect(results).toEqual([
      { source: "nutlope/hallmark", name: "hallmark" },
      { source: "someone/designs", name: "hallmark-lite" },
      { source: "other/fork", name: "Hallmark" },
    ]);
    expect(pickFoundSkill(results, "hallmark")).toEqual({
      source: "nutlope/hallmark",
      name: "hallmark",
    });
    expect(pickFoundSkill(results, "missing")).toBeNull();
    expect(parseFindResults('No skills found for "zzz"')).toEqual([]);
  });
});

describe("installing", () => {
  const listed = [
    { name: "alpha", description: "" },
    { name: "beta", description: "" },
  ];

  it("ticks the named skill, or every skill", () => {
    expect([...initialSelection(listed)]).toEqual(["alpha", "beta"]);
    expect([...initialSelection(listed, "BETA")]).toEqual(["beta"]);
    expect([...initialSelection(listed, "gamma")]).toEqual(["alpha", "beta"]);
  });

  it("builds global and project requests for every or chosen skills", () => {
    expect(
      installRequest({
        runId: "r1",
        source: "nutlope/hallmark",
        scope: "global",
        cwd: "/work/site",
        listed,
        selected: new Set(["alpha", "beta"]),
      }),
    ).toEqual({
      ok: true,
      names: ["alpha", "beta"],
      request: {
        runId: "r1",
        action: "add",
        source: "nutlope/hallmark",
        global: true,
        skills: ["alpha", "beta"],
        allSkills: true,
      },
    });
    expect(
      installRequest({
        runId: "r2",
        source: "owner/repo",
        scope: "project",
        cwd: "/work/site",
        listed,
        selected: new Set(["beta"]),
      }),
    ).toEqual({
      ok: true,
      names: ["beta"],
      request: {
        runId: "r2",
        action: "add",
        source: "owner/repo",
        global: false,
        skills: ["beta"],
        allSkills: false,
        cwd: "/work/site",
      },
    });
  });

  it("refuses an empty choice and a name that can't be passed alone", () => {
    const base = {
      runId: "r",
      source: "owner/repo",
      scope: "global" as const,
      cwd: "/p",
    };
    expect(
      installRequest({ ...base, listed, selected: new Set() }),
    ).toMatchObject({ ok: false, error: "Choose at least one skill to add." });
    const odd = [...listed, { name: "C++ tips", description: "" }];
    expect(
      installRequest({ ...base, listed: odd, selected: new Set(["C++ tips"]) }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("C++ tips") });
    // Every skill: names are not passed to the CLI, so any name is fine.
    expect(
      installRequest({
        ...base,
        listed: odd,
        selected: new Set(odd.map((skill) => skill.name)),
      }),
    ).toMatchObject({ ok: true, request: { allSkills: true } });
  });

  it("says what was added and where", () => {
    expect(successLine(["hallmark"], "global")).toBe(
      "Added hallmark for all projects",
    );
    expect(successLine(["a", "b"], "project")).toBe(
      "Added a and b to this project",
    );
    expect(successLine(["a", "b", "c"], "global")).toBe(
      "Added 3 skills for all projects",
    );
  });

  it("reads the --json result", () => {
    expect(
      parseInstallJson(
        '[\n  {"name":"a","status":"installed","path":"/x"}\n]\n',
      ),
    ).toEqual([{ name: "a", status: "installed", path: "/x" }]);
    expect(
      parseInstallJson(
        'npm warn exec skills@1\n[{"status":"failed","error":"boom"}]',
      ),
    ).toEqual([{ status: "failed", error: "boom" }]);
    expect(parseInstallJson("not json")).toBeNull();
    expect(parseInstallJson("")).toBeNull();
    expect(parseInstallJson('{"status":"installed"}')).toBeNull();
  });

  it("counts a skill written to disk even when one agent reported a failure", () => {
    const stdout = JSON.stringify([
      {
        name: "hallmark",
        status: "failed",
        error: "PromptScript does not support global skill installation",
      },
    ]);
    expect(
      installResult(
        outcome({ code: 1, stdout, installed: ["hallmark"] }),
        ["hallmark"],
        "nutlope/hallmark",
      ),
    ).toEqual({ added: ["hallmark"], error: null });
  });

  it("reports partial and total failures in plain words", () => {
    const stdout = JSON.stringify([
      { name: "alpha", status: "installed" },
      {
        name: "beta",
        status: "skipped",
        reason: "No matching skill found in source",
      },
    ]);
    expect(
      installResult(outcome({ code: 1, stdout }), ["alpha", "beta"], "o/r"),
    ).toEqual({
      added: ["alpha"],
      error: "beta couldn't be added: No matching skill found in source",
    });
    const failed = JSON.stringify([
      {
        status: "failed",
        error: "Failed to clone repository\nfatal: not found",
      },
    ]);
    expect(
      installResult(outcome({ code: 1, stdout: failed }), ["alpha"], "o/r"),
    ).toEqual({
      added: [],
      error: "Couldn't add alpha: Failed to clone repository\nfatal: not found",
    });
    expect(
      installResult(
        outcome({ status: "missingNode", code: null }),
        ["a"],
        "o/r",
      ),
    ).toEqual({ added: [], error: NODE_MISSING });
  });
});

describe("cliFailureText", () => {
  it.each([
    [{ status: "missingNode" as const }, NODE_MISSING],
    [{ status: "timedOut" as const }, "This took too long"],
    [
      { status: "failedToStart" as const },
      "couldn't start the skills installer",
    ],
    [
      { code: 1, stderr: "npm warn EBADENGINE Unsupported engine" },
      "version 22",
    ],
    [
      { code: 1, stderr: "getaddrinfo ENOTFOUND registry.npmjs.org" },
      "reach the internet",
    ],
    [
      { code: 1, stdout: "■  Failed to clone repository" },
      "Couldn't find nutlope/hallmark on GitHub",
    ],
    [
      { code: 1, stdout: "■  No valid skills found." },
      "doesn't contain any skills",
    ],
    [
      { code: 1, stderr: "npm error code E500" },
      "download the skills installer",
    ],
    [
      {
        code: 1,
        stdout: "│\n▲  Something odd happened\n└  Installation failed",
      },
      "The skills installer stopped: Installation failed",
    ],
    [{ code: 1 }, "without saying why"],
  ])("explains %j", (patch, text) => {
    expect(cliFailureText(outcome(patch), "nutlope/hallmark")).toContain(text);
  });
});

describe("running the CLI", () => {
  it("streams this run's lines and stops listening when it ends", async () => {
    const lines: string[] = [];
    native.invoke.mockImplementation(async () => {
      for (const handler of native.handlers) {
        handler({
          payload: { runId: "r1", line: "$ npx --yes skills@1 add a/b --list" },
        });
        handler({ payload: { runId: "other", line: "not ours" } });
      }
      return outcome({ stdout: LIST_OUTPUT });
    });
    const result = await runSkillsCli(
      { runId: "r1", action: "list", source: "a/b" },
      (line) => lines.push(line),
    );
    expect(native.invoke).toHaveBeenCalledWith("skills_cli_run", {
      request: { runId: "r1", action: "list", source: "a/b" },
    });
    expect(lines).toEqual(["$ npx --yes skills@1 add a/b --list"]);
    expect(result.stdout).toBe(LIST_OUTPUT);
    expect(native.unlisten).toHaveBeenCalledOnce();
  });

  it("stops listening when the run fails to start", async () => {
    native.invoke.mockRejectedValue("Choose at least one skill to add.");
    await expect(
      runSkillsCli({ runId: "r", action: "add", source: "a/b" }, () => {}),
    ).rejects.toBe("Choose at least one skill to add.");
    expect(native.unlisten).toHaveBeenCalledOnce();
  });

  it("forgets cached skill lists where the skill was added", () => {
    forgetSkillListsAfterInstall("project", "/work/site");
    expect(native.invalidateSkills).toHaveBeenCalledWith({ cwd: "/work/site" });
    expect(native.invalidateProjectFiles).toHaveBeenCalledWith("/work/site");
    native.invalidateSkills.mockReset();
    forgetSkillListsAfterInstall("global", "/work/site");
    expect(native.invalidateSkills).toHaveBeenCalledWith();
  });
});
