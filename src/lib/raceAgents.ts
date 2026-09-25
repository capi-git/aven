import type { PaletteAgent } from "./commandPalette";
import { pickerModelsFor } from "./models";
import { RACE_MAX_LANES, RACE_MIN_LANES } from "./race";
import { HARNESS_TITLE, type HarnessId } from "./session";

/**
 * The agents a race uses, shared by the composer's Race toggle and the
 * command palette. Stored by harness, with an optional model per harness;
 * without one, a lane uses that harness's usual model.
 */
const KEY = "aven.raceAgents.v1";
const MODELS_KEY = "aven.raceModels.v1";
const CHANGE_EVENT = "aven:race-agents-change";

export function loadRaceAgentChoice(): HarnessId[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is HarnessId => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

/** Cheap change marker for `useSyncExternalStore`; skips parsing. */
export function raceAgentChoiceSnapshot(): string {
  try {
    return `${localStorage.getItem(KEY) ?? ""}|${localStorage.getItem(MODELS_KEY) ?? ""}`;
  } catch {
    return "";
  }
}

export function loadRaceModelChoice(): Partial<Record<HarnessId, string>> {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(MODELS_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

export function saveRaceModelChoice(harness: HarnessId, model: string) {
  try {
    localStorage.setItem(
      MODELS_KEY,
      JSON.stringify({ ...loadRaceModelChoice(), [harness]: model }),
    );
  } catch {
    // The choice still applies until the window reloads.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Apply the model picked for each agent in the Race menu. A saved model the
 * provider no longer offers, or one the user hid, falls back to the default.
 */
export function withRaceModels(
  agents: readonly PaletteAgent[],
  models: Partial<Record<HarnessId, string>> = loadRaceModelChoice(),
): PaletteAgent[] {
  return agents.map((agent) => {
    const id = models[agent.harness];
    if (!id || id === agent.model) return agent;
    const model = pickerModelsFor(agent.harness).find((item) => item.id === id);
    return model
      ? {
          harness: agent.harness,
          model: model.id,
          label: `${HARNESS_TITLE[agent.harness]} · ${model.name}`,
        }
      : agent;
  });
}

export function saveRaceAgentChoice(harnesses: readonly HarnessId[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(harnesses));
  } catch {
    // The choice still applies until the window reloads.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeRaceAgentChoice(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

/**
 * Lanes for a race: `first` (the agent the user is talking to) plus the
 * saved choice, filled with other available agents up to two. At most four.
 */
export function resolveRaceAgents(
  available: readonly PaletteAgent[],
  first?: PaletteAgent,
  saved: readonly HarnessId[] = loadRaceAgentChoice(),
): PaletteAgent[] {
  const lanes: PaletteAgent[] = [];
  const add = (agent: PaletteAgent | undefined) => {
    if (!agent || lanes.length >= RACE_MAX_LANES) return;
    if (lanes.some((lane) => lane.harness === agent.harness)) return;
    lanes.push(agent);
  };
  add(first);
  for (const harness of saved)
    add(available.find((agent) => agent.harness === harness));
  for (const agent of available) {
    if (lanes.length >= RACE_MIN_LANES) break;
    add(agent);
  }
  return lanes;
}

/** Add or remove an agent, never dropping below two or above four. */
export function toggleRaceAgent(
  lanes: readonly PaletteAgent[],
  agent: PaletteAgent,
): PaletteAgent[] {
  const present = lanes.some((lane) => lane.harness === agent.harness);
  if (present)
    return lanes.length <= RACE_MIN_LANES
      ? [...lanes]
      : lanes.filter((lane) => lane.harness !== agent.harness);
  return lanes.length >= RACE_MAX_LANES ? [...lanes] : [...lanes, agent];
}
