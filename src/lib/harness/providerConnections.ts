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
import { errorText } from "../errors";

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
  /** Where a server is turned off, when Aven can't turn it on itself. */
  offNote?: string;
};

/** The provider's CLI isn't installed: there is nothing of its to check. */
export class ProviderNotInstalledError extends Error {}

/** The provider's CLI, or a `ProviderNotInstalledError` saying it has none. */
async function installedBinary(
  resolve: () => Promise<{ path: string }>,
): Promise<{ path: string }> {
  try {
    return await resolve();
  } catch (error) {
    throw new ProviderNotInstalledError(errorText(error));
  }
}

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
  const { path } = await installedBinary(resolveClaudeBinary);
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
  const { path } = await installedBinary(resolveCodexBinary);
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
    // defines and how. Without it the list still shows, just without Turn off.
    const config = await readCodexMcpConfig(rpc, cwd).catch(() => undefined);
    return codexConnectionsFromStatus(rows, config);
  });
}

/** What Codex's config/read says about MCP servers. */
export type CodexMcpConfig = {
  mcp_servers?: Record<string, unknown>;
  /** Where each effective key came from, by dotted key path. */
  origins?: Record<string, unknown>;
  /** The user's own config.toml, the only file Aven changes. */
  userFile?: {
    path: string;
    version?: string;
    /** That file's own mcp_servers, before other layers apply. */
    servers?: Record<string, unknown>;
    text?: string;
  };
};

export function codexMcpConfig(response: unknown): CodexMcpConfig {
  const read = asRecord(response);
  const layers = Array.isArray(read?.layers) ? read.layers : [];
  // The base user file; a profile's file is not where Codex writes by default.
  const user = layers
    .map((layer) => asRecord(layer))
    .find((layer) => {
      const name = asRecord(layer?.name);
      return (
        stringField(name, "type") === "user" && !stringField(name, "profile")
      );
    });
  const path = stringField(asRecord(user?.name), "file");
  const version = stringField(user, "version");
  const servers = asRecord(asRecord(user?.config)?.mcp_servers) ?? {};
  return {
    mcp_servers: asRecord(asRecord(read?.config)?.mcp_servers) ?? {},
    origins: asRecord(read?.origins) ?? {},
    ...(path
      ? { userFile: { path, servers, ...(version ? { version } : {}) } }
      : {}),
  };
}

/** config/read with its layers, plus the user's file as text. */
async function readCodexMcpConfig(
  rpc: JsonRpcClient,
  cwd: string,
): Promise<CodexMcpConfig & { bytes?: string }> {
  const config = codexMcpConfig(
    await rpc.request<unknown>(
      "config/read",
      { cwd, includeLayers: true },
      REQUEST_TIMEOUT_MS,
    ),
  );
  if (!config.userFile) return config;
  const bytes = await rpc
    .request<unknown>(
      "fs/readFile",
      { path: config.userFile.path },
      REQUEST_TIMEOUT_MS,
    )
    .then((read) => stringField(asRecord(read), "dataBase64") ?? "")
    .catch(() => undefined);
  if (bytes === undefined) return config;
  return {
    ...config,
    userFile: { ...config.userFile, text: decodeBase64(bytes) },
    bytes,
  };
}

function decodeBase64(data: string): string {
  const binary = atob(data);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0)),
  );
}

/** Codex splits key paths on dots, so only these names can be addressed. */
const CODEX_KEY_RE = /^[A-Za-z0-9_-]+$/;

/** The server is defined in the user's own base config file. */
function inUserCodexConfig(config: CodexMcpConfig, name: string): boolean {
  return ["command", "url"].some((field) => {
    const origin = asRecord(
      asRecord(config.origins?.[`mcp_servers.${name}.${field}`])?.name,
    );
    return (
      stringField(origin, "type") === "user" &&
      !stringField(origin, "profile") &&
      (!config.userFile || stringField(origin, "file") === config.userFile.path)
    );
  });
}

export type CodexEntryForm = "table" | "dotted" | "inline";

const BARE_OR_QUOTED_KEY = String.raw`(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')`;
const KEY_VALUE = new RegExp(
  String.raw`^(${BARE_OR_QUOTED_KEY}(?:\s*\.\s*${BARE_OR_QUOTED_KEY})*)\s*=\s*(.*)$`,
);

function splitKeyPath(path: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of path) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ".") {
      parts.push(current.trim());
      current = "";
    } else current += char;
  }
  parts.push(current.trim());
  return parts;
}

/** Open brackets and braces left by a value, outside strings and comments. */
function openBrackets(value: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (quote) {
      if (char === "\\" && quote === '"') i++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "#") break;
    else if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") depth--;
  }
  return depth;
}

/**
 * How a server's entry is written in a Codex config file: its own
 * `[mcp_servers.<name>]` table, dotted keys (`mcp_servers.<name>.command`),
 * or an inline table (`<name> = { … }`). Codex's writer keeps the first two
 * as they are, but rewrites an inline table into a table and can leave the
 * file unreadable, so Aven only turns off the first two.
 */
export function codexEntryForms(
  text: string,
  key: string,
): Set<CodexEntryForm> {
  const forms = new Set<CodexEntryForm>();
  let table: string[] = [];
  let multiline: string | null = null;
  let depth = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (multiline) {
      if (line.includes(multiline)) multiline = null;
      continue;
    }
    if (depth > 0) {
      depth += openBrackets(line);
      continue;
    }
    if (!line || line.startsWith("#")) continue;
    const arrayHeader = line.match(/^\[\[(.+?)\]\]\s*(?:#.*)?$/);
    const header = arrayHeader ? null : line.match(/^\[(.+?)\]\s*(?:#.*)?$/);
    if (arrayHeader || header) {
      table = splitKeyPath((arrayHeader ?? header)![1]!);
      if (header && table[0] === "mcp_servers" && table[1] === key)
        forms.add("table");
      continue;
    }
    const pair = line.match(KEY_VALUE);
    if (!pair) continue;
    const path = [...table, ...splitKeyPath(pair[1]!)];
    const value = pair[2]!;
    const inOwnTable =
      table[0] === "mcp_servers" && table[1] === key && table.length >= 2;
    if (path[0] === "mcp_servers" && path[1] === key && !inOwnTable)
      forms.add(path.length === 2 ? "inline" : "dotted");
    for (const quote of ['"""', "'''"]) {
      if (value.startsWith(quote) && value.split(quote).length === 2)
        multiline = quote;
    }
    if (!multiline) depth = Math.max(0, openBrackets(value));
  }
  return forms;
}

/** Codex's writer leaves this entry readable and in the same form. */
function codexEntryWritable(text: string | undefined, key: string): boolean {
  if (text === undefined) return false;
  const forms = codexEntryForms(text, key);
  return !forms.has("inline") && (forms.has("table") || forms.has("dotted"));
}

/**
 * Turns one server off or on in the user's own Codex config file, through
 * Codex's own config writer: off sets `enabled = false` on that server's
 * entry, and on removes the key again. Only entries written as their own
 * table or as dotted keys are changed. Aven keeps the file's bytes first,
 * writes only if the file hasn't changed since, checks that Codex can still
 * read it, and puts the bytes back exactly if it can't.
 */
export function setCodexServerEnabled(
  cwd: string,
  key: string,
  enabled: boolean,
): Promise<{ note?: string }> {
  if (!CODEX_KEY_RE.test(key))
    return Promise.reject(new Error("Codex can't turn this server off."));
  return withCodexAppServer(cwd, "toggle", async (rpc) => {
    const config = await readCodexMcpConfig(rpc, cwd);
    const file = config.userFile;
    if (!file || !inUserCodexConfig(config, key))
      throw new Error(
        "Codex keeps this server in a settings file Aven doesn't change.",
      );
    if (config.bytes === undefined || !codexEntryWritable(file.text, key))
      throw new Error(
        `Aven only changes servers written as their own [mcp_servers.${key}] table in ${file.path}. Change this one there.`,
      );
    const restore = async () => {
      await rpc.request(
        "fs/writeFile",
        { path: file.path, dataBase64: config.bytes },
        REQUEST_TIMEOUT_MS,
      );
    };
    let written: Record<string, unknown> | null;
    try {
      written = asRecord(
        await rpc.request<unknown>(
          "config/value/write",
          {
            keyPath: `mcp_servers.${key}.enabled`,
            value: enabled ? null : false,
            mergeStrategy: "replace",
            filePath: file.path,
            ...(file.version ? { expectedVersion: file.version } : {}),
          },
          REQUEST_TIMEOUT_MS,
        ),
      );
    } catch (error) {
      // Codex refuses before writing (a changed file, an invalid result);
      // put the bytes back anyway in case it got part of the way.
      await verifyOrRestore(rpc, cwd, key, enabled, restore, true);
      throw error;
    }
    await verifyOrRestore(rpc, cwd, key, enabled, restore, false);
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

/**
 * Reads the config back in the same session. If Codex can't read it, or the
 * server's entry isn't what was asked for, the original bytes go back.
 */
async function verifyOrRestore(
  rpc: JsonRpcClient,
  cwd: string,
  key: string,
  enabled: boolean,
  restore: () => Promise<void>,
  failed: boolean,
): Promise<void> {
  const after = await readCodexMcpConfig(rpc, cwd).catch(() => undefined);
  const entry = asRecord(after?.userFile?.servers?.[key]);
  const fine =
    !!after?.userFile &&
    codexEntryWritable(after.userFile.text, key) &&
    !!entry &&
    (failed || (enabled ? entry.enabled !== false : entry.enabled === false));
  if (fine) return;
  try {
    await restore();
  } catch (error) {
    throw new Error(
      `Codex's config file may be damaged and Aven couldn't put it back: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!failed)
    throw new Error(
      "Codex couldn't save that cleanly, so Aven put its config file back as it was.",
    );
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
    const switchable =
      personal && !plugin && !builtIn && codexSwitchable(config!, name);
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
        ...(switchable ? { canTurnOff: true } : {}),
        ...(state === "ready" ? { toolCount: tools } : {}),
        ...(error && state !== "off" ? { detail: error.trim() } : {}),
        ...(state === "off" && !switchable
          ? { offNote: codexOffNote(config, name) }
          : {}),
      },
    ];
  });
  // A server turned off in the config file may not be listed at all.
  for (const [name, value] of Object.entries(config?.mcp_servers ?? {})) {
    if (listed.has(name) || asRecord(value)?.enabled !== false) continue;
    const personal = inUserCodexConfig(config!, name);
    const switchable = personal && codexSwitchable(config!, name);
    connections.push({
      name,
      key: name,
      removable: true,
      state: "off",
      ...(personal ? { source: "Personal" } : {}),
      ...(switchable
        ? { canTurnOff: true }
        : { offNote: codexOffNote(config, name) }),
    });
  }
  return sortConnections(connections);
}

/** Aven can turn this server off and on in the user's own file. */
function codexSwitchable(config: CodexMcpConfig, name: string): boolean {
  return (
    CODEX_KEY_RE.test(name) && codexEntryWritable(config.userFile?.text, name)
  );
}

/** Where a server Aven can't turn back on is turned off, in plain words. */
function codexOffNote(
  config: CodexMcpConfig | undefined,
  name: string,
): string {
  const origin = asRecord(
    asRecord(config?.origins?.[`mcp_servers.${name}.enabled`])?.name,
  );
  switch (stringField(origin, "type")) {
    case "project":
      return "Turned off in this project’s .codex/config.toml.";
    case "user":
      return "Turned off in your Codex config.toml.";
    case undefined:
      return "Turned off by Codex.";
    default:
      return "Turned off by your organization’s Codex settings.";
  }
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
