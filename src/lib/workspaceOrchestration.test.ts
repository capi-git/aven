import { expect, it } from "vitest";
import type { OrchestrationRun } from "./orchestration";
import { orchestrationOwnsTurn } from "./workspaceOrchestration";

const run = (status: OrchestrationRun["status"], taskStatus = "completed") =>
  ({
    leadId: "lead",
    status,
    tasks: [{ sessionId: "worker", status: taskStatus }],
  }) as OrchestrationRun;

it("does not retain ordinary-turn ownership for finished orchestration history", () => {
  expect(orchestrationOwnsTurn()).toBe(false);
  expect(orchestrationOwnsTurn(run("finished"))).toBe(false);
  expect(orchestrationOwnsTurn(run("stopped"))).toBe(false);
  expect(orchestrationOwnsTurn(run("active"))).toBe(true);
  expect(orchestrationOwnsTurn(run("paused"))).toBe(true);
  expect(orchestrationOwnsTurn(run("stopped", "cancelling"))).toBe(true);
});
