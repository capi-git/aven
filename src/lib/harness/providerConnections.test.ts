import { describe, expect, it } from "vitest";
import {
  claudeConnectionsFromStatus,
  claudeInventoryArgs,
  codexConnectionsFromStatus,
} from "./providerConnections";

describe("Claude connection inventory", () => {
  it("maps mcp_status rows, putting problems first", () => {
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
      },
      {
        name: "slack",
        key: "plugin:design:slack",
        canSignIn: true,
        state: "needs-sign-in",
        source: "Plugin (design)",
      },
      {
        name: "scape",
        key: "scape",
        scope: "user",
        removable: true,
        state: "failed",
        source: "Personal",
        detail: "ENOENT: no such file",
      },
      { name: "linear", key: "linear", state: "starting", source: "Plugin" },
      {
        name: "Vercel",
        key: "claude.ai Vercel",
        state: "ready",
        source: "claude.ai",
        toolCount: 2,
      },
      {
        name: "old",
        key: "old",
        scope: "local",
        removable: true,
        state: "inactive",
        source: "Project (private)",
      },
    ]);
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
      { name: "ChatGPT apps", key: "codex_apps", state: "ready", toolCount: 2 },
      {
        name: "cua_repl",
        key: "cua_repl",
        state: "ready",
        source: "Plugin",
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
});
