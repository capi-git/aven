import { expect, it } from "vitest";
import { newAgentTab, newTab } from "./layout";
import type { OrchestrationRun } from "./orchestration";
import {
  orchestrationMoveError,
  orchestrationOwnsTurn,
} from "./workspaceOrchestration";

const run = (status: OrchestrationRun["status"], taskStatus = "completed") =>
  ({
    leadId: "lead",
    status,
    tasks: [{ sessionId: "worker", status: taskStatus }],
  }) as OrchestrationRun;

it("keeps active and paused leads and workers with their owning window", () => {
  for (const status of ["active", "paused"] as const)
    for (const id of ["lead", "worker"])
      expect(orchestrationMoveError([newTab(id)], [run(status)])).toContain(
        "Stop or finish",
      );
  expect(
    orchestrationMoveError([newTab("lead")], [run("stopped", "cancelling")]),
  ).toBeDefined();
});
it("allows unrelated tabs and fully stopped or finished runs to move", () => {
  expect(
    orchestrationMoveError([newTab("other")], [run("active")]),
  ).toBeUndefined();
  for (const status of ["stopped", "finished"] as const)
    expect(
      orchestrationMoveError([newTab("lead")], [run(status)]),
    ).toBeUndefined();
});
it("also detects a worker watched through an editor tab", () => {
  const tab = newTab("other");
  tab.editorPanes = [
    {
      id: "editor",
      activeFileId: "agent",
      files: [
        newAgentTab("Worker", "/repo", {
          sessionId: "worker",
          leadId: "lead",
          harness: "codex",
        }),
      ],
    },
  ];
  expect(orchestrationMoveError([tab], [run("active")])).toBeDefined();
});

it("does not retain ordinary-turn ownership for finished orchestration history", () => {
  expect(orchestrationOwnsTurn()).toBe(false);
  expect(orchestrationOwnsTurn(run("finished"))).toBe(false);
  expect(orchestrationOwnsTurn(run("stopped"))).toBe(false);
  expect(orchestrationOwnsTurn(run("active"))).toBe(true);
  expect(orchestrationOwnsTurn(run("paused"))).toBe(true);
  expect(orchestrationOwnsTurn(run("stopped", "cancelling"))).toBe(true);
});
