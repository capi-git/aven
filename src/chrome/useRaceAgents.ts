import { useMemo, useSyncExternalStore } from "react";
import type { PaletteAgent } from "../lib/commandPalette";
import {
  getHarnessAvailabilitySnapshot,
  subscribeHarnessAvailability,
} from "../lib/harness/availability";
import {
  getModelSnapshot,
  getPickerVisibilitySnapshot,
  subscribeModels,
  subscribePickerVisibility,
} from "../lib/models";
import { availablePaletteAgents } from "../lib/paletteAgents";
import {
  raceAgentChoiceSnapshot,
  resolveRaceAgents,
  subscribeRaceAgentChoice,
} from "../lib/raceAgents";
import { HARNESS_TITLE, type HarnessId } from "../lib/session";
import { modelDisplayName } from "../lib/sessionLabels";

const zero = () => 0;
const empty = () => "";

/**
 * The agents a composer can race: every installed agent once, this chat's
 * agent and model first, and the lanes the next race uses (this chat's
 * agent, then the ones saved in the Race chip, any provider and model). Kept
 * current as agents are installed or hidden and as catalogs load.
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
  const { installedAgents, available } = useMemo(() => {
    if (!enabled) return { installedAgents: [], available: [] };
    const agents = availablePaletteAgents();
    const own = agents.find((agent) => agent.harness === harness) ?? {
      harness,
      model,
      label: HARNESS_TITLE[harness],
    };
    // An unknown model id can resolve to another provider's default; show
    // its own identity rather than a misleading name.
    const modelName = modelDisplayName(harness, model);
    const first = {
      ...own,
      model,
      label: `${own.label.split(" · ")[0]} · ${modelName}`,
    };
    return {
      installedAgents: agents,
      available: [
        first,
        ...agents.filter((agent) => agent.harness !== harness),
      ],
    };
    // The snapshots are change markers for the stores read above.
  }, [enabled, harness, model, installed, catalog, visible]);
  const lanes = useMemo(
    () =>
      available.length ? resolveRaceAgents(installedAgents, available[0]) : [],
    // `choice` marks a change to the saved lanes.
    [available, installedAgents, choice],
  );
  return { available, lanes };
}
