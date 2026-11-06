import type { OrchestrationRun } from "./orchestration";

/** Historical completed runs must not change ordinary turn behavior. */
export function orchestrationOwnsTurn(run?: OrchestrationRun): boolean {
  return (
    !!run &&
    (run.status === "active" ||
      run.status === "paused" ||
      run.tasks.some(
        (task) => task.status === "running" || task.status === "cancelling",
      ))
  );
}
