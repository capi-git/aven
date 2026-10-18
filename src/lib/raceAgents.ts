import type { PaletteAgent } from "./commandPalette";
import { hasLiveCatalog, modelsFor, pickerModelsFor } from "./models";
import { RACE_MAX_LANES, RACE_MIN_LANES } from "./race";
import { raceAgentLabel } from "./raceNames";
import { HARNESS_TITLE, type HarnessId } from "./session";
import { modelDisplayName } from "./sessionLabels";

/**
 * The agents a race uses, shared by the composer's Race chip and the command
 * palette. A lane is a provider and a model, so a race can put two models of
 * one provider side by side (Opus against Sonnet). The chat's own agent always
 * races; the saved choice is the other lanes, in order. A saved lane without
 * a model uses that provider's usual one.
 */
export type RaceLaneChoice = {
  harness: HarnessId;
  model?: string;
  /**
   * Read from the choice an earlier version saved, one lane per provider:
   * it stood for "the other providers", never a second lane of the chat's
   * own provider. Never saved.
   */
  perProvider?: true;
};

const KEY = "aven.raceLanes.v2";
/** Saved before lanes had models of their own: providers, and a model each. */
const LEGACY_AGENTS_KEY = "aven.raceAgents.v1";
const LEGACY_MODELS_KEY = "aven.raceModels.v1";
const CHANGE_EVENT = "aven:race-agents-change";

const HARNESS_SET = new Set<string>(Object.keys(HARNESS_TITLE));

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const isHarness = (value: unknown): value is HarnessId =>
  typeof value === "string" && HARNESS_SET.has(value);

/** The choice saved by an earlier version: one lane per provider. */
function legacyLaneChoice(): RaceLaneChoice[] {
  const agents = read(LEGACY_AGENTS_KEY);
  if (!Array.isArray(agents)) return [];
  const models = read(LEGACY_MODELS_KEY);
  const modelOf = (harness: HarnessId) => {
    if (!models || typeof models !== "object" || Array.isArray(models))
      return undefined;
    const model = (models as Record<string, unknown>)[harness];
    return typeof model === "string" && model ? model : undefined;
  };
  const seen = new Set<HarnessId>();
  return agents.filter(isHarness).flatMap((harness): RaceLaneChoice[] => {
    if (seen.has(harness)) return [];
    seen.add(harness);
    const model = modelOf(harness);
    return [
      model
        ? { harness, model, perProvider: true }
        : { harness, perProvider: true },
    ];
  });
}

/** The lanes saved besides the chat's own agent, migrating an older choice. */
export function loadRaceLaneChoice(): RaceLaneChoice[] {
  const saved = read(KEY);
  if (!Array.isArray(saved)) return legacyLaneChoice();
  return saved.flatMap((value): RaceLaneChoice[] => {
    if (!value || typeof value !== "object") return [];
    const { harness, model } = value as Record<string, unknown>;
    if (!isHarness(harness)) return [];
    return [
      typeof model === "string" && model ? { harness, model } : { harness },
    ];
  });
}

/** Cheap change marker for `useSyncExternalStore`; skips parsing. */
export function raceAgentChoiceSnapshot(): string {
  try {
    return [KEY, LEGACY_AGENTS_KEY, LEGACY_MODELS_KEY]
      .map((key) => localStorage.getItem(key) ?? "")
      .join("|");
  } catch {
    return "";
  }
}

export function saveRaceLaneChoice(lanes: readonly RaceLaneChoice[]) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(
        lanes.map(({ harness, model }) =>
          model ? { harness, model } : { harness },
        ),
      ),
    );
  } catch {
    // The choice still applies until the window reloads.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeRaceAgentChoice(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

/** One lane is another when both provider and model match. */
export function sameRaceAgent(
  a: Pick<PaletteAgent, "harness" | "model">,
  b: Pick<PaletteAgent, "harness" | "model">,
): boolean {
  return a.harness === b.harness && a.model === b.model;
}

/**
 * The installed agent `harness`, on `model` when its provider still offers
 * it and the user has not hidden it, else on its usual model.
 */
export function raceAgentFor(
  available: readonly PaletteAgent[],
  harness: HarnessId,
  model?: string,
): PaletteAgent | undefined {
  const agent = available.find((item) => item.harness === harness);
  if (!agent || !model || model === agent.model) return agent;
  const picked = pickerModelsFor(harness).find((item) => item.id === model);
  if (picked)
    return {
      harness,
      model: picked.id,
      label: raceAgentLabel(harness, picked.name),
    };
  // Its provider's live list hasn't loaded in this window yet: keep the
  // saved model, rather than racing the usual one and saving over it with
  // the next edit. Once the list is in and lacks it, the usual one races;
  // a model you hid never races.
  const known = modelsFor(harness).some((item) => item.id === model);
  if (!hasLiveCatalog(harness) && !known)
    return {
      harness,
      model,
      label: raceAgentLabel(harness, modelDisplayName(harness, model)),
    };
  return agent;
}

/**
 * Lanes for a race: `first` (the agent the user is talking to) plus the
 * saved lanes, filled with other providers' agents up to two. At most four,
 * never the same provider and model twice. `available` holds each installed
 * agent on its usual model.
 */
export function resolveRaceAgents(
  available: readonly PaletteAgent[],
  first?: PaletteAgent,
  saved: readonly RaceLaneChoice[] = loadRaceLaneChoice(),
): PaletteAgent[] {
  const lanes: PaletteAgent[] = [];
  const add = (agent: PaletteAgent | undefined) => {
    if (!agent || lanes.length >= RACE_MAX_LANES) return;
    if (lanes.some((lane) => sameRaceAgent(lane, agent))) return;
    lanes.push(agent);
  };
  add(first);
  for (const lane of saved) {
    // A lane saved without a model, or by an earlier version, stood for its
    // provider, one lane each, so it never doubles the chat's own provider.
    if ((lane.perProvider || !lane.model) && lane.harness === first?.harness)
      continue;
    add(raceAgentFor(available, lane.harness, lane.model));
  }
  for (const agent of available) {
    if (lanes.length >= RACE_MIN_LANES) break;
    // Filling in, another provider is the natural second opinion.
    if (lanes.some((lane) => lane.harness === agent.harness)) continue;
    add(agent);
  }
  return lanes;
}

/** What to save for these lanes: every lane after the chat's own. */
export function raceLaneChoices(
  lanes: readonly PaletteAgent[],
): RaceLaneChoice[] {
  return lanes.slice(1).map(({ harness, model }) => ({ harness, model }));
}

/**
 * The model a new lane of `harness` races on: the provider's usual one
 * unless a lane has it already, then the first one no lane uses.
 */
export function nextRaceAgent(
  available: readonly PaletteAgent[],
  lanes: readonly PaletteAgent[],
  harness: HarnessId,
): PaletteAgent | undefined {
  const usual = available.find((agent) => agent.harness === harness);
  if (!usual) return undefined;
  if (!lanes.some((lane) => sameRaceAgent(lane, usual))) return usual;
  const model = pickerModelsFor(harness).find(
    (item) =>
      !lanes.some((lane) => sameRaceAgent(lane, { harness, model: item.id })),
  );
  return model
    ? { harness, model: model.id, label: raceAgentLabel(harness, model.name) }
    : undefined;
}

/** Add a lane, never past four or twice. */
export function addRaceLane(
  lanes: readonly PaletteAgent[],
  agent: PaletteAgent,
): PaletteAgent[] {
  if (
    lanes.length >= RACE_MAX_LANES ||
    lanes.some((lane) => sameRaceAgent(lane, agent))
  )
    return [...lanes];
  return [...lanes, agent];
}

/** Remove a lane other than the chat's own, never below two. */
export function removeRaceLane(
  lanes: readonly PaletteAgent[],
  index: number,
): PaletteAgent[] {
  if (index <= 0 || index >= lanes.length || lanes.length <= RACE_MIN_LANES)
    return [...lanes];
  return lanes.filter((_, at) => at !== index);
}

/** Race lane `index` on another model, unless another lane already has it. */
export function replaceRaceLane(
  lanes: readonly PaletteAgent[],
  index: number,
  agent: PaletteAgent,
): PaletteAgent[] {
  if (
    !lanes[index] ||
    lanes.some((lane, at) => at !== index && sameRaceAgent(lane, agent))
  )
    return [...lanes];
  return lanes.map((lane, at) => (at === index ? agent : lane));
}
