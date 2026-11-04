import {
  listClaudeConnections,
  listCodexConnections,
  type ProviderConnection,
} from "./harness/providerConnections";
import {
  buildMcpOverview,
  type McpInventory,
  type McpRow,
} from "./mcpOverview";
import type { McpProvider } from "./mcpServers";
import type { ScheduledAgent } from "./scheduledAgents";
import type { HarnessId } from "./session";

/**
 * Checks the connections an automation says it needs before a run starts, by
 * asking its provider, as Settings does. Only a connection known to be signed
 * out or failing stops a run: whatever Aven can't tell, the run goes ahead,
 * and the run's agent reports a service it couldn't reach (`automationPrompt`).
 *
 * The names on an automation may have been written by an agent. They are only
 * compared with what the provider lists, so what you read is the provider's
 * name for a connection, never the automation's.
 */

export type ConnectionProblem = {
  /** The connection's name, as the provider lists it. */
  connection: string;
  /** What is wrong and what to do, for the run's result. */
  text: string;
};

export type ConnectionCheckOptions = {
  list?: (
    provider: McpProvider,
    folder: string,
  ) => Promise<ProviderConnection[]>;
  timeoutMs?: number;
};

/** A provider that hasn't answered by now tells us nothing. */
const CHECK_TIMEOUT_MS = 40_000;

const defaultList = (provider: McpProvider, folder: string) =>
  provider === "claude"
    ? listClaudeConnections(folder)
    : listCodexConnections(folder);

/** Aven can list connections for these providers only. */
export function canCheckConnections(
  harness: HarnessId,
): harness is McpProvider {
  return harness === "claude" || harness === "codex";
}

/** "Google Calendar", "google-calendar" and "googlecalendar" are one name. */
const looseName = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "");

function rowMatches(row: McpRow, name: string): boolean {
  const wanted = looseName(name);
  return (
    !!wanted &&
    (looseName(row.name) === wanted ||
      row.entries.some(
        ({ connection }) =>
          looseName(connection.name) === wanted ||
          looseName(connection.key) === wanted,
      ))
  );
}

/**
 * Why a row stops a run, or null. A working copy of the connection is enough,
 * and turned off is your own choice. A server that was slow to answer may
 * still answer the run, so that isn't known to be failing.
 */
function rowProblem(row: McpRow): ConnectionProblem | null {
  const on = row.entries.filter(({ connection }) => connection.state !== "off");
  const bad = (state: ProviderConnection["state"]) =>
    state === "failed" || state === "needs-sign-in";
  if (!on.length || !on.every(({ connection }) => bad(connection.state)))
    return null;
  if (row.problem?.kind === "no-answer") return null;
  const signedOut =
    row.problem?.kind === "sign-in-broken" ||
    on.some(({ connection }) => connection.state === "needs-sign-in");
  return {
    connection: row.name,
    text: signedOut
      ? `${row.name} is signed out. Sign in from Settings, then run this again.`
      : `${row.name} isn’t working. Fix it in Settings, then run this again.`,
  };
}

function withinTime<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("The provider took too long.")),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * The first connection `agent` needs that is known not to work, or null.
 * Asks the provider only for an automation that names some.
 */
export async function automationConnectionProblem(
  agent: Pick<ScheduledAgent, "connections" | "harness">,
  folder: string,
  {
    list = defaultList,
    timeoutMs = CHECK_TIMEOUT_MS,
  }: ConnectionCheckOptions = {},
): Promise<ConnectionProblem | null> {
  const { connections: needed, harness } = agent;
  if (!needed?.length || !canCheckConnections(harness)) return null;
  let connections: ProviderConnection[];
  try {
    connections = await withinTime(list(harness, folder), timeoutMs);
  } catch {
    // The provider couldn't say, so nothing is known to be wrong.
    return null;
  }
  const inventories: Partial<Record<McpProvider, McpInventory>> = {
    claude: { status: "missing" },
    codex: { status: "missing" },
    [harness]: { status: "loaded", connections },
  };
  const { needsYou, signIn, working, off } = buildMcpOverview(inventories);
  const rows = [...needsYou, ...signIn, ...working, ...off];
  for (const name of needed) {
    const matching = rows.filter((row) => rowMatches(row, name));
    const problems = matching.map(rowProblem);
    if (problems[0] && problems.every(Boolean)) return problems[0];
  }
  return null;
}
