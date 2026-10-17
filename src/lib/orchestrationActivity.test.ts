import { describe, expect, it } from "vitest";
import type { OrchestrationRun } from "./orchestration";
import {
  isRunPausedActivity,
  runOutcomeActivity,
} from "./orchestrationActivity";

describe("run outcome activity", () => {
  const run = {
    leadId: "lead",
    proposalId: "card",
    status: "finished",
    error: undefined,
    tasks: [{}, {}, {}, {}],
  } as unknown as OrchestrationRun;

  it("posts one entry for a finished run, on the lead's chat", () => {
    const event = runOutcomeActivity({ kind: "finished", run }, 5);
    expect(event).toEqual({
      id: "lead:run:card:finished:5",
      outcome: "completed",
      summary: "Run finished · 4 agents",
    });
    expect(isRunPausedActivity(event)).toBe(false);
  });

  it("gives a paused run its plain reason and a Paused label", () => {
    const event = runOutcomeActivity(
      {
        kind: "paused",
        run: {
          ...run,
          status: "paused",
          error: "The lead checked in 20 times.",
        },
      },
      6,
    );
    expect(event.outcome).toBe("failed");
    expect(event.summary).toBe("Run paused · The lead checked in 20 times.");
    expect(isRunPausedActivity(event)).toBe(true);
    // An ordinary failed turn is still a failure.
    expect(isRunPausedActivity({ id: "lead:turn:x:failed" })).toBe(false);
  });
});
