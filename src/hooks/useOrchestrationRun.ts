import { useSyncExternalStore } from "react";
import { orchestrator, type OrchestrationRun } from "../lib/orchestration";

/**
 * A value derived from the run list, re-rendering only when that value
 * changes. Each save replaces only its own run, so a run selected here keeps
 * its identity while other runs change, and a selected boolean never moves
 * unless its answer does. Selectors must return a stored run or a primitive.
 */
export function useOrchestrationSelector<T>(
  select: (runs: readonly OrchestrationRun[]) => T,
): T {
  const read = () => select(orchestrator.snapshot());
  return useSyncExternalStore(orchestrator.subscribe, read, read);
}

/** The run a lead owns, if any; other runs' saves do not re-render. */
export function useOrchestrationRun(
  leadId: string | undefined,
): OrchestrationRun | undefined {
  return useOrchestrationSelector((runs) =>
    leadId ? runs.find((run) => run.leadId === leadId) : undefined,
  );
}
