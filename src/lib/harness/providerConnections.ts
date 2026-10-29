/**
 * Inventory of the MCP connections each provider loads from its own
 * configuration: what Claude Code and Codex say they will start for a task.
 * Adding, removing and signing in go through the provider's own CLI (see
 * mcpServers.ts); turning a server off and on goes through the provider's own
 * protocol, which writes only that server's entry.
 */
import {
  acquireHarnessBridge,
  killChild,
  resolveClaudeBinary,
  resolveCodexBinary,
  spawnChild,
  unwatchChild,
  watchChild,
  writeChild,
} from "./child";
import {
  CLAUDE_SETTING_SOURCES,
  buildControlRequest,
  parseControlResponse,
  parseJsonLine,
} from "./claudeProtocol";
import { asRecord, stringField } from "./codexProtocol";
import { JsonRpcClient } from "./jsonRpc";

export type ConnectionState =
  "ready" | "needs-sign-in" | "failed" | "starting" | "inactive" | "off";

export type ProviderConnection = {
  name: string;
  /** The provider's own name for the server, used to manage it. */
  key: string;
  /** Claude scope to remove it from; absent when the provider owns the entry. */
  scope?: "user" | "project" | "local";
  /** Configured by the user rather than an account, plugin, or policy. */
  removable?: boolean;
  /** The provider can run its own sign-in for this server. */
  canSignIn?: boolean;
  state: ConnectionState;
  /** Where the provider found it, e.g. "claude.ai", "Personal", "design plugin". */
  source?: string;
  /** The plugin that supplies it, e.g. "design". */
  plugin?: string;
  /** Comes with the account: a claude.ai connector or ChatGPT apps. */
  account?: boolean;
  /**
   * The provider can turn it off and on again itself. Claude Code does this
   * per project; Codex in its own config file, for every project.
   */
  canTurnOff?: boolean;
  toolCount?: number;
  detail?: string;
  /** Claude Code's own reason for a failure, when it gives one. */
  errorCode?: string;
};

const PROBE_TIMEOUT_MS = 25_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** How long Claude may take to save a change and exit after its session ends. */
const SAVE_WAIT_MS = 5_000;
/** Claude keeps connecting slow servers after init; re-ask until they settle. */
const CLAUDE_SETTLE_MS = 12_000;
const CLAUDE_POLL_MS = 1_500;

const CLAUDE_SCOPES: Record<string, string> = {
  claudeai: "claude.ai",
  user: "Personal",
  project: "Project",
  local: "Project, just you",
  plugin: "Plugin",
  managed: "Managed",
  enterprise: "Managed",
};

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

/** One check per provider and folder at a time; repeat callers share it. */
const inflight = new Map<string, Promise<ProviderConnection[]>>();

function once(
  key: string,
  run: () => Promise<ProviderConnection[]>,
): Promise<ProviderConnection[]> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const next = run().finally(() => inflight.delete(key));
  inflight.set(key, next);
  return next;
}

export function listClaudeConnections(
  cwd: string,
): Promise<ProviderConnection[]> {
  return once(`claude:${cwd}`, () => inventoryClaude(cwd));
}

export function listCodexConnections(
  cwd: string,
): Promise<ProviderConnection[]> {
  return once(`codex:${cwd}`, () => inventoryCodex(cwd));
}

type ClaudeRequest = (
  body: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/**
 * Starts Claude Code for its control protocol alone (no prompt, no saved
 * session), initializes it, runs `work`, and always stops it.
 */
async function withClaudeControl<T>(
  cwd: string,
  purpose: string,
  work: (request: ClaudeRequest) => Promise<T>,
  { saves = false }: { saves?: boolean } = {},
): Promise<T> {
  const { path } = await resolveClaudeBinary();
  const releaseBridge = await acquireHarnessBridge();
  // Unique per run: a shared id would let one run's cleanup kill another.
  const claudeProbeId = `aven-claude-${purpose}-${crypto.randomUUID()}`;
  let requestSeq = 0;
  const waiters = new Map<
    string,
    {
      resolve: (payload: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >();
  let exited: ((error: Error) => void) | null = null;
  const exit = new Promise<never>((_, reject) => {
    exited = reject;
  });
  exit.catch(() => undefined);
  const ended = exit.catch(() => undefined);

  const request: ClaudeRequest = (body) => {
    const id = `aven_connections_${++requestSeq}`;
    const reply = new Promise<Record<string, unknown>>((resolve, reject) => {
      waiters.set(id, { resolve, reject });
    });
    void writeChild(
      claudeProbeId,
      JSON.stringify(buildControlRequest(id, body)),
    ).catch((error: unknown) => {
      waiters
        .get(id)
        ?.reject(error instanceof Error ? error : new Error(String(error)));
    });
    return Promise.race([reply, exit]);
  };

  watchChild(
    claudeProbeId,
    (line) => {
      const rec = parseJsonLine(line);
      if (!rec) return;
      const response = parseControlResponse(rec);
      if (!response) return;
      const waiter = waiters.get(response.requestId);
      if (!waiter) return;
      waiters.delete(response.requestId);
      if (response.ok) waiter.resolve(response.payload ?? {});
      else
        waiter.reject(
          new Error(response.error ?? "Claude Code request failed"),
        );
    },
    () => exited?.(new Error("Claude Code stopped before it answered")),
  );

  const stop = async () => {
    unwatchChild(claudeProbeId);
    await killChild(claudeProbeId).catch(() => undefined);
    releaseBridge();
  };

  try {
    await spawnChild(claudeProbeId, path, claudeInventoryArgs(), cwd);
    const result = await withTimeout(PROBE_TIMEOUT_MS, async () => {
      await request({ subtype: "initialize" });
      return work(request);
    });
    if (saves) {
      // Claude answers before its settings file is written. Ending the
      // session lets it finish writing and exit on its own.
      void writeChild(
        claudeProbeId,
        JSON.stringify(
          buildControlRequest(`aven_connections_end`, {
            subtype: "end_session",
          }),
        ),
      ).catch(() => undefined);
      await Promise.race([
        ended,
        new Promise((resolve) => setTimeout(resolve, SAVE_WAIT_MS)),
      ]);
    }
    return result;
  } finally {
    await stop();
  }
}

function inventoryClaude(cwd: string): Promise<ProviderConnection[]> {
  return withClaudeControl(cwd, "connections", async (request) => {
    const started = Date.now();
    let rows = claudeConnectionsFromStatus(
      await request({ subtype: "mcp_status" }),
    );
    while (
      rows.some((row) => row.state === "starting") &&
      Date.now() - started < CLAUDE_SETTLE_MS
    ) {
      await new Promise((resolve) => setTimeout(resolve, CLAUDE_POLL_MS));
      rows = claudeConnectionsFromStatus(
        await request({ subtype: "mcp_status" }),
      );
    }
    return rows;
  });
}

/**
 * Turns one server off or on with Claude Code's own toggle, the one `/mcp`
 * uses. Claude saves the choice for the project in `cwd` only, in that
 * project's entry of its own settings.
 */
export function setClaudeServerEnabled(
  cwd: string,
  key: string,
  enabled: boolean,
): Promise<void> {
  return withClaudeControl(
    cwd,
    "toggle",
    async (request) => {
      try {
        await request({ subtype: "mcp_toggle", serverName: key, enabled });
      } catch (error) {
        // Turning a server on saves the choice first and then starts it, so a
        // server that fails to start is still on; the next check shows why.
        if (!enabled) throw error;
        const rows = claudeConnectionsFromStatus(
          await request({ subtype: "mcp_status" }),
        );
        const row = rows.find((candidate) => candidate.key === key);
        if (!row || row.state === "off") throw error;
      }
    },
    { saves: true },
  );
}

/** The user's normal settings, without hooks, a saved session, or a prompt. */
export function claudeInventoryArgs(): string[] {
  return [
    "--output-format",
    "stream-json",
    "--verbose",
    "--input-format",
    "stream-json",
    `--setting-sources=${CLAUDE_SETTING_SOURCES}`,
    "--settings",
    JSON.stringify({ disableAllHooks: true }),
    "--no-session-persistence",
  ];
}

export function claudeConnectionsFromStatus(
  payload: Record<string, unknown>,
): ProviderConnection[] {
  const servers = Array.isArray(payload.mcpServers) ? payload.mcpServers : [];
  return sortConnections(
    servers.flatMap((item) => {
      const server = asRecord(item);
      const name = stringField(server, "name");
      if (!server || !name) return [];
      const status = stringField(server, "status");
      const scope = stringField(server, "scope");
      const tools = Array.isArray(server.tools)
        ? server.tools.length
        : undefined;
      const error = stringField(server, "error");
      const errorCode = stringField(server, "error_code");
      const state: ConnectionState =
        status === "connected"
          ? "ready"
          : status === "needs-auth"
            ? "needs-sign-in"
            : status === "failed"
              ? "failed"
              : status === "pending"
                ? "starting"
                : status === "disabled"
                  ? "off"
                  : "inactive";
      const plugin = name.match(/^plugin:([^:]+):(.+)$/);
      const source = plugin
        ? `${plugin[1]} plugin`
        : scope
          ? CLAUDE_SCOPES[scope]
          : undefined;
      const editable =
        !plugin &&
        (scope === "user" || scope === "project" || scope === "local");
      // Policy servers stay as the administrator set them, and servers an
      // app registers in its own process are that app's to manage.
      const managed = scope === "managed" || scope === "enterprise";
      const canTurnOff = !managed && stringField(server, "source") !== "sdk";
      return [
        {
          name: plugin ? plugin[2]! : displayClaudeName(name, scope),
          key: name,
          ...(editable ? { scope, removable: true } : {}),
          ...(state === "needs-sign-in" ? { canSignIn: true } : {}),
          state,
          ...(source ? { source } : {}),
          ...(plugin ? { plugin: plugin[1]! } : {}),
          ...(scope === "claudeai" ? { account: true } : {}),
          ...(canTurnOff ? { canTurnOff: true } : {}),
          ...(state === "ready" && tools !== undefined
            ? { toolCount: tools }
            : {}),
          ...(error ? { detail: error.trim() } : {}),
          ...(errorCode ? { errorCode } : {}),
        },
      ];
    }),
  );
}

function displayClaudeName(name: string, scope?: string): string {
  // claude.ai connectors are reported as "claude.ai Gmail".
  if (scope === "claudeai") return name.replace(/^claude\.ai\s+/i, "");
  return name;
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

/**
 * Starts Codex's app server alone, initializes it, runs `work`, and always
 * stops it.
 */
async function withCodexAppServer<T>(
  cwd: string,
  purpose: string,
  work: (rpc: JsonRpcClient) => Promise<T>,
): Promise<T> {
  const { path } = await resolveCodexBinary();
  const releaseBridge = await acquireHarnessBridge();
  const codexProbeId = `aven-codex-${purpose}-${crypto.randomUUID()}`;
  const rpc = new JsonRpcClient(
    codexProbeId,
    {
      onRequest: (id) => {
        void rpc.respond(id, {}).catch(() => undefined);
      },
    },
    { includeJsonrpc: false, label: `codex-${purpose}` },
  );
  const stop = async () => {
    rpc.close();
    unwatchChild(codexProbeId);
    await killChild(codexProbeId).catch(() => undefined);
    releaseBridge();
  };
  watchChild(
    codexProbeId,
    (line) => rpc.pushLine(line),
    () => rpc.close(new Error("Codex stopped before it answered")),
  );

  try {
    await spawnChild(codexProbeId, path, ["app-server"], cwd);
    return await withTimeout(PROBE_TIMEOUT_MS, async () => {
      await rpc.request(
        "initialize",
        {
          clientInfo: { name: "aven", title: "Aven", version: "0.1.0" },
          capabilities: { experimentalApi: true },
        },
        REQUEST_TIMEOUT_MS,
      );
      await rpc.notify("initialized", undefined);
      return work(rpc);
    });
  } finally {
    await stop();
  }
}

function inventoryCodex(cwd: string): Promise<ProviderConnection[]> {
  return withCodexAppServer(cwd, "connections", async (rpc) => {
    const rows: unknown[] = [];
    let cursor: string | null = null;
    do {
      const page: { data?: unknown[]; nextCursor?: string | null } =
        await rpc.request(
          "mcpServerStatus/list",
          { detail: "toolsAndAuthOnly", ...(cursor ? { cursor } : {}) },
          REQUEST_TIMEOUT_MS,
        );
      rows.push(...(Array.isArray(page.data) ? page.data : []));
      cursor = page.nextCursor ?? null;
    } while (cursor);
    // Which servers are turned off, and which ones the user's own config file
    // defines. Without it the list still shows, just without Turn off.
    const config = await rpc
      .request<unknown>("config/read", { cwd }, REQUEST_TIMEOUT_MS)
      .then(codexMcpConfig, () => undefined);
    return codexConnectionsFromStatus(rows, config);
  });
}

/** What Codex's config/read says about MCP servers. */
export type CodexMcpConfig = {
  mcp_servers?: Record<string, unknown>;
  /** Where each effective key came from, by dotted key path. */
  origins?: Record<string, unknown>;
};

export function codexMcpConfig(response: unknown): CodexMcpConfig {
  const read = asRecord(response);
  return {
    mcp_servers: asRecord(asRecord(read?.config)?.mcp_servers) ?? {},
    origins: asRecord(read?.origins) ?? {},
  };
}

/** Codex splits key paths on dots, so only these names can be addressed. */
const CODEX_KEY_RE = /^[A-Za-z0-9_-]+$/;

/** The server is defined in the user's own config file, not a project's. */
function inUserCodexConfig(config: CodexMcpConfig, name: string): boolean {
  return ["command", "url"].some((field) => {
    const origin = asRecord(config.origins?.[`mcp_servers.${name}.${field}`]);
    return stringField(asRecord(origin?.name), "type") === "user";
  });
}

/**
 * Turns one server off or on in Codex's own config file, through Codex's own
 * config writer: off sets `enabled = false` on that server's entry, and on
 * removes the key again, so the file ends as it started.
 */
export function setCodexServerEnabled(
  cwd: string,
  key: string,
  enabled: boolean,
): Promise<{ note?: string }> {
  if (!CODEX_KEY_RE.test(key))
    return Promise.reject(new Error("Codex can't turn this server off."));
  return withCodexAppServer(cwd, "toggle", async (rpc) => {
    const written = asRecord(
      await rpc.request<unknown>(
        "config/value/write",
        {
          keyPath: `mcp_servers.${key}.enabled`,
          value: enabled ? null : false,
          mergeStrategy: "replace",
        },
        REQUEST_TIMEOUT_MS,
      ),
    );
    // Saved, but a project's or an administrator's setting wins over it.
    const overridden = stringField(
      asRecord(written?.overriddenMetadata),
      "message",
    );
    return stringField(written, "status") === "okOverridden"
      ? { note: overridden ?? "Another Codex setting overrides this one." }
      : {};
  });
}

const CODEX_NAMES: Record<string, string> = {
  codex_apps: "ChatGPT apps",
};

export function codexConnectionsFromStatus(
  rows: unknown[],
  config?: CodexMcpConfig,
): ProviderConnection[] {
  const listed = new Set<string>();
  const connections = rows.flatMap((item): ProviderConnection[] => {
    const server = asRecord(item);
    const name = stringField(server, "name");
    if (!server || !name) return [];
    listed.add(name);
    const tools = Object.keys(asRecord(server.tools) ?? {}).length;
    const error = stringField(server, "toolsError");
    const auth = stringField(server, "authStatus");
    const runtime = stringField(server, "runtimeStatus");
    const plugin = stringField(server, "pluginId");
    const entry = asRecord(config?.mcp_servers?.[name]);
    const state: ConnectionState =
      entry?.enabled === false || runtime === "disabled"
        ? "off"
        : error
          ? "failed"
          : auth === "notLoggedIn" || runtime === "authenticationRequired"
            ? "needs-sign-in"
            : runtime === "failed"
              ? "failed"
              : tools > 0
                ? "ready"
                : "inactive";
    // ChatGPT apps follow the Codex account sign-in, not an MCP login.
    const builtIn = name in CODEX_NAMES;
    const personal = !!config && inUserCodexConfig(config, name);
    const pluginName = plugin?.split("@")[0];
    const source = builtIn
      ? "ChatGPT"
      : pluginName
        ? `${pluginName} plugin`
        : personal
          ? "Personal"
          : undefined;
    return [
      {
        name: CODEX_NAMES[name] ?? name,
        key: name,
        ...(!plugin && !builtIn ? { removable: true } : {}),
        ...(state === "needs-sign-in" && !builtIn ? { canSignIn: true } : {}),
        state,
        ...(source ? { source } : {}),
        ...(pluginName ? { plugin: pluginName } : {}),
        ...(builtIn ? { account: true } : {}),
        ...(personal && !plugin && !builtIn && CODEX_KEY_RE.test(name)
          ? { canTurnOff: true }
          : {}),
        ...(state === "ready" ? { toolCount: tools } : {}),
        ...(error && state !== "off" ? { detail: error.trim() } : {}),
      },
    ];
  });
  // A server turned off in the config file may not be listed at all.
  for (const [name, value] of Object.entries(config?.mcp_servers ?? {})) {
    if (listed.has(name) || asRecord(value)?.enabled !== false) continue;
    const personal = inUserCodexConfig(config!, name);
    connections.push({
      name,
      key: name,
      removable: true,
      state: "off",
      ...(personal ? { source: "Personal" } : {}),
      ...(personal && CODEX_KEY_RE.test(name) ? { canTurnOff: true } : {}),
    });
  }
  return sortConnections(connections);
}

// ---------------------------------------------------------------------------

const STATE_ORDER: Record<ConnectionState, number> = {
  "needs-sign-in": 0,
  failed: 1,
  starting: 2,
  ready: 3,
  inactive: 4,
  off: 5,
};

function sortConnections(rows: ProviderConnection[]): ProviderConnection[] {
  return rows.sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      a.name.localeCompare(b.name),
  );
}

function withTimeout<T>(ms: number, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The provider took too long to answer")),
      ms,
    );
    run()
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}
