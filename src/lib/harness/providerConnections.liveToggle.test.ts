import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Turning servers off and on with the real Claude Code and Codex, against
 * fixture homes in a temporary folder: nothing reads or writes your own
 * settings. Opt in with AVEN_MCP_LIVE=1 (both CLIs on PATH, or set
 * AVEN_MCP_LIVE_CLAUDE / AVEN_MCP_LIVE_CODEX to their paths).
 */
const LIVE = process.env.AVEN_MCP_LIVE === "1";

const fixture = vi.hoisted(() => ({ home: "" }));

vi.mock("./child", () => {
  const processes = new Map<string, ChildProcess>();
  const watchers = new Map<
    string,
    { line: (line: string) => void; exit?: () => void }
  >();
  return {
    acquireHarnessBridge: async () => () => undefined,
    resolveClaudeBinary: async () => ({
      path: process.env.AVEN_MCP_LIVE_CLAUDE ?? "claude",
    }),
    resolveCodexBinary: async () => ({
      path: process.env.AVEN_MCP_LIVE_CODEX ?? "codex",
    }),
    spawnChild: async (
      id: string,
      command: string,
      args: string[],
      cwd: string,
    ) => {
      const child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          HOME: fixture.home,
          CLAUDE_CONFIG_DIR: fixture.home,
          CODEX_HOME: join(fixture.home, ".codex"),
          XDG_CONFIG_HOME: join(fixture.home, ".config"),
        },
        stdio: ["pipe", "pipe", "ignore"],
      });
      let buffer = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          watchers.get(id)?.line(line);
        }
      });
      child.on("exit", () => watchers.get(id)?.exit?.());
      processes.set(id, child);
    },
    writeChild: async (id: string, line: string) => {
      processes.get(id)?.stdin!.write(`${line}\n`);
    },
    killChild: async (id: string) => {
      processes.get(id)?.kill();
      processes.delete(id);
    },
    watchChild: (id: string, line: (l: string) => void, exit?: () => void) =>
      watchers.set(id, { line, exit }),
    unwatchChild: (id: string) => watchers.delete(id),
  };
});

const {
  listClaudeConnections,
  listCodexConnections,
  setClaudeServerEnabled,
  setCodexServerEnabled,
} = await import("./providerConnections");

const CODEX_CONFIG = `# Fixture Codex settings
model = "gpt-5"

[mcp_servers.computer-use]
command = "/usr/bin/false"
`;

describe.skipIf(!LIVE)("real providers, fixture settings", () => {
  const servers = { scape: { type: "stdio", command: "" } };
  let root = "";
  let project = "";
  let claudeJson = "";
  let codexConfig = "";
  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "aven-mcp-live-")));
    fixture.home = join(root, "home");
    project = join(root, "project");
    mkdirSync(join(fixture.home, ".codex"), { recursive: true });
    mkdirSync(project);
    servers.scape.command = join(root, "missing", "ScapeMCPServer");
    claudeJson = join(fixture.home, ".claude.json");
    writeFileSync(
      claudeJson,
      JSON.stringify({ hasCompletedOnboarding: true, mcpServers: servers }),
    );
    codexConfig = join(fixture.home, ".codex", "config.toml");
    writeFileSync(codexConfig, CODEX_CONFIG);
  });
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  const claudeProject = () =>
    JSON.parse(readFileSync(claudeJson, "utf8")).projects?.[project] as
      { disabledMcpServers?: string[] } | undefined;

  it("Claude Code: off for this project, then on again", async () => {
    await setClaudeServerEnabled(project, "scape", false);
    expect(claudeProject()?.disabledMcpServers).toEqual(["scape"]);
    const off = await listClaudeConnections(project);
    expect(off.find((row) => row.key === "scape")?.state).toBe("off");

    await setClaudeServerEnabled(project, "scape", true);
    expect(claudeProject()?.disabledMcpServers).toEqual([]);
    expect(JSON.parse(readFileSync(claudeJson, "utf8")).mcpServers).toEqual(
      servers,
    );
    const on = await listClaudeConnections(project);
    expect(on.find((row) => row.key === "scape")?.state).toBe("failed");
  }, 90_000);

  it("Codex: enabled = false in its config file, then the file as it was", async () => {
    await setCodexServerEnabled(project, "computer-use", false);
    expect(readFileSync(codexConfig, "utf8")).toContain("enabled = false");
    const off = await listCodexConnections(project);
    expect(off.find((row) => row.key === "computer-use")).toMatchObject({
      state: "off",
      canTurnOff: true,
    });

    await setCodexServerEnabled(project, "computer-use", true);
    expect(readFileSync(codexConfig, "utf8")).toBe(CODEX_CONFIG);
  }, 90_000);
});
