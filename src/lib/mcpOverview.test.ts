import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claudeConnectionsFromStatus,
  codexConnectionsFromStatus,
  type ProviderConnection,
} from "./harness/providerConnections";
import {
  buildMcpOverview,
  explainMcpProblem,
  mcpHiddenSetting,
  normalizeServerName,
  setMcpHidden,
  type McpInventory,
  type McpOverview,
  type McpRow,
} from "./mcpOverview";

/** The servers, states and errors in the user's screenshot of the page. */
const SCAPE =
  "ENOENT: no such file or directory, posix_spawn '/Users/me/Library/Application Support/Scape/bin/ScapeMCPServer'";
const NO_URL = "No URL configured for this server";
const tools = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `t${i}` }));

const CLAUDE_STATUS = {
  mcpServers: [
    { name: "plugin:design:atlassian", status: "needs-auth", scope: "dynamic" },
    { name: "claude.ai Figma", status: "needs-auth", scope: "claudeai" },
    { name: "claude.ai Gmail", status: "needs-auth", scope: "claudeai" },
    {
      name: "claude.ai Google Calendar",
      status: "needs-auth",
      scope: "claudeai",
    },
    { name: "claude.ai Google Drive", status: "needs-auth", scope: "claudeai" },
    { name: "plugin:design:intercom", status: "needs-auth", scope: "dynamic" },
    { name: "plugin:design:linear", status: "needs-auth", scope: "dynamic" },
    { name: "plugin:design:slack", status: "needs-auth", scope: "dynamic" },
    {
      name: "plugin:supabase:supabase",
      status: "needs-auth",
      scope: "dynamic",
    },
    {
      name: "plugin:github:github",
      status: "failed",
      scope: "dynamic",
      error:
        "Error POSTing to endpoint: bad request: Authorization header is badly formatted",
    },
    {
      name: "plugin:design:gmail",
      status: "failed",
      scope: "dynamic",
      error: NO_URL,
    },
    {
      name: "plugin:design:google calendar",
      status: "failed",
      scope: "dynamic",
      error: NO_URL,
    },
    { name: "scape", status: "failed", scope: "user", error: SCAPE },
    {
      name: "claude.ai Claude Docs",
      status: "connected",
      scope: "claudeai",
      tools: tools(8),
    },
    {
      name: "claude.ai Excalidraw",
      status: "connected",
      scope: "claudeai",
      tools: tools(5),
    },
    {
      name: "claude.ai Notion",
      status: "connected",
      scope: "claudeai",
      tools: tools(66),
    },
    { name: "rea", status: "connected", scope: "user", tools: tools(170) },
    {
      name: "claude.ai Vercel",
      status: "connected",
      scope: "claudeai",
      tools: tools(244),
    },
  ],
};

const codexTools = (n: number) =>
  Object.fromEntries(tools(n).map((tool) => [tool.name, tool]));
const CODEX_STATUS = [
  { name: "codex_apps", tools: codexTools(823) },
  { name: "node_repl", tools: codexTools(4) },
  { name: "openaiDeveloperDocs", tools: codexTools(5) },
  { name: "rea", tools: codexTools(170) },
  { name: "computer-use", tools: {} },
].map((row) => ({
  authStatus: "unsupported",
  toolsError: null,
  pluginId: null,
  ...row,
}));
const user = { name: { type: "user", file: "/Users/me/.codex/config.toml" } };
const CODEX_CONFIG = {
  mcp_servers: {
    node_repl: { command: "node" },
    openaiDeveloperDocs: { url: "https://developers.openai.com/mcp" },
    rea: { command: "rea" },
    "computer-use": { command: "computer-use" },
  },
  origins: {
    "mcp_servers.node_repl.command": user,
    "mcp_servers.openaiDeveloperDocs.url": user,
    "mcp_servers.rea.command": user,
    "mcp_servers.computer-use.command": user,
  },
};

const loaded = (connections: ProviderConnection[]): McpInventory => ({
  status: "loaded",
  connections,
});

function screenshot(hidden: string[] = []): McpOverview {
  return buildMcpOverview(
    {
      claude: loaded(
        claudeConnectionsFromStatus(structuredClone(CLAUDE_STATUS)),
      ),
      codex: loaded(
        codexConnectionsFromStatus(structuredClone(CODEX_STATUS), CODEX_CONFIG),
      ),
    },
    hidden,
  );
}

const names = (rows: McpRow[]) => rows.map((row) => row.name);
const row = (overview: McpOverview, name: string) =>
  [
    ...overview.needsYou,
    ...overview.signIn,
    ...overview.working,
    ...overview.off,
  ].find((item) => item.name === name)!;

describe("grouping by what needs doing", () => {
  it("puts broken servers first, then sign-ins, then what works", () => {
    const overview = screenshot();
    expect(names(overview.needsYou)).toEqual(["GitHub", "scape"]);
    expect(names(overview.signIn)).toEqual([
      "Atlassian",
      "Figma",
      "Gmail",
      "Google Calendar",
      "Google Drive",
      "Intercom",
      "Linear",
      "Slack",
      "Supabase",
    ]);
    expect(names(overview.working)).toEqual([
      "ChatGPT apps",
      "Claude Docs",
      "computer-use",
      "Excalidraw",
      "node_repl",
      "Notion",
      "openaiDeveloperDocs",
      "rea",
      "Vercel",
    ]);
    expect(overview.off).toEqual([]);
    expect(overview.accountConnectors).toEqual(["claude", "codex"]);
    expect(overview.empty).toBe(false);
  });

  it("shows a server both agents load once, with both agents and its tools", () => {
    const rea = row(screenshot(), "rea");
    expect(rea.entries.map((entry) => entry.id)).toEqual([
      "claude:rea",
      "codex:rea",
    ]);
    expect(rea.context).toBe("Personal · Claude · Codex · 170 tools");
    expect(rea.status).toBe("Connected");
  });

  it("names each row's source and agent, and the tools only when connected", () => {
    const overview = screenshot();
    expect(row(overview, "Vercel").context).toBe(
      "claude.ai · Claude · 244 tools",
    );
    expect(row(overview, "ChatGPT apps").context).toBe(
      "ChatGPT · Codex · 823 tools",
    );
    expect(row(overview, "Atlassian").context).toBe("design plugin · Claude");
    expect(row(overview, "computer-use")).toMatchObject({
      context: "Personal · Codex",
      status: "No tools",
    });
  });

  it("takes the most urgent state when the agents disagree", () => {
    const overview = buildMcpOverview({
      claude: loaded([
        { name: "rea", key: "rea", state: "ready", toolCount: 3 },
      ]),
      codex: loaded([
        {
          name: "rea",
          key: "rea",
          state: "failed",
          detail: "request timed out",
        },
      ]),
    });
    expect(overview.working).toEqual([]);
    expect(overview.needsYou[0]).toMatchObject({
      name: "rea",
      problem: { kind: "no-answer", text: "Codex: Didn’t answer." },
      details: ["Codex: request timed out"],
    });
  });

  it("lists an agent Aven couldn't check as needing you, first", () => {
    const overview = buildMcpOverview({
      claude: {
        status: "error",
        message: "Claude Code stopped before it answered",
      },
      codex: { status: "loading" },
    });
    expect(overview.needsYou).toEqual([
      expect.objectContaining({
        id: "agent:claude",
        agent: "claude",
        primary: { kind: "check", label: "Check again" },
        details: ["Claude Code stopped before it answered"],
      }),
    ]);
    expect(overview.checking).toEqual(["codex"]);
    expect(overview.empty).toBe(false);
  });

  it("is empty only when every agent answered with no servers", () => {
    expect(
      buildMcpOverview({ claude: loaded([]), codex: loaded([]) }).empty,
    ).toBe(true);
    expect(
      buildMcpOverview({ claude: loaded([]), codex: { status: "loading" } })
        .empty,
    ).toBe(false);
  });
});

describe("duplicates", () => {
  it("folds a plugin's copy with no address into the connector that works", () => {
    const overview = screenshot();
    const gmail = row(overview, "Gmail");
    expect(gmail.state).toBe("needs-sign-in");
    expect(gmail.entries.map((entry) => entry.id)).toEqual([
      "claude:claude.ai Gmail",
    ]);
    expect(gmail.copies.map((entry) => entry.id)).toEqual([
      "claude:plugin:design:gmail",
    ]);
    expect(gmail.note).toBe(
      "Claude uses the claude.ai one; the design plugin’s copy has no address.",
    );
    expect(row(overview, "Google Calendar").copies).toHaveLength(1);
    // Neither copy is a broken server of its own.
    expect(names(overview.needsYou)).not.toContain("gmail");
  });

  it("matches names however they are written", () => {
    expect(normalizeServerName("Google Calendar")).toBe(
      normalizeServerName("google_calendar"),
    );
    expect(normalizeServerName("google-calendar")).toBe("googlecalendar");
  });

  it("keeps a copy with no address as a problem when nothing else works", () => {
    const overview = buildMcpOverview({
      claude: loaded([
        {
          name: "gmail",
          key: "plugin:design:gmail",
          state: "failed",
          plugin: "design",
          source: "design plugin",
          detail: NO_URL,
          canTurnOff: true,
        },
      ]),
      codex: loaded([]),
    });
    expect(overview.needsYou[0]).toMatchObject({
      name: "Gmail",
      copies: [],
      problem: { kind: "no-address", text: "This entry has no address." },
      primary: { kind: "turn-off" },
    });
  });
});

describe("plain-language errors", () => {
  const failed = (detail: string, extra: Partial<ProviderConnection> = {}) =>
    explainMcpProblem("scape", {
      name: "scape",
      key: "scape",
      state: "failed",
      detail,
      ...extra,
    });

  it("names a missing program", () => {
    expect(failed(SCAPE)).toEqual({
      kind: "missing-program",
      text: "Scape’s program isn’t on this Mac anymore.",
    });
  });

  it("says a sign-in is broken, with the fix that applies", () => {
    expect(
      explainMcpProblem("GitHub", {
        name: "github",
        key: "plugin:github:github",
        state: "failed",
        detail:
          "Error POSTing to endpoint: bad request: Authorization header is badly formatted",
      }),
    ).toEqual({
      kind: "sign-in-broken",
      text: "GitHub’s sign-in is broken. Put a new token in GITHUB_PERSONAL_ACCESS_TOKEN, then check again.",
    });
    expect(failed("HTTP 401 Unauthorized", { canSignIn: true }).text).toBe(
      "Scape’s sign-in is broken. Sign in again.",
    );
    expect(failed("invalid_token").text).toBe(
      "Scape’s sign-in is broken. Give it a new token, then check again.",
    );
    expect(
      failed("rejected", { errorCode: "CLAUDEAI_BEARER_REJECTED" }).kind,
    ).toBe("sign-in-broken");
  });

  it("covers a missing address, a timeout and anything else", () => {
    expect(failed(NO_URL)).toEqual({
      kind: "no-address",
      text: "This entry has no address.",
    });
    expect(failed("MCP startup failed: request timed out after 30s")).toEqual({
      kind: "no-answer",
      text: "Didn’t answer.",
    });
    expect(
      failed("handshaking with MCP server failed: connection closed"),
    ).toEqual({
      kind: "unknown",
      text: "Couldn’t start.",
    });
  });

  it("keeps the agent's own words for Details", () => {
    expect(row(screenshot(), "scape").details).toEqual([SCAPE]);
  });
});

describe("actions per state", () => {
  it("offers the fix first", () => {
    const overview = screenshot();
    expect(row(overview, "scape")).toMatchObject({
      primary: { kind: "remove", label: "Remove" },
      more: [{ kind: "turn-off", label: "Turn off" }],
    });
    expect(row(overview, "GitHub")).toMatchObject({
      primary: { kind: "check", label: "Check again" },
      more: [{ kind: "turn-off", label: "Turn off" }],
    });
    expect(row(overview, "Slack")).toMatchObject({
      primary: { kind: "sign-in", label: "Sign in" },
      more: [{ kind: "turn-off", label: "Turn off" }],
    });
  });

  it("turns off where the agent can, hides in Aven where it can't, and removes personal servers", () => {
    const overview = screenshot();
    expect(row(overview, "rea")).toMatchObject({
      primary: { kind: "turn-off" },
      more: [{ kind: "remove" }],
    });
    // ChatGPT apps come with the Codex account: no switch, no removing.
    expect(row(overview, "ChatGPT apps")).toMatchObject({
      primary: { kind: "hide", label: "Hide" },
      more: [],
    });
    expect(row(overview, "Notion")).toMatchObject({
      primary: { kind: "turn-off" },
      more: [],
    });
  });

  it("turns a turned-off server back on, and offers the half that is off", () => {
    const claude = claudeConnectionsFromStatus(
      structuredClone(CLAUDE_STATUS),
    ).map((connection) =>
      connection.key === "plugin:design:slack" || connection.key === "rea"
        ? { ...connection, state: "off" as const, toolCount: undefined }
        : connection,
    );
    const overview = buildMcpOverview({
      claude: loaded(claude),
      codex: loaded(
        codexConnectionsFromStatus(structuredClone(CODEX_STATUS), CODEX_CONFIG),
      ),
    });
    expect(row(overview, "Slack")).toMatchObject({
      state: "off",
      status: "Off",
      context: "design plugin · Claude",
      primary: { kind: "turn-on", label: "Turn on" },
      more: [],
    });
    expect(overview.off.map((item) => item.name)).toEqual(["Slack"]);
    // rea still works in Codex; the row says Claude has it off.
    expect(row(overview, "rea")).toMatchObject({
      state: "ready",
      context: "Personal · Codex · 170 tools · off in Claude",
      more: [
        { kind: "remove" },
        { kind: "turn-on", label: "Turn on in Claude" },
      ],
    });
  });
});

describe("hidden servers", () => {
  // Some Node versions give tests a working localStorage and some do not.
  beforeEach(() => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists hidden servers apart, each with Show", () => {
    const overview = screenshot([
      "codex:codex_apps",
      "claude:plugin:design:gmail",
    ]);
    expect(names(overview.working)).not.toContain("ChatGPT apps");
    // The hidden copy no longer shows on Gmail's row.
    expect(row(overview, "Gmail").copies).toEqual([]);
    expect(row(overview, "Gmail").note).toBeUndefined();
    expect(
      overview.off.map(({ id, name, state, status, context, primary }) => ({
        id,
        name,
        state,
        status,
        context,
        primary,
      })),
    ).toEqual([
      {
        id: "hidden:chatgptapps",
        name: "ChatGPT apps",
        state: "hidden",
        status: "Hidden",
        context: "ChatGPT · Codex",
        primary: { kind: "show", label: "Show" },
      },
      {
        id: "hidden:gmail",
        name: "Gmail",
        state: "hidden",
        status: "Hidden",
        context: "design plugin · Claude",
        primary: { kind: "show", label: "Show" },
      },
    ]);
  });

  it("stores hidden ids under an aven key and reads the same list back", () => {
    setMcpHidden(["codex:codex_apps", "claude:x"], true);
    expect(localStorage.getItem("aven.mcpHidden")).toBe(
      JSON.stringify(["claude:x", "codex:codex_apps"]),
    );
    const first = mcpHiddenSetting.load();
    expect(mcpHiddenSetting.load()).toBe(first);
    setMcpHidden(["claude:x"], false);
    expect(mcpHiddenSetting.load()).toEqual(["codex:codex_apps"]);
    localStorage.setItem("aven.mcpHidden", "not json");
    expect(mcpHiddenSetting.load()).toEqual([]);
  });
});
