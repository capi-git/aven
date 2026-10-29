// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildThreadStartParams,
  buildTurnStartParams,
} from "./harness/codexProtocol";
import {
  permissionRulesKey,
  sessionPermissions,
} from "./harness/sessionPermissions";
import { resetCrewsCache, updateCrew, type Crew } from "./crews";
import {
  botChatPermissions,
  crewPermissionRules,
  crewSandbox,
  installBotPermissions,
  teammateChatRefusal,
  teammateHarness,
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

const crew: Pick<Crew, "path" | "copy"> = {
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

describe("no push, no publish, for every crew member", () => {
  it("denies pushing, pull requests, publishing and deploying to each role", () => {
    for (const role of ["builder", "checker", "scout"] as const) {
      const { deny = [], ask = [] } = crewPermissionRules(crew, role);
      for (const rule of NEVER) {
        expect(deny).toContain(rule);
        expect(ask).not.toContain(rule);
      }
      // Committing and merging still ask: the user's OK, never a bot's.
      expect(ask).toContain("Bash(git commit *)");
      expect(ask).toContain("Bash(git merge *)");
    }
  });

  it("lets the Builder edit its copy, and asks before your folder", () => {
    const { deny = [], ask = [] } = crewPermissionRules(crew, "builder");
    expect(ask).toContain(`Edit(/${PROJECT}/**)`);
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
        { role: "builder", sessionId: "b-chat" },
        { role: "checker", sessionId: "c-chat", harness: "codex" },
        { role: "scout", sessionId: "s-chat" },
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
    expect(sessionPermissions("c-chat")?.refuse).toMatch(/crew is off/);
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

  it("launches every crew chat, and the Fixer's, with no MCP servers", () => {
    const stop = installBotPermissions();
    updateCrew(PROJECT, (current) => ({
      ...current,
      ...crew,
      on: true,
      members: [{ role: "builder", sessionId: "b-chat" }],
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

describe("a crew's or bot's chat stays on its own app", () => {
  it("refuses Compact (or any start) on another app, outside its copy, or while off", () => {
    const stop = installBotPermissions();
    updateCrew(PROJECT, (current) => ({
      ...current,
      ...crew,
      on: true,
      members: [
        { role: "builder", sessionId: "b-chat" },
        { role: "checker", sessionId: "c-chat", harness: "codex" },
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
    updateCrew(PROJECT, (current) => ({ ...current, on: false }));
    expect(teammateChatRefusal(chat("b-chat", "claude"))).toMatch(
      /crew is off/,
    );
    // An ordinary chat is never held back.
    expect(
      teammateChatRefusal(chat("someone-else", "grok", PROJECT)),
    ).toBeNull();
    stop();
  });
});
