import { describe, expect, it } from "vitest";
import type { OrchestrationRun } from "./orchestration";
import {
  isRunPausedActivity,
  quietTurns,
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

describe("turns the orchestrator sends", () => {
  it("stay quiet even when the next one starts before the last is announced", () => {
    const quiet = quietTurns();
    quiet.add("lead:turn:one");
    quiet.add("lead:turn:two");
    expect(quiet.silences("lead:turn:one:completed")).toBe(true);
    expect(quiet.silences("lead:turn:two:failed")).toBe(true);
    // Your own turns, and requests that are yours to answer, still post.
    expect(quiet.silences("lead:turn:mine:completed")).toBe(false);
    expect(quiet.silences("lead:turn:block-7:approval:a1:3")).toBe(false);
  });

  it("remembers only the most recent turns", () => {
    const quiet = quietTurns(2);
    for (const id of ["a", "b", "c"]) quiet.add(`s:turn:${id}`);
    expect(quiet.silences("s:turn:a:completed")).toBe(false);
    expect(quiet.silences("s:turn:c:completed")).toBe(true);
  });
});
