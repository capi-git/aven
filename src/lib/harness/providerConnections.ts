/**
 * Inventory of the MCP connections each provider loads from its own
 * configuration: what Claude Code and Codex say they will start for a task.
 * Changes go through the provider's own CLI (see mcpServers.ts).
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
  | "ready"
  | "needs-sign-in"
  | "failed"
  | "starting"
  | "inactive";

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
  /** Where the provider found it, e.g. "claude.ai", "Personal", "Plugin". */
  source?: string;
  toolCount?: number;
  detail?: string;
};

const PROBE_TIMEOUT_MS = 25_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Claude keeps connecting slow servers after init; re-ask until they settle. */
const CLAUDE_SETTLE_MS = 12_000;
const CLAUDE_POLL_MS = 1_500;

const CLAUDE_SCOPES: Record<string, string> = {
  claudeai: "claude.ai",
  user: "Personal",
  project: "Project",
  local: "Project (private)",
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

export function listClaudeConnections(cwd: string): Promise<ProviderConnection[]> {
  return once(`claude:${cwd}`, () => inventoryClaude(cwd));
}

export function listCodexConnections(cwd: string): Promise<ProviderConnection[]> {
  return once(`codex:${cwd}`, () => inventoryCodex(cwd));
}

async function inventoryClaude(cwd: string): Promise<ProviderConnection[]> {
  const { path } = await resolveClaudeBinary();
  const releaseBridge = await acquireHarnessBridge();
  // Unique per check: a shared id would let one check's cleanup kill another.
  const claudeProbeId = `aven-claude-connections-${crypto.randomUUID()}`;
  let requestSeq = 0;
  const waiters = new Map<
    string,
    { resolve: (payload: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();
  let exited: ((error: Error) => void) | null = null;
  const exit = new Promise<never>((_, reject) => {
    exited = reject;
  });
  exit.catch(() => undefined);

  const request = (body: Record<string, unknown>) => {
    const id = `aven_connections_${++requestSeq}`;
    const reply = new Promise<Record<string, unknown>>((resolve, reject) => {
      waiters.set(id, { resolve, reject });
    });
    void writeChild(
      claudeProbeId,
      JSON.stringify(buildControlRequest(id, body)),
    ).catch((error: unknown) => {
      waiters.get(id)?.reject(error instanceof Error ? error : new Error(String(error)));
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
      else waiter.reject(new Error(response.error ?? "Claude Code request failed"));
    },
    () => exited?.(new Error("Claude Code stopped before reporting connections")),
  );

  const stop = async () => {
    unwatchChild(claudeProbeId);
    await killChild(claudeProbeId).catch(() => undefined);
    releaseBridge();
  };

  try {
    await spawnChild(claudeProbeId, path, claudeInventoryArgs(), cwd);
    return await withTimeout(PROBE_TIMEOUT_MS, async () => {
      await request({ subtype: "initialize" });
      const started = Date.now();
      let rows = claudeConnectionsFromStatus(await request({ subtype: "mcp_status" }));
      while (
        rows.some((row) => row.state === "starting") &&
        Date.now() - started < CLAUDE_SETTLE_MS
      ) {
        await new Promise((resolve) => setTimeout(resolve, CLAUDE_POLL_MS));
        rows = claudeConnectionsFromStatus(await request({ subtype: "mcp_status" }));
      }
      return rows;
    });
  } finally {
    await stop();
  }
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
      const tools = Array.isArray(server.tools) ? server.tools.length : undefined;
      const error = stringField(server, "error");
      const state: ConnectionState =
        status === "connected"
          ? "ready"
          : status === "needs-auth"
            ? "needs-sign-in"
            : status === "failed"
              ? "failed"
              : status === "pending"
                ? "starting"
                : "inactive";
      const plugin = name.match(/^plugin:([^:]+):(.+)$/);
      const source = plugin
        ? `Plugin (${plugin[1]})`
        : scope
          ? CLAUDE_SCOPES[scope]
          : undefined;
      const editable =
        !plugin && (scope === "user" || scope === "project" || scope === "local");
      return [
        {
          name: plugin ? plugin[2]! : displayClaudeName(name, scope),
          key: name,
          ...(editable ? { scope, removable: true } : {}),
          ...(state === "needs-sign-in" ? { canSignIn: true } : {}),
          state,
          ...(source ? { source } : {}),
          ...(state === "ready" && tools !== undefined ? { toolCount: tools } : {}),
          ...(error ? { detail: error.trim() } : {}),
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

async function inventoryCodex(cwd: string): Promise<ProviderConnection[]> {
  const { path } = await resolveCodexBinary();
  const releaseBridge = await acquireHarnessBridge();
  const codexProbeId = `aven-codex-connections-${crypto.randomUUID()}`;
  const rpc = new JsonRpcClient(
    codexProbeId,
    {
      onRequest: (id) => {
        void rpc.respond(id, {}).catch(() => undefined);
      },
    },
    { includeJsonrpc: false, label: "codex-connections" },
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
    () => rpc.close(new Error("Codex stopped before reporting connections")),
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
      return codexConnectionsFromStatus(rows);
    });
  } finally {
    await stop();
  }
}

const CODEX_NAMES: Record<string, string> = {
  codex_apps: "ChatGPT apps",
};

export function codexConnectionsFromStatus(rows: unknown[]): ProviderConnection[] {
  return sortConnections(
    rows.flatMap((item) => {
      const server = asRecord(item);
      const name = stringField(server, "name");
      if (!server || !name) return [];
      const tools = Object.keys(asRecord(server.tools) ?? {}).length;
      const error = stringField(server, "toolsError");
      const auth = stringField(server, "authStatus");
      const runtime = stringField(server, "runtimeStatus");
      const plugin = stringField(server, "pluginId");
      const state: ConnectionState = error
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
      return [
        {
          name: CODEX_NAMES[name] ?? name,
          key: name,
          ...(!plugin && !builtIn ? { removable: true } : {}),
          ...(state === "needs-sign-in" && !builtIn ? { canSignIn: true } : {}),
          state,
          ...(plugin ? { source: "Plugin" } : {}),
          ...(state === "ready" ? { toolCount: tools } : {}),
          ...(error ? { detail: error.trim() } : {}),
        },
      ];
    }),
  );
}

// ---------------------------------------------------------------------------

const STATE_ORDER: Record<ConnectionState, number> = {
  "needs-sign-in": 0,
  failed: 1,
  starting: 2,
  ready: 3,
  inactive: 4,
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
      () => reject(new Error("The provider took too long to report its connections")),
      ms,
    );
    run().then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
