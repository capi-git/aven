import type { PaletteAgent } from "./commandPalette";
import { RACE_MAX_LANES, RACE_MIN_LANES } from "./race";
import type { HarnessId } from "./session";

/**
 * The agents a race uses, shared by the composer's Race toggle and the
 * command palette. Stored by harness so a model change in one place does
 * not lose the choice; each lane uses that harness's current model.
 */
const KEY = "aven.raceAgents.v1";
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
