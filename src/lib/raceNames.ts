/**
 * How races name their lanes. A race can have two models of one provider,
 * so wherever a lane is named by its provider alone, a second lane of that
 * provider adds the model.
 */

import type { PaletteAgent } from "./commandPalette";
import { providerShortName } from "./discussionVoices";
import { HARNESS_TITLE, type HarnessId } from "./session";

/** "Claude Code · Opus 4.6": a lane's label, which names its model. */
export function raceAgentLabel(harness: HarnessId, modelName: string): string {
  return `${HARNESS_TITLE[harness]} · ${modelName}`;
}

/** The model part of a lane's label: "Opus 4.6". */
export function raceModelName(
  agent: Pick<PaletteAgent, "label" | "model">,
): string {
  return agent.label.split(" · ").slice(1).join(" · ") || agent.model;
}

/**
 * How a question names each lane: its provider ("Claude Code") when no other
 * lane shares it, else its label with the model ("Claude Code · Opus 4.6").
 */
export function raceAgentNames(
  agents: readonly Pick<PaletteAgent, "harness" | "label" | "model">[],
): string[] {
  return agents.map((agent) =>
    agents.filter((other) => other.harness === agent.harness).length > 1
      ? agent.label
      : HARNESS_TITLE[agent.harness],
  );
}

/** "Claude Opus 4.6", "Codex GPT-5", "Grok 4.6": a lane in two or three words. */
export function raceShortName(
  agent: Pick<PaletteAgent, "harness" | "label" | "model">,
): string {
  const provider = providerShortName(agent.harness);
  const model = raceModelName(agent);
  const lower = model.toLowerCase();
  const prefix = provider.toLowerCase();
  return lower === prefix || lower.startsWith(`${prefix} `)
    ? model
    : `${provider} ${model}`;
}

/**
 * Short names for a sentence about the lanes ("Claude and Codex are
 * racing"): the provider alone when no other lane shares it, else with the
 * model ("Claude Opus 4.6 and Claude Sonnet 5").
 */
export function raceShortNames(
  agents: readonly Pick<PaletteAgent, "harness" | "label" | "model">[],
): string[] {
  return agents.map((agent) =>
    agents.filter((other) => other.harness === agent.harness).length > 1
      ? raceShortName(agent)
      : providerShortName(agent.harness),
  );
}

/** "Race · Claude Opus 4.6 · Codex GPT-5": the chip names every lane. */
export function raceChipLabel(
  lanes: readonly Pick<PaletteAgent, "harness" | "label" | "model">[],
): string {
  return ["Race", ...lanes.map(raceShortName)].join(" · ");
}
