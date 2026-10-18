/**
 * How Aven names an agent, everywhere: by its app's short name ("Claude",
 * "Codex", "Grok"), with the model only when another agent of the same app
 * is in the same discussion, race or run ("Claude Opus 4.6" beside "Claude
 * Sonnet 5"). Tooltips and title attributes give the full name ("Claude
 * Code · Opus 4.6").
 */
import { HARNESS_TITLE, type HarnessId } from "./session";

/** An agent as far as its name goes: its app and its model's display name. */
export type NamedAgent = { harness: HarnessId; model: string };

/** Shorter app names where the product name is long. */
const SHORT_APP: Partial<Record<HarnessId, string>> = {
  claude: "Claude",
  grok: "Grok",
};

/** "Claude", "Codex", "Grok": the app as people say it. */
export function appName(harness: HarnessId): string {
  return SHORT_APP[harness] ?? HARNESS_TITLE[harness];
}

/** The model's own name, or "" when it is the app's default. */
function cleanModel(model: string): string {
  const trimmed = model.trim();
  return trimmed === "Default" ? "" : trimmed;
}

/**
 * The model without the app's name in front: "Claude Sonnet 5" is "Sonnet
 * 5". A model named only by its app and version ("Grok 4.6") stays whole.
 */
export function agentModelName(agent: NamedAgent): string {
  const model = cleanModel(agent.model);
  const prefix = `${appName(agent.harness).toLowerCase()} `;
  if (!model.toLowerCase().startsWith(prefix)) return model;
  const rest = model.slice(prefix.length).trim();
  return /^[a-z]/i.test(rest) ? rest : model;
}

/** "Claude Opus 4.6", "Codex GPT-5", "Grok 4.6": the app with its model. */
export function agentNameWithModel(agent: NamedAgent): string {
  const app = appName(agent.harness);
  const model = cleanModel(agent.model);
  if (!model) return app;
  const lower = model.toLowerCase();
  const prefix = app.toLowerCase();
  if (lower === prefix || lower.startsWith(`${prefix} `)) return model;
  return `${app} ${agentModelName(agent)}`;
}

/** "Claude Code · Opus 4.6": the full name, for tooltips. */
export function agentFullName(agent: NamedAgent): string {
  const model = agentModelName(agent);
  return model
    ? `${HARNESS_TITLE[agent.harness]} · ${model}`
    : HARNESS_TITLE[agent.harness];
}

/**
 * Each agent's name in one discussion, race or run: the app alone, or with
 * the model where another agent of the same app is in it too.
 */
export function agentNames(agents: readonly NamedAgent[]): string[] {
  return agents.map((agent) => agentNameIn(agent, agents));
}

/** One agent's name among `team`, which includes it (see `agentNames`). */
export function agentNameIn(
  agent: NamedAgent,
  team: readonly NamedAgent[],
): string {
  const shared =
    team.filter((other) => other.harness === agent.harness).length > 1;
  return shared ? agentNameWithModel(agent) : appName(agent.harness);
}
