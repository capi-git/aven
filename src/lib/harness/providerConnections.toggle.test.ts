import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Turning servers off and on again, against fixture config files. Stand-ins
 * for Claude Code and Codex answer Aven's requests the way the real CLIs do
 * (see providerConnections.liveToggle.test.ts for the real ones): Claude
 * saves its choice in the project's entry of its own settings, and Codex
 * writes `enabled` in its own config file.
 */

type Child = { binary: string; cwd: string };
const children = new Map<string, Child>();
const lineHandlers = new Map<string, (line: string) => void>();
const exitHandlers = new Map<string, () => void>();
const sent: { binary: string; message: Record<string, unknown> }[] = [];

// ---------------------------------------------------------------------------
// Claude Code's settings: ~/.claude.json, with one entry per project.

const CLAUDE_FIXTURE = {
  mcpServers: {
    scape: { type: "stdio", command: "/gone/ScapeMCPServer" },
    rea: { type: "stdio", command: "/usr/local/bin/rea" },
  },
  projects: {} as Record<string, { disabledMcpServers?: string[] }>,
};
let claudeJson = structuredClone(CLAUDE_FIXTURE);

function claudeStatus(cwd: string) {
  const disabled = claudeJson.projects[cwd]?.disabledMcpServers ?? [];
  return Object.keys(claudeJson.mcpServers).map((name) =>
    disabled.includes(name)
      ? { name, status: "disabled", scope: "user", source: "user" }
      : name === "scape"
        ? {
            name,
            status: "failed",
            scope: "user",
            source: "user",
            error: "ENOENT: no such file or directory, posix_spawn",
          }
        : { name, status: "connected", scope: "user", tools: [{ name: "a" }] },
  );
}

function claudeAnswer(cwd: string, request: Record<string, unknown>) {
  if (request.subtype === "initialize") return { ok: {} };
  if (request.subtype === "mcp_status")
    return { ok: { mcpServers: claudeStatus(cwd) } };
  if (request.subtype === "mcp_toggle") {
    const name = String(request.serverName);
    if (!(name in claudeJson.mcpServers))
      return { error: `Server not found: ${name}` };
    const project = (claudeJson.projects[cwd] ??= {});
    const list = project.disabledMcpServers ?? [];
    project.disabledMcpServers = request.enabled
      ? list.filter((item) => item !== name)
      : [...new Set([...list, name])];
    // Like the real CLI: the choice is saved, then a failing server reports
    // its start-up error.
    if (request.enabled && name === "scape")
      return { error: "ENOENT: no such file or directory, posix_spawn" };
    return { ok: {} };
  }
  return { error: `Unknown request ${String(request.subtype)}` };
}

// ---------------------------------------------------------------------------
// Codex's config.toml, edited the way Codex's own writer does.

const CODEX_FIXTURE = `# My Codex settings
model = "gpt-5"

[mcp_servers.rea]
command = "/usr/local/bin/rea"
args = ["mcp"]

[mcp_servers.computer-use]
command = "/usr/local/bin/computer-use"
`;
let configToml = CODEX_FIXTURE;

function codexTables(): Map<string, Record<string, string>> {
  const tables = new Map<string, Record<string, string>>();
  let current: Record<string, string> | null = null;
  let parent = false;
  for (const line of configToml.split("\n")) {
    const header = line.match(/^\[mcp_servers\.([^\]]+)\]$/);
    const inline = line.match(/^([\w-]+) = \{ command = ("[^"]*") \}$/);
    if (header) {
      current = {};
      parent = false;
      tables.set(header[1]!, current);
    } else if (line === "[mcp_servers]") {
      current = null;
      parent = true;
    } else if (line.startsWith("[")) {
      current = null;
      parent = false;
    } else if (parent && inline)
      tables.set(inline[1]!, { command: inline[2]! });
    else if (current && line.includes(" = ")) {
      const [key, value] = line.split(" = ");
      current[key!] = value!;
    }
  }
  return tables;
}

function writeEnabled(name: string, value: boolean | null) {
  const lines = configToml.split("\n");
  const start = lines.indexOf(`[mcp_servers.${name}]`);
  if (start < 0) throw new Error("Invalid configuration: invalid transport");
  let end = lines.findIndex(
    (line, index) => index > start && line.startsWith("["),
  );
  if (end < 0) end = lines.length;
  while (end > start + 1 && lines[end - 1] === "") end--;
  const at = lines
    .slice(start, end)
    .findIndex((line) => line.startsWith("enabled = "));
  if (at >= 0) lines.splice(start + at, 1);
  if (value !== null)
    lines.splice(at >= 0 ? start + at : end, 0, `enabled = ${value}`);
  configToml = lines.join("\n");
}

const CODEX_FILE = "/fixture/.codex/config.toml";
/** Codex's layer version: a hash of the file's contents. */
const version = () =>
  `sha256:${[...configToml].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 7)}`;
/** Like Codex's writer on an inline table: the next write breaks the file. */
const codexFaults = { breakNextWrite: false };
const encode = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const decode = (data: string) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(data), (char) => char.charCodeAt(0)),
  );

function codexAnswer(message: { method?: string; params?: unknown }) {
  const params = (message.params ?? {}) as Record<string, unknown>;
  const tables = codexTables();
  const user = { type: "user", file: CODEX_FILE, profile: null };
  switch (message.method) {
    case "initialize":
      return { result: {} };
    case "mcpServerStatus/list":
      return {
        result: {
          data: [...tables].map(([name, table]) => ({
            name,
            tools: table.enabled === "false" ? {} : { a: {} },
            toolsError: null,
            authStatus: "unsupported",
            runtimeStatus: null,
            pluginId: null,
          })),
          nextCursor: null,
        },
      };
    case "config/read": {
      // A header Codex's own writer mangled: the file no longer parses.
      if (configToml.includes("[#"))
        return {
          error: {
            code: -32603,
            message: "failed to read configuration layers",
          },
        };
      const servers = Object.fromEntries(
        [...tables].map(([name, table]) => [
          name,
          {
            command: JSON.parse(table.command!),
            ...(table.enabled ? { enabled: table.enabled === "true" } : {}),
          },
        ]),
      );
      return {
        result: {
          config: { mcp_servers: servers },
          origins: Object.fromEntries(
            [...tables.keys()].map((name) => [
              `mcp_servers.${name}.command`,
              { name: user, version: version() },
            ]),
          ),
          layers: params.includeLayers
            ? [
                {
                  name: user,
                  version: version(),
                  config: { mcp_servers: servers },
                  disabledReason: null,
                },
              ]
            : null,
        },
      };
    }
    case "fs/readFile":
      return params.path === CODEX_FILE
        ? { result: { dataBase64: encode(configToml) } }
        : { error: { code: -32603, message: "not found" } };
    case "fs/writeFile":
      if (params.path !== CODEX_FILE)
        return { error: { code: -32603, message: "unexpected file" } };
      configToml = decode(String(params.dataBase64));
      return { result: {} };
    case "config/value/write": {
      const key = String(params.keyPath).match(
        /^mcp_servers\.([^.]+)\.enabled$/,
      );
      if (
        !key ||
        params.mergeStrategy !== "replace" ||
        params.filePath !== CODEX_FILE
      )
        return { error: { code: -32600, message: "unexpected write" } };
      if (params.expectedVersion !== version())
        return {
          error: { code: -32600, message: "config file changed since read" },
        };
      if (codexFaults.breakNextWrite) {
        codexFaults.breakNextWrite = false;
        configToml = configToml.replace(
          `[mcp_servers.${key[1]}]`,
          `[# work tools\nmcp_servers.${key[1]} ]`,
        );
        return {
          result: { status: "ok", version: version(), filePath: CODEX_FILE },
        };
      }
      try {
        writeEnabled(key[1]!, params.value as boolean | null);
      } catch (error) {
        return { error: { code: -32600, message: (error as Error).message } };
      }
      return {
        result: { status: "ok", version: version(), filePath: CODEX_FILE },
      };
    }
    default:
      return { result: {} };
  }
}

/** Whether Codex's CLI is on this Mac. */
let codexInstalled = true;

vi.mock("./child", () => ({
  acquireHarnessBridge: async () => () => undefined,
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  resolveCodexBinary: async () => {
    // As harness_resolve_codex answers when the CLI isn't found.
    if (!codexInstalled)
      throw "Codex CLI not found. Install it from https://developers.openai.com/codex/cli and run `codex login`, then retry.";
    return { path: "/fake/codex" };
  },
  spawnChild: async (
    id: string,
    binary: string,
    _args: string[],
    cwd: string,
  ) => {
    children.set(id, { binary, cwd });
  },
  killChild: async (id: string) => {
    children.delete(id);
  },
  unwatchChild: (id: string) => lineHandlers.delete(id),
  watchChild: (id: string, line: (l: string) => void, exit: () => void) => {
    lineHandlers.set(id, line);
    exitHandlers.set(id, exit);
  },
  writeChild: async (id: string, line: string) => {
    const child = children.get(id)!;
    const message = JSON.parse(line) as Record<string, unknown>;
    sent.push({ binary: child.binary, message });
    let reply: unknown;
    if (child.binary === "/fake/claude") {
      // Ending the session: Claude finishes writing and exits on its own.
      if ((message.request as { subtype?: string }).subtype === "end_session") {
        queueMicrotask(() => exitHandlers.get(id)?.());
        return;
      }
      const request = message.request as Record<string, unknown>;
      const answer = claudeAnswer(child.cwd, request);
      reply = {
        type: "control_response",
        response:
          "ok" in answer
            ? {
                subtype: "success",
                request_id: message.request_id,
                response: answer.ok,
              }
            : {
                subtype: "error",
                request_id: message.request_id,
                error: answer.error,
              },
      };
    } else {
      if (message.id === undefined) return;
      reply = { id: message.id, ...codexAnswer(message) };
    }
    queueMicrotask(() => lineHandlers.get(id)?.(JSON.stringify(reply)));
  },
}));

const {
  listClaudeConnections,
  listCodexConnections,
  ProviderNotInstalledError,
  setClaudeServerEnabled,
  setCodexServerEnabled,
} = await import("./providerConnections");

const PROJECT = "/Users/demo/Developer/site";

beforeEach(() => {
  claudeJson = structuredClone(CLAUDE_FIXTURE);
  configToml = CODEX_FIXTURE;
  sent.length = 0;
  codexInstalled = true;
});

describe("an agent that isn't installed", () => {
  it("says so apart from a failure, starting nothing", async () => {
    codexInstalled = false;
    const listed = listCodexConnections(PROJECT);
    await expect(listed).rejects.toBeInstanceOf(ProviderNotInstalledError);
    await expect(listed).rejects.toThrow("Codex CLI not found");
    expect(children.size).toBe(0);
  });
});

describe("turning Claude Code servers off and on", () => {
  it("uses Claude's own toggle, saved for this project only, and back", async () => {
    await setClaudeServerEnabled(PROJECT, "rea", false);
    // Ending the session lets Claude finish saving before Aven stops it.
    expect(sent.map(({ message }) => message.request).filter(Boolean)).toEqual([
      { subtype: "initialize" },
      { subtype: "mcp_toggle", serverName: "rea", enabled: false },
      { subtype: "end_session" },
    ]);
    expect(claudeJson.projects[PROJECT]).toEqual({
      disabledMcpServers: ["rea"],
    });
    // The user's server definitions are untouched.
    expect(claudeJson.mcpServers).toEqual(CLAUDE_FIXTURE.mcpServers);

    const off = await listClaudeConnections(PROJECT);
    expect(off.find((row) => row.key === "rea")).toMatchObject({
      state: "off",
      canTurnOff: true,
    });
    // Another project still has it on.
    const elsewhere = await listClaudeConnections("/Users/demo/other");
    expect(elsewhere.find((row) => row.key === "rea")!.state).toBe("ready");

    await setClaudeServerEnabled(PROJECT, "rea", true);
    expect(claudeJson.projects[PROJECT]!.disabledMcpServers).toEqual([]);
    const on = await listClaudeConnections(PROJECT);
    expect(on.find((row) => row.key === "rea")!.state).toBe("ready");
  });

  it("counts a server that fails to start as turned on", async () => {
    await setClaudeServerEnabled(PROJECT, "scape", false);
    await expect(
      setClaudeServerEnabled(PROJECT, "scape", true),
    ).resolves.toBeUndefined();
    expect(claudeJson.projects[PROJECT]!.disabledMcpServers).toEqual([]);
  });

  it("reports Claude's refusal", async () => {
    await expect(
      setClaudeServerEnabled(PROJECT, "nope", false),
    ).rejects.toThrow("Server not found: nope");
  });
});

describe("turning Codex servers off and on", () => {
  it("writes enabled through Codex's config writer, only if the file is unchanged, and back", async () => {
    await setCodexServerEnabled(PROJECT, "computer-use", false);
    const methods = sent
      .map(({ message }) => message.method)
      .filter((method) => method !== "initialized");
    // Read, keep the bytes, write, then read back in the same session.
    expect(methods).toEqual([
      "initialize",
      "config/read",
      "fs/readFile",
      "config/value/write",
      "config/read",
      "fs/readFile",
    ]);
    const write = sent.find(
      ({ message }) => message.method === "config/value/write",
    )!;
    expect(write.message.params).toEqual({
      keyPath: "mcp_servers.computer-use.enabled",
      value: false,
      mergeStrategy: "replace",
      filePath: CODEX_FILE,
      expectedVersion: expect.stringMatching(/^sha256:/),
    });
    expect(configToml).toContain(
      '[mcp_servers.computer-use]\ncommand = "/usr/local/bin/computer-use"\nenabled = false\n',
    );
    // Nothing else in the file changed.
    expect(configToml.replace("enabled = false\n", "")).toBe(CODEX_FIXTURE);

    const off = await listCodexConnections(PROJECT);
    expect(off.find((row) => row.key === "computer-use")).toMatchObject({
      state: "off",
      canTurnOff: true,
      source: "Personal",
    });
    expect(off.find((row) => row.key === "rea")!.state).toBe("ready");

    await setCodexServerEnabled(PROJECT, "computer-use", true);
    expect(configToml).toBe(CODEX_FIXTURE);
    const on = await listCodexConnections(PROJECT);
    expect(on.find((row) => row.key === "computer-use")!.state).toBe("ready");
  });

  it("puts the file's bytes back when Codex can't read what it wrote", async () => {
    codexFaults.breakNextWrite = true;
    await expect(
      setCodexServerEnabled(PROJECT, "computer-use", false),
    ).rejects.toThrow("Aven put its config file back as it was");
    expect(configToml).toBe(CODEX_FIXTURE);
    expect(
      sent.filter(({ message }) => message.method === "fs/writeFile"),
    ).toHaveLength(1);
  });

  it("refuses names Codex can't address and servers the user's file doesn't define, without writing", async () => {
    await expect(
      setCodexServerEnabled(PROJECT, "has.dot", false),
    ).rejects.toThrow("can't turn this server off");
    await expect(setCodexServerEnabled(PROJECT, "nope", true)).rejects.toThrow(
      "settings file Aven doesn't change",
    );
    expect(configToml).toBe(CODEX_FIXTURE);
    expect(
      sent.some(({ message }) =>
        ["config/value/write", "fs/writeFile"].includes(String(message.method)),
      ),
    ).toBe(false);
  });

  it("leaves an inline-table entry alone and doesn't offer to turn it off", async () => {
    configToml = `${CODEX_FIXTURE}\n[mcp_servers]\n# work tools\ntools = { command = "/usr/bin/true" }\n`;
    const before = configToml;
    await expect(
      setCodexServerEnabled(PROJECT, "tools", false),
    ).rejects.toThrow("own [mcp_servers.tools] table");
    expect(configToml).toBe(before);
  });
});
