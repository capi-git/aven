/**
 * Turns what Claude Code and Codex report about their MCP servers into the
 * Settings page's groups: what needs you, what works, and what is turned off
 * or hidden. A server both agents load is one row; a plugin's copy with no
 * address, beside a connector that works, is folded into that row.
 */
import type {
  ConnectionState,
  ProviderConnection,
} from "./harness/providerConnections";
import { defineStoredSetting } from "./settingsRegistry";
import type { McpProvider } from "./mcpServers";

export type McpInventory =
  | { status: "loading" }
  | { status: "loaded"; connections: ProviderConnection[] }
  | { status: "error"; message: string };

export const MCP_AGENTS: readonly McpProvider[] = ["claude", "codex"];

export const MCP_AGENT_LABEL: Record<McpProvider, string> = {
  claude: "Claude",
  codex: "Codex",
};

/** One server as one agent reports it. */
export type McpEntry = {
  provider: McpProvider;
  connection: ProviderConnection;
  /** Stable across checks: the agent and the agent's own name for it. */
  id: string;
};

export type McpProblemKind =
  "missing-program" | "sign-in-broken" | "no-address" | "no-answer" | "unknown";

export type McpProblem = {
  kind: McpProblemKind;
  /** What is wrong and what fixes it, in plain words. */
  text: string;
};

export type McpActionKind =
  "sign-in" | "remove" | "turn-off" | "hide" | "turn-on" | "show" | "check";

export type McpAction = { kind: McpActionKind; label: string };

export type McpRowState = ConnectionState | "hidden";

export type McpRow = {
  /** Stable key: the server's name, or the agent for an agent that failed. */
  id: string;
  name: string;
  /** The entries the row stands for (an agent-check row has none). */
  entries: McpEntry[];
  /** Plugin copies with no address, beside an entry that works. */
  copies: McpEntry[];
  state: McpRowState;
  /** The status beside the dot. */
  status: string;
  /** Source, agents, and tool count when connected. */
  context: string;
  problem?: McpProblem;
  /** The agents' own words for a failure, for Details. */
  details: string[];
  /** Which entry is used, when a copy was folded in. */
  note?: string;
  primary?: McpAction;
  more: McpAction[];
  /** For an agent Aven couldn't check: that agent. */
  agent?: McpProvider;
};

export type McpOverview = {
  /** Broken servers, and agents Aven couldn't check. */
  needsYou: McpRow[];
  signIn: McpRow[];
  working: McpRow[];
  /** Turned off in an agent, or hidden in Aven. */
  off: McpRow[];
  checking: McpProvider[];
  /** Agents that list connectors from the account (claude.ai, ChatGPT). */
  accountConnectors: McpProvider[];
  /** Every agent has answered, and none has any server. */
  empty: boolean;
};

// ---------------------------------------------------------------------------
// Hidden in Aven

const HIDDEN_KEY = "aven.mcpHidden";
let hiddenRaw: string | null | undefined;
let hiddenValue: readonly string[] = [];

/**
 * Servers hidden from this page, by entry id ("claude:plugin:design:slack").
 * Only Aven reads this: the agents still load what is hidden here.
 */
export const mcpHiddenSetting = defineStoredSetting<readonly string[]>({
  key: HIDDEN_KEY,
  defaultValue: [],
  // The same text gives the same array, so React sees no change.
  parse: (raw) => {
    if (raw === hiddenRaw) return hiddenValue;
    hiddenRaw = raw;
    let next: readonly string[] = [];
    try {
      const value: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(value))
        next = value.filter((item): item is string => typeof item === "string");
    } catch {
      next = [];
    }
    hiddenValue = next;
    return next;
  },
  serialize: (value) => JSON.stringify([...new Set(value)].sort()),
  changeEvent: "aven:mcp-hidden-change",
  storageChanges: true,
});

export function setMcpHidden(ids: readonly string[], hidden: boolean): void {
  const current = new Set(mcpHiddenSetting.load());
  for (const id of ids) {
    if (hidden) current.add(id);
    else current.delete(id);
  }
  mcpHiddenSetting.save([...current]);
}

// ---------------------------------------------------------------------------
// Names

/** "Google Calendar", "google calendar" and "google_calendar" match. */
export function normalizeServerName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Plugins ship lower-case names for services that have their own casing. */
const BRANDS: Record<string, string> = {
  asana: "Asana",
  atlassian: "Atlassian",
  figma: "Figma",
  github: "GitHub",
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
  googledrive: "Google Drive",
  intercom: "Intercom",
  linear: "Linear",
  notion: "Notion",
  sentry: "Sentry",
  slack: "Slack",
  stripe: "Stripe",
  supabase: "Supabase",
  vercel: "Vercel",
};

function displayName(entry: McpEntry): string {
  const { name, plugin, account } = entry.connection;
  if (!plugin && !account) return name;
  return BRANDS[normalizeServerName(name)] ?? name;
}

function possessive(name: string): string {
  const first = name.charAt(0).toUpperCase() + name.slice(1);
  return first.endsWith("s") ? `${first}’` : `${first}’s`;
}

// ---------------------------------------------------------------------------
// Problems

const MISSING_PROGRAM =
  /\bENOENT\b|posix_spawn|no such file or directory|command not found|not recognized as an internal or external command/i;
const SIGN_IN_BROKEN =
  /authorization header is badly formatted|\b401\b|unauthori[sz]ed|invalid[_ ]token|invalid_grant|token (?:has )?expired|bearer token|authentication (?:failed|required)/i;
const NO_ADDRESS = /no url configured/i;
const NO_ANSWER =
  /timed? ?out|timeout|took too long|ETIMEDOUT|did not respond|didn['’]t respond/i;

/**
 * The plain-language reason a server is not working, with the fix. Known
 * failures get their own words; anything else is "Couldn't start", and the
 * agent's own message stays available under Details.
 */
export function explainMcpProblem(
  name: string,
  connection: ProviderConnection,
): McpProblem {
  const raw = connection.detail ?? "";
  const code = connection.errorCode;
  if (
    code === "CLAUDEAI_BEARER_REJECTED" ||
    code === "FIRST_PARTY_AUTH_REJECTED"
  )
    return {
      kind: "sign-in-broken",
      text: `${possessive(name)} sign-in is broken. Sign in to Claude again.`,
    };
  if (code === "APPROVAL_REQUIRED")
    return {
      kind: "unknown",
      text: "Claude Code is waiting for you to approve this project’s server.",
    };
  if (NO_ADDRESS.test(raw))
    return { kind: "no-address", text: "This entry has no address." };
  if (MISSING_PROGRAM.test(raw))
    return {
      kind: "missing-program",
      text: `${possessive(name)} program isn’t on this Mac anymore.`,
    };
  if (SIGN_IN_BROKEN.test(raw)) {
    const fix = connection.canSignIn
      ? "Sign in again."
      : connection.key === "plugin:github:github"
        ? "Put a new token in GITHUB_PERSONAL_ACCESS_TOKEN, then check again."
        : "Give it a new token, then check again.";
    return {
      kind: "sign-in-broken",
      text: `${possessive(name)} sign-in is broken. ${fix}`,
    };
  }
  if (NO_ANSWER.test(raw)) return { kind: "no-answer", text: "Didn’t answer." };
  return { kind: "unknown", text: "Couldn’t start." };
}

// ---------------------------------------------------------------------------
// Rows

const STATUS: Record<McpRowState, string> = {
  ready: "Connected",
  "needs-sign-in": "Needs sign-in",
  failed: "Failed",
  starting: "Starting",
  inactive: "No tools",
  off: "Off",
  hidden: "Hidden",
};

/** Most urgent first: a row takes the state of its most urgent entry. */
const URGENCY: ConnectionState[] = [
  "failed",
  "needs-sign-in",
  "starting",
  "ready",
  "inactive",
];

const usable = (entry: McpEntry) =>
  entry.connection.state === "ready" ||
  entry.connection.state === "needs-sign-in" ||
  entry.connection.state === "starting";

const isCopy = (entry: McpEntry, cluster: McpEntry[]) =>
  !!entry.connection.plugin &&
  entry.connection.state === "failed" &&
  NO_ADDRESS.test(entry.connection.detail ?? "") &&
  cluster.some((other) => other !== entry && usable(other));

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function agentsOf(entries: McpEntry[]): McpProvider[] {
  return MCP_AGENTS.filter((agent) =>
    entries.some((entry) => entry.provider === agent),
  );
}

function context(
  entries: McpEntry[],
  offEntries: McpEntry[],
  state: McpRowState,
): string {
  const all = [...entries, ...offEntries];
  const sources = unique(
    all.map((entry) => entry.connection.source).filter((s): s is string => !!s),
  );
  const parts: string[] = [];
  if (sources.length) parts.push(joinAnd(sources));
  parts.push(...agentsOf(entries).map((agent) => MCP_AGENT_LABEL[agent]));
  const tools = Math.max(
    -1,
    ...entries
      .filter((entry) => entry.connection.state === "ready")
      .map((entry) => entry.connection.toolCount ?? -1),
  );
  if (state === "ready" && tools >= 0)
    parts.push(`${tools} tool${tools === 1 ? "" : "s"}`);
  // Part of the row is turned off in one agent and still on in another.
  const offAgents = agentsOf(offEntries).filter(
    (agent) => !entries.some((entry) => entry.provider === agent),
  );
  if (offAgents.length && entries.length)
    parts.push(
      `off in ${joinAnd(offAgents.map((agent) => MCP_AGENT_LABEL[agent]))}`,
    );
  return parts.join(" · ");
}

/** Turn off where the agent can; hide in Aven where it can't. */
function quietAction(entries: McpEntry[]): McpAction {
  return entries.some((entry) => entry.connection.canTurnOff)
    ? { kind: "turn-off", label: "Turn off" }
    : { kind: "hide", label: "Hide" };
}

const REMOVE: McpAction = { kind: "remove", label: "Remove" };
const SIGN_IN: McpAction = { kind: "sign-in", label: "Sign in" };
const CHECK: McpAction = { kind: "check", label: "Check again" };

/** The fix for a row (or its usual action) first, then the rest. */
export function rowActions(
  state: McpRowState,
  problem: McpProblem | undefined,
  entries: McpEntry[],
  offEntries: McpEntry[] = [],
): { primary?: McpAction; more: McpAction[] } {
  const removable = entries.some((entry) => entry.connection.removable);
  const canSignIn = entries.some((entry) => entry.connection.canSignIn);
  const quiet = quietAction(entries);
  const partlyOff = offEntries.length > 0 && entries.length > 0;
  const turnOnPart: McpAction[] = partlyOff
    ? [
        {
          kind: "turn-on",
          label: `Turn on in ${joinAnd(agentsOf(offEntries).map((agent) => MCP_AGENT_LABEL[agent]))}`,
        },
      ]
    : [];
  const rest = (...actions: (McpAction | false)[]) =>
    [...actions, ...turnOnPart].filter(
      (action): action is McpAction => !!action,
    );

  if (state === "hidden")
    return { primary: { kind: "show", label: "Show" }, more: [] };
  if (state === "off") {
    const offRemovable = offEntries.some((entry) => entry.connection.removable);
    return {
      primary: { kind: "turn-on", label: "Turn on" },
      more: offRemovable ? [REMOVE] : [],
    };
  }
  if (state === "failed") {
    switch (problem?.kind) {
      case "missing-program":
        return removable
          ? { primary: REMOVE, more: rest(quiet) }
          : { primary: quiet, more: rest() };
      case "sign-in-broken":
        return canSignIn
          ? { primary: SIGN_IN, more: rest(quiet, removable && REMOVE) }
          : { primary: CHECK, more: rest(quiet, removable && REMOVE) };
      case "no-address":
        return { primary: quiet, more: rest(removable && REMOVE) };
      default:
        return { primary: CHECK, more: rest(quiet, removable && REMOVE) };
    }
  }
  if (state === "needs-sign-in" && canSignIn)
    return { primary: SIGN_IN, more: rest(quiet, removable && REMOVE) };
  return { primary: quiet, more: rest(removable && REMOVE) };
}

function urgentState(entries: McpEntry[]): ConnectionState {
  return (
    URGENCY.find((state) =>
      entries.some((entry) => entry.connection.state === state),
    ) ?? "inactive"
  );
}

function rowFor(
  id: string,
  visible: McpEntry[],
  hidden = false,
): McpRow | null {
  if (!visible.length) return null;
  const copies = hidden
    ? []
    : visible.filter((entry) => isCopy(entry, visible));
  const rest = visible.filter((entry) => !copies.includes(entry));
  const on = rest.filter((entry) => entry.connection.state !== "off");
  const off = rest.filter((entry) => entry.connection.state === "off");
  // Prefer a connector's or a brand's casing over a plugin's lower case.
  const named =
    rest.find((entry) => entry.connection.account) ??
    rest.find((entry) => /[A-Z]/.test(entry.connection.name)) ??
    rest[0]!;
  const name = displayName(named);
  const state: McpRowState = hidden
    ? "hidden"
    : on.length
      ? urgentState(on)
      : "off";
  const failing = on.filter((entry) => entry.connection.state === "failed");
  const several = agentsOf(on).length > 1;
  const problem =
    state === "failed" && failing[0]
      ? (() => {
          const found = explainMcpProblem(name, failing[0].connection);
          return several
            ? {
                ...found,
                text: `${MCP_AGENT_LABEL[failing[0].provider]}: ${found.text}`,
              }
            : found;
        })()
      : undefined;
  const details = failing
    .filter((entry) => entry.connection.detail)
    .map((entry) =>
      several
        ? `${MCP_AGENT_LABEL[entry.provider]}: ${entry.connection.detail}`
        : entry.connection.detail!,
    );
  const users = on.length ? on : off;
  const note =
    copies.length && users[0]
      ? `${joinAnd(agentsOf(copies).map((agent) => MCP_AGENT_LABEL[agent]))} uses the ${users[0].connection.source ?? "working"} one; ${joinAnd(unique(copies.map((copy) => `the ${copy.connection.plugin} plugin’s copy`)))} ${copies.length === 1 ? "has" : "have"} no address.`
      : undefined;
  const { primary, more } = rowActions(
    state,
    problem,
    hidden ? rest : on,
    hidden ? [] : off,
  );
  return {
    id,
    name,
    entries: rest,
    copies,
    state,
    status: STATUS[state],
    context:
      state === "off" || state === "hidden"
        ? context(state === "off" ? off : rest, [], state)
        : context(on, off, state),
    ...(problem ? { problem } : {}),
    details,
    ...(note ? { note } : {}),
    ...(primary ? { primary } : {}),
    more,
  };
}

function byName(a: McpRow, b: McpRow): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export function buildMcpOverview(
  inventories: Record<McpProvider, McpInventory>,
  hiddenIds: ReadonlySet<string> | readonly string[] = [],
): McpOverview {
  const hidden = new Set(hiddenIds);
  const shown = new Map<string, McpEntry[]>();
  const tucked = new Map<string, McpEntry[]>();
  const needsYou: McpRow[] = [];
  const checking: McpProvider[] = [];
  const accountConnectors = new Set<McpProvider>();
  let listed = 0;

  for (const provider of MCP_AGENTS) {
    const inventory = inventories[provider];
    if (inventory.status === "loading") {
      checking.push(provider);
      continue;
    }
    if (inventory.status === "error") {
      needsYou.push({
        id: `agent:${provider}`,
        name: MCP_AGENT_LABEL[provider],
        entries: [],
        copies: [],
        state: "failed",
        status: STATUS.failed,
        context: "",
        problem: {
          kind: "unknown",
          text: `Aven couldn’t start ${MCP_AGENT_LABEL[provider]} to check its servers.`,
        },
        details: inventory.message ? [inventory.message] : [],
        primary: CHECK,
        more: [],
        agent: provider,
      });
      continue;
    }
    for (const connection of inventory.connections) {
      listed++;
      if (connection.account) accountConnectors.add(provider);
      const entry: McpEntry = {
        provider,
        connection,
        id: `${provider}:${connection.key}`,
      };
      const bucket = hidden.has(entry.id) ? tucked : shown;
      const key = normalizeServerName(connection.name) || connection.key;
      bucket.set(key, [...(bucket.get(key) ?? []), entry]);
    }
  }

  const signIn: McpRow[] = [];
  const working: McpRow[] = [];
  const off: McpRow[] = [];
  for (const [id, entries] of shown) {
    const row = rowFor(id, entries);
    if (!row) continue;
    if (row.state === "failed") needsYou.push(row);
    else if (row.state === "needs-sign-in") signIn.push(row);
    else if (row.state === "off") off.push(row);
    else working.push(row);
  }
  for (const [id, entries] of tucked) {
    const row = rowFor(`hidden:${id}`, entries, true);
    if (row) off.push(row);
  }

  return {
    // An agent Aven couldn't check comes first: its servers are unknown.
    needsYou: needsYou.sort(
      (a, b) => Number(!!b.agent) - Number(!!a.agent) || byName(a, b),
    ),
    signIn: signIn.sort(byName),
    working: working.sort(byName),
    off: off.sort(byName),
    checking,
    accountConnectors: MCP_AGENTS.filter((agent) =>
      accountConnectors.has(agent),
    ),
    empty: !checking.length && !needsYou.length && listed === 0,
  };
}
