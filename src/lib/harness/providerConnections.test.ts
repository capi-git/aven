import { describe, expect, it } from "vitest";
import {
  claudeConnectionsFromStatus,
  claudeInventoryArgs,
  codexConnectionsFromStatus,
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

  it("reads which servers the user's config defines and which are turned off", () => {
    const user = { name: { type: "user", file: "/u/.codex/config.toml" } };
    const project = {
      name: { type: "project", file: "/p/.codex/config.toml" },
    };
    const rows = codexConnectionsFromStatus(
      [
        { name: "rea", tools: { a: {} }, authStatus: "unsupported" },
        { name: "quiet", tools: {}, authStatus: "unsupported" },
        { name: "shared", tools: { a: {} }, authStatus: "unsupported" },
        { name: "dotted.name", tools: { a: {} }, authStatus: "unsupported" },
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
          "dotted.name": { command: "d" },
          gone: { command: "g", enabled: false },
        },
        origins: {
          "mcp_servers.rea.command": user,
          "mcp_servers.quiet.command": user,
          "mcp_servers.shared.url": project,
          "mcp_servers.dotted.name.command": user,
          "mcp_servers.gone.command": user,
        },
      },
    );
    const row = (key: string) => rows.find((item) => item.key === key)!;
    expect(row("rea")).toMatchObject({
      state: "ready",
      source: "Personal",
      canTurnOff: true,
    });
    expect(row("quiet")).toMatchObject({ state: "off", canTurnOff: true });
    // Defined by a project's config: Aven would have to write elsewhere.
    expect(row("shared").canTurnOff).toBeUndefined();
    // Codex addresses keys by dots, so this name can't be targeted.
    expect(row("dotted.name").canTurnOff).toBeUndefined();
    expect(row("figma")).toMatchObject({
      plugin: "figma",
      source: "figma plugin",
    });
    expect(row("figma").canTurnOff).toBeUndefined();
    // Turned off in the file but not listed by the app server.
    expect(row("gone")).toMatchObject({
      state: "off",
      removable: true,
      canTurnOff: true,
    });
    expect(rows.at(-1)!.state).toBe("off");
  });
});
