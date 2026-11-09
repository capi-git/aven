// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildThreadStartParams,
  buildTurnStartParams,
} from "./harness/codexProtocol";
import {
  launchRefusal,
  permissionRulesKey,
  sessionPermissions,
} from "./harness/sessionPermissions";
import { resetCrewsCache, updateCrew, type Crew } from "./crews";
import {
  botChatPermissions,
  botPermissionRules,
  botSandbox,
  crewChatPermissions,
  NEVER_READ_PATHS,
  PUBLISH_CREDENTIALS,
  WEB_TOOLS,
  crewPermissionRules,
  crewSandbox,
  installBotPermissions,
  protectedFixPaths,
  teammateChatRefusal,
  teammateHarness,
  absolutePathRule,
} from "./projectBotPermissions";
import { buildClaudeSpawnArgs } from "./harness/claudeProtocol";
import { codexMcpOffArgs, enabledMcpServers } from "./harness/codex";
import { resetProjectBotsCache } from "./projectBots";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

const PROJECT = "/Users/me/aven-site";
const COPY = "/data/bots/aven-site-crew-1";

/** A crew member's chat permissions, for a crew that is on with its copy. */
function crewChatPermissionsFor(role: "builder" | "checker") {
  updateCrew(PROJECT, (current) => ({
    ...current,
    on: true,
    copy: crew.copy,
    members: [
      { id: "builder", role: "builder", sessionId: "b-chat" },
      { id: "checker", role: "checker", sessionId: "c-chat" },
    ],
  }));
  return crewChatPermissions(role === "builder" ? "b-chat" : "c-chat");
}

const crew: Pick<Crew, "path" | "copy" | "access"> = {
  path: PROJECT,
  copy: {
    path: COPY,
    branch: "aven/bot/crew-1a2b",
    root: PROJECT,
    gitDir: `${PROJECT}/.git`,
    sources: [`${COPY}/src`, `${COPY}/package.json`],
  },
};

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  resetCrewsCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetProjectBotsCache();
  resetCrewsCache();
});

const NEVER = [
  "Bash(git push)",
  "Bash(git push *)",
  "Bash(git * push *)",
  "Bash(gh pr create *)",
  "Bash(gh pr merge *)",
  "Bash(gh release *)",
  "Bash(npm publish *)",
  "Bash(pnpm publish *)",
  "Bash(cargo publish *)",
  "Bash(vercel *)",
  "Bash(netlify *)",
  "Bash(fly deploy *)",
  "Bash(wrangler deploy *)",
  "Bash(docker push *)",
];

describe("no push, no publish, for every teammate", () => {
  it("denies pushing, pull requests, publishing and deploying to each role", () => {
    for (const role of ["builder", "checker", "scout"] as const) {
      const { deny = [], ask = [] } = crewPermissionRules(crew, role);
      for (const rule of NEVER) {
        expect(deny).toContain(rule);
        expect(ask).not.toContain(rule);
      }
      // Committing and merging: it's told no, unless you choose Ask me.
      expect(deny).toContain("Bash(git commit *)");
      expect(deny).toContain("Bash(git merge *)");
      const asking = crewPermissionRules(
        { ...crew, access: { others: "ask" } },
        role,
      );
      for (const rule of NEVER) expect(asking.deny).toContain(rule);
      expect(asking.ask).toContain("Bash(git commit *)");
      expect(asking.ask).toContain("Bash(git merge *)");
    }
  });

  describe("Full access", () => {
    const full = {
      ...crew,
      access: { deletes: true, web: "everyone", others: "allow" },
    } as const;

    it("never asks a Builder, and keeps pushing and your files refused", () => {
      const { deny = [], ask = [] } = crewPermissionRules(full, "builder");
      expect(ask).toEqual([]);
      for (const rule of NEVER) expect(deny).toContain(rule);
      expect(deny).toContain(`Edit(${absolutePathRule(crew.path)})`);
      expect(deny).not.toContain("Bash(git commit *)");
      expect(deny).not.toContain("Bash(rm *)");
      expect(deny).not.toContain("WebFetch");
      // Sending could publish what it finds.
      expect(deny).toContain("Bash(curl -X *)");
      expect(deny).toContain("Bash(osascript *)");
    });

    it("keeps Delete off when you customise it", () => {
      const { deny = [] } = crewPermissionRules(
        { ...full, access: { ...full.access, deletes: false } },
        "builder",
      );
      expect(deny).toContain("Bash(rm *)");
    });

    it("leaves those who only read refused", () => {
      for (const role of ["checker", "scout", "security"] as const) {
        const { deny = [], ask = [] } = crewPermissionRules(full, role);
        expect(ask).toEqual([]);
        expect(deny).toContain("Bash(rm *)");
        expect(deny).toContain("Bash(git commit *)");
        expect(deny).toContain(`Edit(${absolutePathRule(crew.path)})`);
      }
    });
  });

  it("never waits on you by default: a Builder deletes in its copy, and the rest is told no", () => {
    for (const role of ["builder", "checker", "scout"] as const) {
      const { deny = [], ask = [] } = crewPermissionRules(crew, role);
      expect(ask).toEqual([]);
      // Sending is refused too: never looser than Ask me.
      expect(deny).toContain("Bash(curl -X *)");
      expect(deny).toContain("Bash(osascript *)");
      if (role === "builder") expect(deny).not.toContain("Bash(rm *)");
      // Only a Builder deletes without asking: the Checker and Scout only read.
      else expect(deny).toContain("Bash(rm *)");
    }
    // Keep deleting behind the same choice as the rest.
    const refused = crewPermissionRules(
      { ...crew, access: { deletes: false } },
      "builder",
    );
    expect(refused.deny).toContain("Bash(rm *)");
    const asked = crewPermissionRules(
      { ...crew, access: { deletes: false, others: "ask" } },
      "builder",
    );
    expect(asked.ask).toContain("Bash(rm *)");
    expect(asked.ask).toContain("Bash(curl -X *)");
    expect(asked.deny).not.toContain("Bash(rm *)");
  });

  it("keeps a command to the package registries, with no way to widen them", () => {
    for (const role of ["builder", "checker", "scout"] as const) {
      const { network } = crewSandbox(crew, role, undefined);
      expect(network?.strictAllowlist).toBe(true);
      expect(network?.allowedDomains).not.toContain("example.com");
    }
  });

  it("keeps publish tokens and your history out of reach", () => {
    const sandbox = crewSandbox(crew, "builder", undefined);
    expect(sandbox.filesystem?.denyRead).toEqual(NEVER_READ_PATHS);
    expect(sandbox.filesystem?.denyRead).toEqual(
      expect.arrayContaining(PUBLISH_CREDENTIALS),
    );
    expect(sandbox.filesystem?.denyRead).toContain("~/.npmrc");
    expect(sandbox.filesystem?.denyWrite).toContain(`${PROJECT}/.git/objects`);
    expect(crewPermissionRules(crew, "builder").deny).toContain(
      "Read(~/.npmrc)",
    );
    // A read-only teammate's sandbox keeps them too.
    expect(crewSandbox(crew, "scout", undefined).filesystem?.denyRead).toEqual(
      NEVER_READ_PATHS,
    );
  });

  it("lets you choose who uses the web", () => {
    const denies = (
      web: "none" | "builders" | "everyone",
      role: "builder" | "checker" | "scout",
    ) => crewPermissionRules({ ...crew, access: { web } }, role).deny;
    expect(denies("builders", "builder")).not.toContain("WebFetch");
    expect(denies("builders", "scout")).toEqual(
      expect.arrayContaining(WEB_TOOLS),
    );
    expect(denies("builders", "checker")).toEqual(
      expect.arrayContaining(WEB_TOOLS),
    );
    expect(denies("everyone", "scout")).not.toContain("WebFetch");
    expect(denies("none", "builder")).toEqual(
      expect.arrayContaining(WEB_TOOLS),
    );
    // Never skips auto mode's own check of what it fetches.
    expect(
      crewPermissionRules({ ...crew, access: { web: "everyone" } }, "builder")
        .allow,
    ).toBeUndefined();
    // Read-only stays read-only whatever you choose.
    expect(denies("everyone", "scout")).toContain(`Edit(/${COPY}/**)`);
  });

  it("gives Aven's browser only to those who may use it", () => {
    const socket = (
      web: "none" | "builders" | "everyone",
      role: "builder" | "checker" | "security" | "scout",
    ) =>
      crewSandbox({ ...crew, access: { web } }, role, "/tmp/aven.sock").network
        ?.allowUnixSockets;
    // All but the Scout, whose ideas build by themselves.
    for (const role of ["builder", "checker", "security"] as const)
      expect(socket("builders", role)).toEqual(["/tmp/aven.sock"]);
    expect(socket("builders", "scout")).toBeUndefined();
    expect(socket("everyone", "scout")).toEqual(["/tmp/aven.sock"]);
    for (const role of ["builder", "checker", "scout"] as const)
      expect(socket("none", role)).toBeUndefined();
  });

  it("plans a goal offline, whatever you set", () => {
    const everyone = { ...crew, access: { web: "everyone" as const } };
    expect(crewPermissionRules(everyone, "builder", true).deny).toEqual(
      expect.arrayContaining(WEB_TOOLS),
    );
    expect(
      crewSandbox(everyone, "builder", "/tmp/aven.sock", true).network
        ?.allowUnixSockets,
    ).toBeUndefined();
  });

  it("keeps asking about your folder when its own copy is inside it", () => {
    const home = {
      path: "/Users/me",
      copy: { ...crew.copy!, path: "/Users/me/Library/copy" },
    };
    const { deny = [], ask = [] } = crewPermissionRules(home, "builder");
    expect(deny).not.toContain("Edit(//Users/me/**)");
    expect(ask).toEqual(["Edit(//Users/me/**)"]);
  });

  it("lets the Builder edit its copy, and never your folder without asking", () => {
    const { deny = [] } = crewPermissionRules(crew, "builder");
    expect(deny).toContain(`Edit(/${PROJECT}/**)`);
    expect(
      crewPermissionRules({ ...crew, access: { others: "ask" } }, "builder")
        .ask,
    ).toContain(`Edit(/${PROJECT}/**)`);
    expect(deny).not.toContain(`Edit(/${COPY}/**)`);
    expect(
      crewSandbox(crew, "builder", undefined).filesystem?.denyWrite,
    ).not.toContain(`${COPY}/src`);
  });

  it("keeps the Checker and Scout read-only: no edits to the copy or your folder", () => {
    for (const role of ["checker", "scout"] as const) {
      const { deny = [], ask = [] } = crewPermissionRules(crew, role);
      expect(deny).toContain(`Edit(/${COPY}/**)`);
      expect(deny).toContain(`Edit(/${PROJECT}/**)`);
      expect(ask.some((rule) => rule.startsWith("Edit("))).toBe(false);
      const sandbox = crewSandbox(crew, role, undefined);
      expect(sandbox.allowUnsandboxedCommands).toBe(false);
      expect(sandbox.failIfUnavailable).toBe(true);
      // Its commands can't write the copy's own files…
      expect(sandbox.filesystem?.denyWrite).toEqual(
        expect.arrayContaining([`${COPY}/src`, `${COPY}/package.json`]),
      );
      // …nor the refs and index it shares with your checkout.
      expect(sandbox.filesystem?.denyWrite).toContain(`${PROJECT}/.git/refs`);
      // Only package registries and local ports.
      expect(sandbox.network?.allowedDomains).not.toContain("github.com");
    }
  });
});

describe("crew chats launch with their rules from any window", () => {
  it("gives each member's chat its rules, and the Checker a read-only flag", () => {
    const stop = installBotPermissions();
    updateCrew(PROJECT, (current) => ({
      ...current,
      ...crew,
      on: true,
      members: [
        { id: "builder", role: "builder", sessionId: "b-chat" },
        {
          id: "checker",
          role: "checker",
          sessionId: "c-chat",
          harness: "codex",
        },
        { id: "scout", role: "scout", sessionId: "s-chat" },
      ],
    }));
    const builder = sessionPermissions("b-chat")!;
    expect(builder.mode).toBe("auto");
    expect(builder.readOnly).toBeUndefined();
    expect(builder.rules.deny).toContain("Bash(git push)");
    const checker = sessionPermissions("c-chat")!;
    expect(checker.readOnly).toBe(true);
    expect(checker.rules.deny).toContain(`Edit(/${COPY}/**)`);
    expect(permissionRulesKey(checker)).not.toBe(permissionRulesKey(builder));
    expect(sessionPermissions("s-chat")?.readOnly).toBe(true);
    expect(sessionPermissions("someone-else")).toBeUndefined();
    // Off: still its rules, and refused outright.
    updateCrew(PROJECT, (current) => ({ ...current, on: false }));
    expect(sessionPermissions("c-chat")?.refuse).toMatch(/Avos is off/);
    expect(sessionPermissions("c-chat")?.readOnly).toBe(true);
    stop();
  });
});

describe("a Checker on Codex runs read-only", () => {
  it("starts its thread and every turn in Codex's read-only sandbox, never escalating", () => {
    const thread = buildThreadStartParams({
      cwd: COPY,
      runtimeMode: "auto",
      readOnly: true,
    });
    expect(thread).toMatchObject({
      approvalPolicy: "never",
      sandbox: "read-only",
    });
    const turn = buildTurnStartParams({
      threadId: "t",
      runtimeMode: "full-access",
      readOnly: true,
      prompt: "check",
    });
    expect(turn).toMatchObject({
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly" },
    });
    // Without the flag, a mode keeps its own sandbox.
    expect(
      buildTurnStartParams({ threadId: "t", runtimeMode: "auto", prompt: "x" })
        .sandboxPolicy,
    ).toEqual({ type: "workspaceWrite" });
  });
});

describe("no MCP servers, and no web for the Checker and Scout", () => {
  it("denies WebFetch and WebSearch to the Checker and Scout, not the Builder", () => {
    for (const role of ["checker", "scout"] as const) {
      const { deny = [] } = crewPermissionRules(crew, role);
      expect(deny).toEqual(expect.arrayContaining(["WebFetch", "WebSearch"]));
    }
    expect(crewPermissionRules(crew, "builder").deny).not.toContain("WebFetch");
  });

  it("launches every team chat, and the Fixer's, with no MCP servers", () => {
    const stop = installBotPermissions();
    updateCrew(PROJECT, (current) => ({
      ...current,
      ...crew,
      on: true,
      members: [{ id: "builder", role: "builder", sessionId: "b-chat" }],
    }));
    expect(sessionPermissions("b-chat")?.noMcp).toBe(true);
    stop();
    const fixer = botChatPermissions({
      path: PROJECT,
      copy: {
        path: "/data/bots/jelly",
        branch: "aven/bot/jelly",
        root: PROJECT,
      },
    });
    expect(fixer).toMatchObject({
      noMcp: true,
      workFolder: "/data/bots/jelly",
    });
    // A bot without its copy never launches.
    expect(botChatPermissions({ path: PROJECT }).refuse).toMatch(/copy/);
  });

  it("starts Claude with an empty, strict MCP config when told", () => {
    const args = buildClaudeSpawnArgs({ noMcp: true });
    const at = args.indexOf("--mcp-config");
    expect(args).toContain("--strict-mcp-config");
    expect(JSON.parse(args[at + 1])).toEqual({ mcpServers: {} });
    expect(buildClaudeSpawnArgs({})).not.toContain("--strict-mcp-config");
  });

  it("starts a bot's or crew's Claude with the user's settings only and no hooks", () => {
    // Project and local settings live in the copy, where an agent could
    // plant a hook that would run as you, unsandboxed.
    const args = buildClaudeSpawnArgs({
      userSettingsOnly: true,
      noMcp: true,
      settings: { sandbox: crewSandbox(crew, "builder", undefined) },
    });
    expect(args).toContain("--setting-sources=user");
    expect(args.some((arg) => arg.includes("project,local"))).toBe(false);
    const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
    expect(settings.disableAllHooks).toBe(true);
    // Ordinary chats keep the user's project settings and hooks.
    const plain = buildClaudeSpawnArgs({});
    expect(plain).toContain("--setting-sources=user,project,local");
    expect(
      JSON.parse(plain[plain.indexOf("--settings") + 1]).disableAllHooks,
    ).toBeUndefined();
  });

  it("keeps every teammate and bot out of the copy's settings and git internals", () => {
    const bot = { path: PROJECT, copy: crew.copy! };
    for (const sandbox of [
      crewSandbox(crew, "builder", undefined),
      crewSandbox(crew, "checker", undefined),
      crewSandbox(crew, "security", undefined),
      botSandbox(bot, undefined),
    ])
      expect(sandbox.filesystem?.denyWrite).toEqual(
        expect.arrayContaining([
          `${COPY}/.claude`,
          `${COPY}/.codex`,
          `${COPY}/.agents`,
          `${COPY}/.mcp.json`,
          `${COPY}/.vscode`,
          `${COPY}/.git`,
          `${PROJECT}/.git/hooks`,
          `${PROJECT}/.git/config`,
          `${PROJECT}/.git/worktrees`,
        ]),
      );
    for (const rules of [
      crewPermissionRules(crew, "builder"),
      crewPermissionRules(crew, "checker"),
      botPermissionRules(bot),
    ])
      expect(rules.deny).toEqual(
        expect.arrayContaining([
          `Edit(/${COPY}/.claude)`,
          `Edit(/${COPY}/.claude/**)`,
          `Edit(/${COPY}/.codex/**)`,
          `Edit(/${COPY}/.agents/**)`,
          `Edit(/${COPY}/.mcp.json)`,
          `Edit(/${COPY}/.vscode/**)`,
          // Your own settings, outside the copy.
          "Edit(~/.claude/**)",
          "Edit(~/.claude.json)",
          "Edit(~/.codex/**)",
          "Edit(~/.gitconfig)",
          "Edit(~/.config/git/**)",
          "Edit(~/.zshrc)",
          "Edit(~/.zprofile)",
          "Edit(~/.bashrc)",
          "Edit(~/.bash_profile)",
          "Edit(~/.profile)",
        ]),
      );
    for (const permissions of [
      botChatPermissions(bot),
      crewChatPermissionsFor("builder"),
      crewChatPermissionsFor("checker"),
    ])
      expect(permissions).toMatchObject({ userSettingsOnly: true });
  });

  it("starts Codex with each MCP server it knows switched off", () => {
    expect(
      enabledMcpServers({
        config: {
          mcp_servers: {
            github: { url: "https://x" },
            off: { enabled: false },
            "computer-use": { command: "x" },
          },
        },
      }),
    ).toEqual(["github", "computer-use"]);
    expect(codexMcpOffArgs(["github", "computer-use", "odd.name"])).toEqual([
      "-c",
      "mcp_servers.github.enabled=false",
      "-c",
      "mcp_servers.computer-use.enabled=false",
    ]);
  });
});

describe("a team's or bot's chat stays on its own app", () => {
  it("refuses Compact (or any start) on another app, outside its copy, or while off", () => {
    const stop = installBotPermissions();
    updateCrew(PROJECT, (current) => ({
      ...current,
      ...crew,
      on: true,
      members: [
        { id: "builder", role: "builder", sessionId: "b-chat" },
        {
          id: "checker",
          role: "checker",
          sessionId: "c-chat",
          harness: "codex",
        },
      ],
    }));
    expect(teammateHarness("b-chat")).toBe("claude");
    expect(teammateHarness("c-chat")).toBe("codex");
    expect(teammateHarness("someone-else")).toBeUndefined();
    const chat = (id: string, harness: string, worktreeCwd = COPY) => ({
      id,
      harness,
      cwd: PROJECT,
      worktreeCwd,
    });
    expect(teammateChatRefusal(chat("b-chat", "claude"))).toBeNull();
    expect(teammateChatRefusal(chat("c-chat", "codex"))).toBeNull();
    for (const other of ["grok", "cursor", "opencode", "pi"])
      expect(teammateChatRefusal(chat("b-chat", other))).toMatch(/own app/);
    expect(teammateChatRefusal(chat("c-chat", "claude"))).toMatch(/own app/);
    expect(teammateChatRefusal(chat("b-chat", "claude", PROJECT))).toMatch(
      /only in its own copy/,
    );
    // Once you've said Avos may not read the project, nothing runs in it.
    updateCrew(PROJECT, (current) => ({ ...current, readAccess: "declined" }));
    expect(teammateChatRefusal(chat("b-chat", "claude"))).toMatch(
      /needs your OK to read this project/,
    );
    updateCrew(PROJECT, (current) => ({ ...current, readAccess: "allowed" }));
    expect(teammateChatRefusal(chat("b-chat", "claude"))).toBeNull();
    updateCrew(PROJECT, (current) => ({ ...current, on: false }));
    expect(teammateChatRefusal(chat("b-chat", "claude"))).toMatch(
      /Avos is off/,
    );
    // An ordinary chat is never held back.
    expect(
      teammateChatRefusal(chat("someone-else", "grok", PROJECT)),
    ).toBeNull();
    stop();
  });
});

describe("a member that writes runs only on Claude Code", () => {
  it("keeps a Tester (a Builder) off Codex, which can't keep it out of the copy's settings", () => {
    const stop = installBotPermissions();
    updateCrew(PROJECT, (current) => ({
      ...current,
      ...crew,
      on: true,
      members: [
        {
          id: "tester",
          role: "builder",
          sessionId: "t-chat",
          harness: "codex",
          label: "Tester",
        },
        {
          id: "checker",
          role: "checker",
          sessionId: "c-chat",
          harness: "codex",
        },
      ],
    }));
    expect(teammateHarness("t-chat")).toBe("claude");
    // Codex's own guard refuses a crew chat that writes; one that only
    // reads runs, locked down.
    expect(launchRefusal("t-chat", COPY, "codex")).toMatch(
      /only on Claude Code/,
    );
    expect(launchRefusal("t-chat", COPY, "claude")).toBeNull();
    expect(launchRefusal("c-chat", COPY, "codex")).toBeNull();
    stop();
  });
});

describe("paths Apply never brings into your files", () => {
  it("refuses settings however git or Windows would spell them", () => {
    expect(
      protectedFixPaths([
        ".claude/skills/café/SKILL.md",
        '".claude/skills/caf\\303\\251/SKILL.md"',
        ".claude./settings.json",
        ".Codex /config.toml",
        "src/tab\there.ts",
        "src/app.ts",
      ]),
    ).toEqual([
      ".claude/skills/café/SKILL.md",
      '".claude/skills/caf\\303\\251/SKILL.md"',
      ".claude./settings.json",
      ".Codex /config.toml",
      "src/tab\there.ts",
    ]);
  });

  it("refuses names a case-insensitive file system folds into a settings folder", () => {
    // APFS reads "ſ" as "s" and "ﬁ" as "fi"; NFKC folds full-width letters.
    expect(
      protectedFixPaths([
        ".v\u017fcode/tasks.json",
        ".mcp.j\u017fon",
        ".hu\u017fky/pre-commit",
        ".\uff43laude/settings.json",
        ".pre-commit-con\ufb01g.yaml",
        // A dotfile-style name that isn't plain ASCII, as a margin.
        ".n\u00f6tes/run.sh",
        // Ordinary names with accents apply like any other.
        "Donn\u00e9es/notes.md",
        "R\u00e9sum\u00e9.md",
        "src/caf\u00e9.ts",
        "src/app.ts",
      ]),
    ).toEqual([
      ".v\u017fcode/tasks.json",
      ".mcp.j\u017fon",
      ".hu\u017fky/pre-commit",
      ".\uff43laude/settings.json",
      ".pre-commit-con\ufb01g.yaml",
      ".n\u00f6tes/run.sh",
    ]);
  });

  it("refuses them at any depth, with editor, package-manager and shell hooks, and the pairs", () => {
    const refused = [
      "packages/app/.vscode/tasks.json",
      "apps/web/.cursor/rules.md",
      "tools/.zed/settings.json",
      "a/b/.idea/workspace.xml",
      "docs/.devcontainer/devcontainer.json",
      "services/api/.aven/bots.json",
      "packages/ui/.npmrc",
      "packages/ui/.yarnrc.yml",
      "packages/ui/.pnpmfile.cjs",
      "packages/ui/bunfig.toml",
      "infra/.envrc",
      "crates/x/.cargo/config.toml",
      "crates/x/.cargo/config",
      "packages/app/.github/workflows/ci.yml",
      "a/.Cargo/Config.TOML",
      "a/.GitHub/Workflows/x.yml",
      "src/.husky/pre-commit",
      "src/lefthook.yml",
      // A look-alike below the top is a settings folder on a Mac too.
      "packages/app/.v\u017fcode/tasks.json",
      "packages/app/.n\u00f6tes/run.sh",
    ];
    const fine = [
      ".cargo/registry/index",
      ".github/dependabot.yml",
      ".github/README.md",
      "src/cargo/config.toml",
      "src/github/workflows/x.yml",
      "src/app.ts",
      "docs/Donn\u00e9es/notes.md",
    ];
    expect(protectedFixPaths([...refused, ...fine])).toEqual(refused);
  });
});

describe("what Apply never brings in", () => {
  it("refuses the files later agents read as your instructions", () => {
    expect(
      protectedFixPaths([
        "AGENTS.md",
        "packages/app/CLAUDE.md",
        ".github/copilot-instructions.md",
        "docs/agents-guide.md",
      ]),
    ).toEqual([
      "AGENTS.md",
      "packages/app/CLAUDE.md",
      ".github/copilot-instructions.md",
    ]);
  });
});
