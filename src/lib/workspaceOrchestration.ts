import { leafIds, type WorkspaceTab } from "./layout";
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

/** Native control and the scheduler belong to the window that owns the run. */
export function orchestrationMoveError(
  tabs: readonly WorkspaceTab[],
  runs: readonly OrchestrationRun[],
): string | undefined {
  const sessionIds = new Set(
    tabs.flatMap((tab) => [
      ...leafIds(tab.layout),
      ...tab.editorPanes.flatMap((pane) =>
        pane.files.flatMap((file) =>
          file.agent ? [file.agent.sessionId, file.agent.leadId] : [],
        ),
      ),
    ]),
  );
  const locked = runs.some(
    (run) =>
      (run.status === "active" ||
        run.status === "paused" ||
        run.tasks.some(
          (task) => task.status === "running" || task.status === "cancelling",
        )) &&
      (sessionIds.has(run.leadId) ||
        run.tasks.some((task) => sessionIds.has(task.sessionId))),
  );
  return locked
    ? "Stop or finish orchestration before moving its agents to another window. You can still view the agents beside their lead."
    : undefined;
}
