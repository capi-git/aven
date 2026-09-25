import {
  hasProbedHarnessAvailability,
  isHarnessAvailable,
} from "./harness/availability";
import type { PaletteAgent, PaletteChat } from "./commandPalette";
import {
  defaultSessionChoice,
  isPickerProviderVisible,
  preferredModelId,
  resolveModel,
} from "./models";
import { secondOpinionTargets } from "./secondOpinion";
import { HARNESS_TITLE } from "./session";
import { asHarness } from "./appSearch";
import { searchSessions } from "./sessionStore";

/** Installed agents, the default one first with its remembered model. */
export function availablePaletteAgents(): PaletteAgent[] {
  const choice = defaultSessionChoice();
  const harnesses = secondOpinionTargets(choice.harness, {
    installed: isHarnessAvailable,
    visible: isPickerProviderVisible,
    probed: hasProbedHarnessAvailability(),
    includeCurrent: true,
  });
  const ordered = harnesses.includes(choice.harness)
    ? harnesses
    : [choice.harness, ...harnesses];
  return ordered.map((harness) => {
    const model = resolveModel(
      harness,
      harness === choice.harness ? choice.model : preferredModelId(harness),
    );
    return {
      harness,
      model: model.id,
      label: `${HARNESS_TITLE[harness]} · ${model.name}`,
    };
  });
}

/** Conversations in every project whose title or messages match. */
export async function searchPaletteChats(
  query: string,
): Promise<PaletteChat[]> {
  const { hits } = await searchSessions({ query });
  const seen = new Set<string>();
  const chats: PaletteChat[] = [];
  for (const hit of hits) {
    if (seen.has(hit.sessionId)) continue;
    seen.add(hit.sessionId);
    chats.push({
      id: hit.sessionId,
      cwd: hit.cwd,
      harness: asHarness(hit.harness),
      title: hit.title,
      updatedAt: hit.updatedAt,
    });
  }
  return chats;
}
