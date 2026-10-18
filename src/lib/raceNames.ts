/**
 * How races name their agents. A race keeps each agent's full name
 * ("Claude Code · Opus 4.6") as its label; everything it shows names the
 * agent the way `agentNames` does: "Claude", or "Claude Opus 4.6" when a
 * second Claude races too.
 */

import {
  agentFullName,
  agentNameWithModel,
  agentNames,
  type NamedAgent,
} from "./agentNames";
import type { PaletteAgent } from "./commandPalette";
import type { ComposerFit } from "./composerFit";
import { formatSessionTitle, HARNESS_TITLE, type HarnessId } from "./session";
import { plural } from "./words";

type LaneLike = Pick<PaletteAgent, "harness" | "label" | "model">;

/** "Claude Code · Opus 4.6": the label a race keeps for an agent. */
export function raceAgentLabel(harness: HarnessId, modelName: string): string {
  return `${HARNESS_TITLE[harness]} · ${modelName}`;
}

/** The model part of an agent's label: "Opus 4.6". */
export function raceModelName(
  agent: Pick<PaletteAgent, "label" | "model">,
): string {
  return agent.label.split(" · ").slice(1).join(" · ") || agent.model;
}

/** A race agent as `agentNames` reads it: its app and model's name. */
export function raceAgent(agent: LaneLike): NamedAgent {
  return { harness: agent.harness, model: raceModelName(agent) };
}

/**
 * Each agent's name in a sentence or button: "Claude", or "Claude Opus 4.6"
 * when another agent of the same app races too.
 */
export function raceAgentNames(agents: readonly LaneLike[]): string[] {
  return agentNames(agents.map(raceAgent));
}

/** "Claude Opus 4.6", "Codex GPT-5", "Grok 4.6": an agent with its model. */
export function raceShortName(agent: LaneLike): string {
  return agentNameWithModel(raceAgent(agent));
}

/** "Claude Code · Opus 4.6": an agent's full name, for tooltips. */
export function raceFullName(agent: LaneLike): string {
  return agentFullName(raceAgent(agent));
}

/**
 * "Race · Claude · Codex": the chip names every agent, with its model only
 * where two of one app race (see `agentNames`).
 */
export function raceChipLabel(lanes: readonly LaneLike[]): string {
  return ["Race", ...raceAgentNames(lanes)].join(" · ");
}

/**
 * The chip's words for the room it has: "Race · Claude · Codex", then
 * "Race · 2 agents", then "Race · 2". The tooltip keeps the full text.
 */
export function raceChipFitLabel(
  lanes: readonly LaneLike[],
  fit: ComposerFit,
): string {
  if (fit === "full" || !lanes.length) return raceChipLabel(lanes);
  return fit === "compact"
    ? `Race · ${plural(lanes.length, "agent")}`
    : `Race · ${lanes.length}`;
}

/** The most of a race's task a lane's chat title keeps. */
const TASK_WORDS_MAX = 48;

/**
 * The task's words for a lane's chat title, as a new chat's title starts:
 * the first line of the message, shortened. "" when it has none.
 */
export function raceTaskWords(prompt: string): string {
  const line = prompt.trim().split(/\r?\n/)[0]?.trim() ?? "";
  return line.length > TASK_WORDS_MAX
    ? `${line.slice(0, TASK_WORDS_MAX - 1).trimEnd()}…`
    : line;
}

/**
 * A lane's chat title, stored as a chat's title is: "Reset button ·
 * Codex", the task and the agent's short name (see `raceAgentNames`), or
 * "Race · Codex" without task words.
 */
export function raceLaneTitle(
  harness: HarnessId,
  task: string,
  name: string,
): string {
  const words = task.replace(/\s+/g, " ").trim();
  return formatSessionTitle(harness, `${words || "Race"} · ${name}`);
}
