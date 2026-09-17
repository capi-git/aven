import type { ControlOutcome } from "./orchestration";

/** A rejected UI submission must settle its scheduler even before a turn starts. */
export function submitManagedTurn(
  dispatch: (settle: (outcome: ControlOutcome) => void) => boolean | void,
  done: (outcome: ControlOutcome) => void,
): void {
  let settled = false;
  const settle = (outcome: ControlOutcome) => {
    if (settled) return;
    settled = true;
    done(outcome);
  };
  try {
    if (dispatch(settle) === false)
      settle({
        status: "failed",
        text: "",
        error:
          "The agent could not accept this turn. Resolve its queued messages or pending action, then retry.",
      });
  } catch (error) {
    settle({
      status: "failed",
      text: "",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
