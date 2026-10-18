import { useCallback, useState } from "react";
import { logError } from "../lib/errors";
import type { TeamWatchAct, TeamWatchAction } from "../lib/teamWatch";

/** What a panel says when an action failed outright, not refused. */
export const ACT_FAILED =
  "Couldn't do that. Try again in the window it runs in.";

/**
 * Runs a team panel's action from a button, keeping its plain refusal to
 * show and disabling the button while a slower one (from a window of its
 * own) is answered. An error is logged and shown as one plain sentence. The
 * same for a race's, a run's and a discussion's panel, here or popped out.
 */
export function useTeamAct(act: TeamWatchAct) {
  const [pending, setPending] = useState<TeamWatchAction["kind"] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const run = useCallback(
    (action: TeamWatchAction) => {
      const failed = (error: unknown) => {
        logError("Team panel", error);
        setProblem(ACT_FAILED);
      };
      setProblem(null);
      let result: ReturnType<TeamWatchAct>;
      try {
        result = act(action);
      } catch (error) {
        failed(error);
        return;
      }
      if (!(result instanceof Promise)) {
        setProblem(result);
        return;
      }
      setPending(action.kind);
      void result.then(
        (refused) => {
          setPending(null);
          setProblem(refused);
        },
        (error: unknown) => {
          setPending(null);
          failed(error);
        },
      );
    },
    [act],
  );
  return { run, pending, problem };
}
