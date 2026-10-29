import { describe, expect, it } from "vitest";
import {
  claudeConnectionsFromStatus,
  claudeInventoryArgs,
  codexConnectionsFromStatus,
  codexEntryForms,
} from "./providerConnections";

describe("Claude connection inventory", () => {
  it("maps mcp_status rows, putting problems first and turned-off servers last", () => {
    expect(
      claudeConnectionsFromStatus({
        mcpServers: [
          {
            name: "claude.ai Vercel",
            status: "connected",
            scope: "claudeai",
            tools: [{ name: "a" }, { name: "b" }],
          },
          { name: "claude.ai Gmail", status: "needs-auth", scope: "claudeai" },
          {
            name: "scape",
            status: "failed",
            scope: "user",
            error: "ENOENT: no such file ",
          },
          { name: "linear", status: "pending", scope: "plugin" },
          { name: "old", status: "disabled", scope: "local" },
          {
            name: "plugin:design:slack",
            status: "needs-auth",
            scope: "dynamic",
          },
        ],
      }),
    ).toEqual([
      {
        name: "Gmail",
        key: "claude.ai Gmail",
        canSignIn: true,
        state: "needs-sign-in",
        source: "claude.ai",
        account: true,
        canTurnOff: true,
      },
      {
        name: "slack",
        key: "plugin:design:slack",
        canSignIn: true,
        state: "needs-sign-in",
        source: "design plugin",
        plugin: "design",
        canTurnOff: true,
      },
      {
        name: "scape",
        key: "scape",
        scope: "user",
        removable: true,
        state: "failed",
        source: "Personal",
        canTurnOff: true,
        detail: "ENOENT: no such file",
      },
      {
        name: "linear",
        key: "linear",
        state: "starting",
        source: "Plugin",
        canTurnOff: true,
      },
      {
        name: "Vercel",
        key: "claude.ai Vercel",
        state: "ready",
        source: "claude.ai",
        account: true,
        canTurnOff: true,
        toolCount: 2,
      },
      {
        name: "old",
        key: "old",
        scope: "local",
        removable: true,
        state: "off",
        source: "Project, just you",
        canTurnOff: true,
      },
    ]);
  });

  it("keeps policy and app-registered servers as they are, and reports Claude's failure code", () => {
    const rows = claudeConnectionsFromStatus({
      mcpServers: [
        { name: "corp", status: "connected", scope: "managed", tools: [] },
        { name: "host", status: "connected", source: "sdk", tools: [] },
        {
          name: "claude.ai Notion",
          status: "failed",
          scope: "claudeai",
          error: "rejected",
          error_code: "CLAUDEAI_BEARER_REJECTED",
        },
      ],
    });
    const row = (key: string) => rows.find((item) => item.key === key)!;
    expect(row("corp").canTurnOff).toBeUndefined();
    expect(row("host").canTurnOff).toBeUndefined();
    expect(row("claude.ai Notion")).toMatchObject({
      state: "failed",
      canTurnOff: true,
      errorCode: "CLAUDEAI_BEARER_REJECTED",
    });
  });

  it("uses the user's settings without hooks, saved sessions, or MCP overrides", () => {
    const args = claudeInventoryArgs();
    expect(args).toContain("--setting-sources=user,project,local");
    expect(args).toContain("--no-session-persistence");
    expect(args).not.toContain("--strict-mcp-config");
    expect(args).not.toContain("--mcp-config");
    expect(JSON.parse(args[args.indexOf("--settings") + 1]!)).toEqual({
      disableAllHooks: true,
    });
  });
});

describe("Codex connection inventory", () => {
  it("maps mcpServerStatus rows", () => {
    expect(
      codexConnectionsFromStatus([
        {
          name: "codex_apps",
          runtimeStatus: null,
          authStatus: "bearerToken",
          tools: { "github.create_issue": {}, "figma.read": {} },
          toolsError: null,
          pluginId: null,
        },
        {
          name: "m5",
          runtimeStatus: null,
          authStatus: "bearerToken",
          tools: {},
          toolsError:
            "Environment variable M5_MCP_TOKEN for MCP server 'm5' is not set",
          pluginId: null,
        },
        {
          name: "notion",
          runtimeStatus: null,
          authStatus: "notLoggedIn",
          tools: {},
          toolsError: null,
          pluginId: null,
        },
        {
          name: "computer-use",
          runtimeStatus: null,
          authStatus: "unsupported",
          tools: {},
          toolsError: null,
          pluginId: null,
        },
        {
          name: "cua_repl",
          runtimeStatus: "connected",
          authStatus: "unsupported",
          tools: { a: {} },
          toolsError: null,
          pluginId: "unified-computer-use@openai-bundled",
        },
      ]),
    ).toEqual([
      {
        name: "notion",
        key: "notion",
        removable: true,
        canSignIn: true,
        state: "needs-sign-in",
      },
      {
        name: "m5",
        key: "m5",
        removable: true,
        state: "failed",
        detail:
          "Environment variable M5_MCP_TOKEN for MCP server 'm5' is not set",
      },
      {
        name: "ChatGPT apps",
        key: "codex_apps",
        state: "ready",
        source: "ChatGPT",
        account: true,
        toolCount: 2,
      },
      {
        name: "cua_repl",
        key: "cua_repl",
        state: "ready",
        source: "unified-computer-use plugin",
        plugin: "unified-computer-use",
        toolCount: 1,
      },
      {
        name: "computer-use",
        key: "computer-use",
        removable: true,
        state: "inactive",
      },
    ]);
  });

  it("reads which servers the user's config defines, how, and which are turned off", () => {
    const FILE = "/u/.codex/config.toml";
    const user = { name: { type: "user", file: FILE, profile: null } };
    const project = { name: { type: "project", dotCodexFolder: "/p/.codex" } };
    const text = [
      'model = "gpt-5"',
      "[mcp_servers.rea]",
      'command = "rea"',
      "[mcp_servers.quiet]",
      'command = "q"',
      "enabled = false",
      "[mcp_servers.gone]",
      'command = "g"',
      "enabled = false",
      "[mcp_servers]",
      "# work tools",
      'tools = { command = "t" }',
      'dotted.name = { command = "d" }',
      "",
    ].join("\n");
    const rows = codexConnectionsFromStatus(
      [
        { name: "rea", tools: { a: {} }, authStatus: "unsupported" },
        { name: "quiet", tools: {}, authStatus: "unsupported" },
        { name: "shared", tools: { a: {} }, authStatus: "unsupported" },
        { name: "tools", tools: { a: {} }, authStatus: "unsupported" },
        { name: "dotted.name", tools: { a: {} }, authStatus: "unsupported" },
        { name: "policy", tools: {}, authStatus: "unsupported" },
        {
          name: "figma",
          tools: { a: {} },
          authStatus: "oAuth",
          pluginId: "figma@openai-curated",
        },
      ],
      {
        mcp_servers: {
          rea: { command: "rea" },
          quiet: { command: "q", enabled: false },
          shared: { url: "https://x" },
          tools: { command: "t" },
          "dotted.name": { command: "d" },
          gone: { command: "g", enabled: false },
          policy: { command: "p", enabled: false },
        },
        origins: {
          "mcp_servers.rea.command": user,
          "mcp_servers.quiet.command": user,
          "mcp_servers.shared.url": project,
          "mcp_servers.tools.command": user,
          "mcp_servers.dotted.name.command": user,
          "mcp_servers.gone.command": user,
          "mcp_servers.policy.command": project,
          "mcp_servers.policy.enabled": project,
        },
        userFile: { path: FILE, text },
      },
    );
    const row = (key: string) => rows.find((item) => item.key === key)!;
    expect(row("rea")).toMatchObject({
      state: "ready",
      source: "Personal",
      canTurnOff: true,
    });
    expect(row("quiet")).toMatchObject({ state: "off", canTurnOff: true });
    expect(row("quiet").offNote).toBeUndefined();
    // Defined by a project's config: Aven would have to write elsewhere.
    expect(row("shared").canTurnOff).toBeUndefined();
    // An inline table: Codex's writer would rewrite it, or break the file.
    expect(row("tools")).toMatchObject({ source: "Personal", state: "ready" });
    expect(row("tools").canTurnOff).toBeUndefined();
    // Codex addresses keys by dots, so this name can't be targeted.
    expect(row("dotted.name").canTurnOff).toBeUndefined();
    expect(row("figma")).toMatchObject({
      plugin: "figma",
      source: "figma plugin",
    });
    expect(row("figma").canTurnOff).toBeUndefined();
    // Turned off where Aven doesn't write: no Turn on, but it says where.
    expect(row("policy")).toMatchObject({
      state: "off",
      offNote: "Turned off in this project’s .codex/config.toml.",
    });
    expect(row("policy").canTurnOff).toBeUndefined();
    // Turned off in the file but not listed by the app server.
    expect(row("gone")).toMatchObject({
      state: "off",
      removable: true,
      canTurnOff: true,
    });
    expect(rows.at(-1)!.state).toBe("off");
  });

  it("offers nothing to turn off when the user's file couldn't be read", () => {
    const [rea] = codexConnectionsFromStatus(
      [{ name: "rea", tools: { a: {} } }],
      {
        mcp_servers: { rea: { command: "rea" } },
        origins: {
          "mcp_servers.rea.command": {
            name: { type: "user", file: "/u/c.toml", profile: null },
          },
        },
        userFile: { path: "/u/c.toml" },
      },
    );
    expect(rea!.canTurnOff).toBeUndefined();
  });
});

describe("how a Codex server is written", () => {
  const forms = (text: string, key = "tools") => [
    ...codexEntryForms(text, key),
  ];

  it("tells its own table and dotted keys from an inline table", () => {
    expect(
      forms('# work tools\n[mcp_servers.tools] # note\ncommand = "x"\n'),
    ).toEqual(["table"]);
    expect(forms('[mcp_servers."tools"]\ncommand = "x"\n')).toEqual(["table"]);
    expect(forms('[mcp_servers.tools.env]\nA = "1"\n')).toEqual(["table"]);
    expect(forms('mcp_servers.tools.command = "x"\n')).toEqual(["dotted"]);
    expect(forms('[mcp_servers]\ntools.command = "x"\n')).toEqual(["dotted"]);
    expect(forms('[mcp_servers]\n# c\ntools = { command = "x" }\n')).toEqual([
      "inline",
    ]);
    expect(forms('mcp_servers.tools = { command = "x" }\n')).toEqual([
      "inline",
    ]);
    expect(forms('[mcp_servers.other]\ncommand = "x"\n')).toEqual([]);
  });

  it("isn't fooled by multi-line strings and arrays", () => {
    const text = [
      'instructions = """',
      "[mcp_servers.tools]",
      'tools = { command = "x" }',
      '"""',
      "[mcp_servers.rea]",
      "args = [",
      '  "tools = 1",',
      "]",
      "[mcp_servers.tools]",
      'command = "x"',
      "",
    ].join("\n");
    expect(forms(text)).toEqual(["table"]);
  });
});
