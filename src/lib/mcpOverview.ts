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

export type McpAction = {
  kind: McpActionKind;
  label: string;
  /** The entries it acts on, by id: on a row with a problem, only those. */
  targets: string[];
};

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
  /** Where it is turned off, when Aven can't turn it back on. */
  hint?: string;
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

/**
 * Rows merge on the name alone, ignoring case and spacing: "Google Calendar"
 * and "google calendar" match, but "my-db" and "my_db" stay apart.
 */
export function normalizeServerName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
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
  return BRANDS[name.toLowerCase().replace(/[^a-z0-9]+/g, "")] ?? name;
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
    // The GitHub plugin sends GITHUB_PERSONAL_ACCESS_TOKEN as its sign-in.
    // An app opened from the Dock doesn't get the shell's variables, so
    // setting it there doesn't reach the agents Aven starts.
    const fix = connection.canSignIn
      ? "Sign in again."
      : connection.key === "plugin:github:github"
        ? "Its plugin signs in with GITHUB_PERSONAL_ACCESS_TOKEN, which apps opened from the Dock don’t get. To use GitHub, add it with your token through Add server, then turn this one off."
        : "Add it again with a new token through Add server, then turn this one off.";
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

/** A plugin's entry with no address, beside one in the same agent that works. */
const isCopy = (entry: McpEntry, cluster: McpEntry[]) =>
  !!entry.connection.plugin &&
  entry.connection.state === "failed" &&
  NO_ADDRESS.test(entry.connection.detail ?? "") &&
  cluster.some(
    (other) =>
      other !== entry && other.provider === entry.provider && usable(other),
  );

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

/** One entry exactly: its agent and where that agent keeps it. */
export function entryLabel(entry: McpEntry): string {
  const source = entry.connection.source;
  return `${MCP_AGENT_LABEL[entry.provider]}${source ? ` (${source})` : ""}`;
}

/**
 * The agent can turn this entry off here. Claude saves its choice per
 * project, so with no project open Aven doesn't offer it for Claude.
 */
export function canTurnOffHere(entry: McpEntry, claudeProject = true): boolean {
  return (
    !!entry.connection.canTurnOff &&
    (entry.provider !== "claude" || claudeProject)
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

const ids = (entries: McpEntry[]) => entries.map((entry) => entry.id);

/** Turn off where the agent can; hide in Aven where it can't. */
function quietAction(targets: McpEntry[], claudeProject: boolean): McpAction {
  return targets.some((entry) => canTurnOffHere(entry, claudeProject))
    ? { kind: "turn-off", label: "Turn off", targets: ids(targets) }
    : { kind: "hide", label: "Hide", targets: ids(targets) };
}

/**
 * The entries a row's actions act on. On a row with a problem that is only
 * the entries with the problem, so a working copy elsewhere is left alone.
 */
export type McpRowScope = {
  /** On entries: not turned off, not folded-in copies. */
  on: McpEntry[];
  off: McpEntry[];
  copies: McpEntry[];
};

/** The fix for a row (or its usual action) first, then the rest. */
export function rowActions(
  state: McpRowState,
  problem: McpProblem | undefined,
  { on, off, copies }: McpRowScope,
  claudeProject = true,
): { primary?: McpAction; more: McpAction[] } {
  // Turning on goes back through the same switch, which needs no project.
  const reversible = off.filter((entry) => entry.connection.canTurnOff);
  if (state === "hidden")
    return {
      primary: { kind: "show", label: "Show", targets: ids([...on, ...off]) },
      more: [],
    };
  if (state === "off") {
    const removable = off.filter((entry) => entry.connection.removable);
    return {
      ...(reversible.length
        ? {
            primary: {
              kind: "turn-on",
              label: "Turn on",
              targets: ids(reversible),
            },
          }
        : {}),
      more: removable.length
        ? [{ kind: "remove", label: "Remove", targets: ids(removable) }]
        : [],
    };
  }

  const affected =
    state === "failed"
      ? on.filter((entry) => entry.connection.state === "failed")
      : state === "needs-sign-in"
        ? on.filter((entry) => entry.connection.state === "needs-sign-in")
        : on;
  // A folded-in copy goes with its own agent's entries.
  const quietTargets = [
    ...affected,
    ...(state === "failed"
      ? []
      : copies.filter((copy) =>
          affected.some((entry) => entry.provider === copy.provider),
        )),
  ];
  const quiet = quietAction(quietTargets, claudeProject);
  const removable = affected.filter((entry) => entry.connection.removable);
  const remove: McpAction | false = removable.length > 0 && {
    kind: "remove",
    label: "Remove",
    targets: ids(removable),
  };
  const signing = affected.find((entry) => entry.connection.canSignIn);
  const signIn: McpAction | false = !!signing && {
    kind: "sign-in",
    label: "Sign in",
    targets: [signing.id],
  };
  const check: McpAction = {
    kind: "check",
    label: "Check again",
    targets: ids(affected),
  };
  const turnOnPart: McpAction[] =
    reversible.length && on.length
      ? [
          {
            kind: "turn-on",
            label: `Turn on in ${joinAnd(agentsOf(reversible).map((agent) => MCP_AGENT_LABEL[agent]))}`,
            targets: ids(reversible),
          },
        ]
      : [];
  const rest = (...actions: (McpAction | false)[]) =>
    [...actions, ...turnOnPart].filter(
      (action): action is McpAction => !!action,
    );

  if (state === "failed") {
    switch (problem?.kind) {
      case "missing-program":
        return remove
          ? { primary: remove, more: rest(quiet) }
          : { primary: quiet, more: rest() };
      case "sign-in-broken":
        if (signIn) return { primary: signIn, more: rest(quiet, remove) };
        // A token Aven can't hand over: quieting it is the fix here.
        return { primary: quiet, more: rest(remove) };
      case "no-address":
        return { primary: quiet, more: rest(remove) };
      default:
        return { primary: check, more: rest(quiet, remove) };
    }
  }
  if (state === "needs-sign-in" && signIn)
    return { primary: signIn, more: rest(quiet, remove) };
  return { primary: quiet, more: rest(remove) };
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
  hidden: boolean,
  claudeProject: boolean,
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
  // Which one the copy's own agent uses.
  const used = copies.length
    ? on.find(
        (entry) => entry.provider === copies[0]!.provider && usable(entry),
      )
    : undefined;
  const note =
    copies.length && used
      ? `${MCP_AGENT_LABEL[used.provider]} uses the ${used.connection.source ?? "working"} one; ${joinAnd(unique(copies.map((copy) => `the ${copy.connection.plugin} plugin’s copy`)))} ${copies.length === 1 ? "has" : "have"} no address.`
      : undefined;
  const offNotes = unique(
    off
      .filter((entry) => !entry.connection.canTurnOff)
      .map((entry) => entry.connection.offNote)
      .filter((text): text is string => !!text),
  );
  const hint = !hidden && offNotes.length ? offNotes.join(" ") : undefined;
  const { primary, more } = rowActions(
    state,
    problem,
    hidden ? { on: rest, off: [], copies: [] } : { on, off, copies },
    claudeProject,
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
    ...(hint ? { hint } : {}),
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
  { claudeProject = true }: { claudeProject?: boolean } = {},
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
        primary: { kind: "check", label: "Check again", targets: [] },
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
    const row = rowFor(id, entries, false, claudeProject);
    if (!row) continue;
    if (row.state === "failed") needsYou.push(row);
    else if (row.state === "needs-sign-in") signIn.push(row);
    else if (row.state === "off") off.push(row);
    else working.push(row);
  }
  for (const [id, entries] of tucked) {
    const row = rowFor(`hidden:${id}`, entries, true, claudeProject);
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
