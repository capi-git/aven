/**
 * One list of connections, across providers. Claude Code, Codex and Pi keep
 * their own lists and Aven writes to them through their CLIs (mcpServers.ts).
 * The other providers get what they can another way:
 *
 * - Cursor, Grok, fx and OpenCode: Aven passes the personal servers Claude and
 *   Codex already have when a chat starts.
 * - Grok and omp read Claude's own settings themselves, and omp Codex's too.
 *
 * Nothing here copies a key. A server that holds one stays with the provider it
 * was given to, and the native side sends only its name (see `mcp_manage.rs`).
 * Each provider signs in for itself.
 */
import { invoke } from "@tauri-apps/api/core";
import { harnessDescriptor } from "./harness/descriptors";
import { isWorkerChat } from "./harness/sessionPermissions";
import type { McpEntry, McpRow } from "./mcpOverview";
import { MCP_AGENT_LABEL } from "./mcpOverview";
import type { McpProvider, McpServerSpec } from "./mcpServers";
import type { HarnessId } from "./session";

export type SharedServer = {
  name: string;
  from: "claude" | "codex";
  kind?: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  /** Why it stays where it is. Such a server arrives with only its name. */
  withheld?: "secret" | "kind";
};

export type SharedList = {
  servers: SharedServer[];
  /** Names each provider has set up for itself: Aven doesn't shadow those. */
  own: Partial<Record<HarnessId, string[]>>;
};

const EMPTY: SharedList = { servers: [], own: {} };

/** A chat still starts if this can't be read, just without these servers. */
export async function loadSharedList(cwd: string): Promise<SharedList> {
  try {
    const list = await invoke<SharedList | undefined>("mcp_shared_servers", {
      cwd: cwd || null,
    });
    return list && Array.isArray(list.servers) ? list : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** The providers that take servers from Aven when a chat starts. */
export type SessionProvider = "cursor" | "grok" | "fx" | "opencode";

/** Providers with their own list that Aven writes to through a CLI. */
const CLI_PROVIDERS: readonly McpProvider[] = ["claude", "codex", "pi"];

/**
 * What a chat on this provider gets: each name once, nothing withheld, and
 * nothing the provider already has under that name. Grok reads Claude's
 * personal servers itself, so only Codex's are passed to it.
 */
export function serversForChat(
  list: SharedList,
  provider: SessionProvider,
): SharedServer[] {
  const own = new Set(list.own[provider] ?? []);
  const taken = new Set(
    provider === "grok"
      ? list.servers.filter((s) => s.from === "claude").map((s) => s.name)
      : [],
  );
  const seen = new Set<string>();
  return list.servers.filter((server) => {
    if (server.withheld || !server.kind) return false;
    if (own.has(server.name) || taken.has(server.name)) return false;
    if (seen.has(server.name)) return false;
    seen.add(server.name);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Session start

/** An entry of ACP's `mcpServers`. Aven never fills in `env` or `headers`. */
export type AcpMcpServer =
  | {
      name: string;
      command: string;
      args: string[];
      env: { name: string; value: string }[];
    }
  | {
      type: "http";
      name: string;
      url: string;
      headers: { name: string; value: string }[];
    };

function acpServer(server: SharedServer): AcpMcpServer | null {
  if (server.kind === "stdio" && server.command)
    return {
      name: server.name,
      command: server.command,
      args: server.args ?? [],
      env: [],
    };
  if (server.kind === "http" && server.url)
    return { type: "http", name: server.name, url: server.url, headers: [] };
  return null;
}

/** ACP requires stdio of every agent; HTTP only if it says so in `initialize`. */
export function acpTakesHttp(init: unknown): boolean {
  const agent = (init as { agentCapabilities?: unknown } | null | undefined)
    ?.agentCapabilities as { mcpCapabilities?: { http?: unknown } } | undefined;
  return agent?.mcpCapabilities?.http === true;
}

/**
 * The `mcpServers` for a chat starting on an ACP provider. A teammate's or a
 * bot's chat gets none, whatever is configured.
 */
export async function acpServersForChat(
  provider: Exclude<SessionProvider, "opencode">,
  sessionId: string,
  cwd: string,
  init: unknown,
): Promise<AcpMcpServer[]> {
  if (isWorkerChat(sessionId, cwd)) return [];
  const http = acpTakesHttp(init);
  return serversForChat(await loadSharedList(cwd), provider)
    .filter((server) => server.kind !== "http" || http)
    .map(acpServer)
    .filter((server): server is AcpMcpServer => !!server);
}

/** `session/resume`: with no servers to give, the request stays as it was. */
export function acpResumeParams(
  sessionId: string,
  cwd: string,
  mcpServers: readonly unknown[],
): Record<string, unknown> {
  return mcpServers.length ? { sessionId, cwd, mcpServers } : { sessionId };
}

/**
 * Starts a session with the servers, and without them if the provider refuses:
 * a connection must never be why a chat can't start.
 */
export async function withServersOrWithout<S, T>(
  servers: S[],
  start: (servers: S[]) => Promise<T>,
): Promise<T> {
  try {
    return await start(servers);
  } catch (error) {
    if (!servers.length) throw error;
    console.warn(
      "[aven] A provider refused the MCP servers it was given; starting without them.",
    );
    return start([]);
  }
}

/** The body of OpenCode's `POST /mcp`, for its own server. */
export function openCodeServer(
  server: SharedServer,
): { name: string; config: Record<string, unknown> } | null {
  if (server.kind === "stdio" && server.command)
    return {
      name: server.name,
      config: {
        type: "local",
        command: [server.command, ...(server.args ?? [])],
      },
    };
  if (server.kind === "http" && server.url)
    return {
      name: server.name,
      config: { type: "remote", url: server.url },
    };
  return null;
}

/** How long a chat waits for OpenCode to take its servers before going on. */
const OPENCODE_ADD_WAIT_MS = 5_000;

/** Offers servers to a new OpenCode server, for its lifetime only. */
export async function offerServersToOpenCode(
  add: (name: string, config: Record<string, unknown>) => Promise<unknown>,
  sessionId: string,
  cwd: string,
): Promise<void> {
  if (isWorkerChat(sessionId, cwd)) return;
  const bodies = serversForChat(await loadSharedList(cwd), "opencode")
    .map(openCodeServer)
    .filter((body): body is NonNullable<typeof body> => !!body);
  if (!bodies.length) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(
      bodies.map(({ name, config }) =>
        // A server OpenCode won't take is left off; the chat still starts.
        add(name, config).catch(() => undefined),
      ),
    ),
    new Promise((resolve) => {
      timer = setTimeout(resolve, OPENCODE_ADD_WAIT_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

// ---------------------------------------------------------------------------
// What a row reaches

/** Providers shown on a row, other than the ones already in its context. */
const REACH_ORDER: readonly HarnessId[] = [
  "claude",
  "codex",
  "pi",
  "cursor",
  "grok",
  "fx",
  "opencode",
  "omp",
];

export type RowReach = {
  /** The row's one line of where it reaches. */
  line?: string;
  /** CLI providers it could be added to, and the settings to add. */
  addTo: McpProvider[];
  server?: McpServerSpec;
  /** The name to add it under. */
  name?: string;
};

function title(id: HarnessId): string {
  return id === "claude" || id === "codex" || id === "pi"
    ? MCP_AGENT_LABEL[id]
    : harnessDescriptor(id).title.replace(/ Build$/, "");
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function whyNot(entries: McpEntry[], found: SharedServer[]): string {
  if (found.some((server) => server.withheld === "secret"))
    return "it uses a private key";
  if (found.some((server) => server.withheld === "kind"))
    return "it uses a connection they don’t take";
  if (entries.some((entry) => entry.connection.account))
    return "it comes with your account";
  if (entries.some((entry) => entry.connection.plugin))
    return "it comes from a plugin";
  return "it’s set up for one project";
}

/** A server's settings for a CLI's `add`. Never holds a key: see the native side. */
export function specFromShared(server: SharedServer): McpServerSpec | null {
  if (server.kind === "stdio" && server.command)
    return {
      type: "stdio",
      command: server.command,
      args: server.args ?? [],
      env: {},
    };
  if (server.kind === "http" && server.url)
    return { type: "http", url: server.url, headers: {} };
  return null;
}

/**
 * Which installed providers a row's server reaches, in few words: only ones
 * not already named on the row, and nothing at all when there are none.
 */
export function rowReach(
  row: Pick<McpRow, "entries" | "state" | "agent">,
  list: SharedList,
  installed: ReadonlySet<HarnessId>,
): RowReach {
  if (
    row.agent ||
    row.state === "off" ||
    row.state === "hidden" ||
    !row.entries.length
  )
    return { addTo: [] };
  const entries = row.entries;
  const keys = new Set(entries.map((entry) => entry.connection.key));
  const found = list.servers.filter((server) => keys.has(server.name));
  const shareable = found.find((server) => !server.withheld && server.kind);
  const name = entries[0]!.connection.key;
  const named = new Set<HarnessId>(entries.map((entry) => entry.provider));
  const personal = (provider: McpProvider) =>
    entries.some(
      (entry) =>
        entry.provider === provider &&
        !entry.connection.plugin &&
        !entry.connection.account &&
        found.some((server) => server.from === provider),
    );

  const reaches: HarnessId[] = [];
  const missed: HarnessId[] = [];
  const addTo: McpProvider[] = [];
  for (const id of REACH_ORDER) {
    if (named.has(id) || !installed.has(id)) continue;
    if ((CLI_PROVIDERS as readonly HarnessId[]).includes(id)) {
      if (shareable && !(id === "pi" && name.includes(".")))
        addTo.push(id as McpProvider);
      else missed.push(id);
    } else if (id === "omp") {
      // omp reads Claude's and Codex's own settings, keys and all.
      if (personal("claude") || personal("codex")) reaches.push(id);
      else missed.push(id);
    } else if (id === "grok" && personal("claude")) {
      // So does Grok, for Claude's.
      reaches.push(id);
    } else if (
      shareable ||
      list.own[id as SessionProvider]?.some((own) => keys.has(own))
    ) {
      reaches.push(id);
    } else {
      missed.push(id);
    }
  }

  const clauses: string[] = [];
  if (reaches.length) clauses.push(`Also on ${joinAnd(reaches.map(title))}.`);
  if (addTo.length) clauses.push(`Not on ${joinAnd(addTo.map(title))} yet.`);
  if (missed.length)
    clauses.push(
      `Not on ${joinAnd(missed.map(title))}: ${whyNot(entries, found)}.`,
    );
  // ACP sessions on fx can't sign in, so a remote server may not work there.
  if (reaches.includes("fx") && shareable?.kind === "http")
    clauses.push("fx can’t sign in here.");
  const server = shareable && addTo.length ? specFromShared(shareable) : null;
  return {
    ...(clauses.length ? { line: clauses.join(" ") } : {}),
    addTo: server ? addTo : [],
    ...(server ? { server, name } : {}),
  };
}
