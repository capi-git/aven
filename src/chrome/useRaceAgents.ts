import { useMemo, useSyncExternalStore } from "react";
import type { PaletteAgent } from "../lib/commandPalette";
import {
  getHarnessAvailabilitySnapshot,
  subscribeHarnessAvailability,
} from "../lib/harness/availability";
import {
  getModelSnapshot,
  getPickerVisibilitySnapshot,
  resolveModel,
  subscribeModels,
  subscribePickerVisibility,
} from "../lib/models";
import { availablePaletteAgents } from "../lib/paletteAgents";
import {
  raceAgentChoiceSnapshot,
  resolveRaceAgents,
  subscribeRaceAgentChoice,
  withRaceModels,
} from "../lib/raceAgents";
import type { HarnessId } from "../lib/session";

const zero = () => 0;
const empty = () => "";

/**
 * The agents a composer can race, with this chat's agent and model first and
 * the others on the model picked for them in the Race menu. Kept current as
 * agents are installed or hidden and as catalogs load.
 */
export function useRaceAgents(
  enabled: boolean,
  harness: HarnessId,
  model: string,
): { available: PaletteAgent[]; lanes: PaletteAgent[] } {
  const installed = useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    zero,
  );
  const catalog = useSyncExternalStore(subscribeModels, getModelSnapshot, zero);
  const visible = useSyncExternalStore(
    subscribePickerVisibility,
    getPickerVisibilitySnapshot,
    zero,
  );
  const choice = useSyncExternalStore(
    subscribeRaceAgentChoice,
    raceAgentChoiceSnapshot,
    empty,
  );
  const available = useMemo(() => {
    if (!enabled) return [];
    const agents = availablePaletteAgents();
    const own = agents.find((agent) => agent.harness === harness) ?? {
      harness,
      model,
      label: harness,
    };
    // An unknown model id can resolve to another provider's default; show
    // the id itself rather than a misleading name.
    const resolved = resolveModel(harness, model);
    const modelName =
      resolved.harness === harness && resolved.id === model
        ? resolved.name
        : model;
    const first = {
      ...own,
      model,
      label: `${own.label.split(" · ")[0]} · ${modelName}`,
    };
    return [
      first,
      ...withRaceModels(agents.filter((agent) => agent.harness !== harness)),
    ];
    // The snapshots are change markers for the stores read above.
  }, [enabled, harness, model, installed, catalog, visible, choice]);
  const lanes = useMemo(
    () => (available.length ? resolveRaceAgents(available, available[0]) : []),
    [available],
  );
  return { available, lanes };
}
