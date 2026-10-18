import {
  hasProbedHarnessAvailability,
  isHarnessAvailable,
} from "./harness/availability";
import { isPickerProviderVisible, preferredModelId } from "./models";
import { secondOpinionTargets } from "./secondOpinion";
import type { HarnessId } from "./session";

type Deps = {
  installed: (id: HarnessId) => boolean;
  visible: (id: HarnessId) => boolean;
  probed: boolean;
  model: (id: HarnessId) => string;
};

const live = (): Deps => ({
  installed: isHarnessAvailable,
  visible: isPickerProviderVisible,
  probed: hasProbedHarnessAvailability(),
  model: preferredModelId,
});

/**
 * Who Discuss talks to unless you choose: a new chat with the best other
 * agent installed, in Aven's usual order (a Claude chat talks to Codex, a
 * Codex chat to Claude), on its usual model; with no other agent, a new
 * chat with this one. None when no agent can start a chat.
 */
export function bestDiscussionAgent(
  from: HarnessId,
  deps: Deps = live(),
): { harness: HarnessId; model: string } | null {
  const targets = secondOpinionTargets(from, { ...deps, includeCurrent: true });
  const harness = targets.find((id) => id !== from) ?? targets[0];
  return harness ? { harness, model: deps.model(harness) } : null;
}
