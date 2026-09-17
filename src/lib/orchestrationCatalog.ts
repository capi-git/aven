import { HARNESSES } from "./session";
import { isPickerProviderVisible, pickerModelsFor } from "./models";
import {
  isHarnessAvailable,
  probeHarnessAvailability,
} from "./harness/availability";
import { refreshHarnessCatalogs } from "./harness/registry";
import { validateOrchestrationSettings } from "./orchestrationPlan";

/** Current allowed choices; recheck when starting, resuming or dispatching workers. */
export function orchestrationWorkerChoices() {
  return HARNESSES.filter(
    (id) => isPickerProviderVisible(id) && isHarnessAvailable(id),
  )
    .map((harness) => ({ harness, models: pickerModelsFor(harness) }))
    .filter((choice) => choice.models.length > 0);
}

/** Discover worker choices only when the user sends an orchestration request. */
export async function discoverOrchestrationSettings() {
  await probeHarnessAvailability();
  const installed = HARNESSES.filter(
    (id) => isPickerProviderVisible(id) && isHarnessAvailable(id),
  );
  await refreshHarnessCatalogs(installed);
  return validateOrchestrationSettings({
    maxWorkers: 2,
    choices: orchestrationWorkerChoices().flatMap(({ harness, models }) =>
      models.map(({ id, name }) => ({ harness, model: id, name })),
    ),
  });
}
