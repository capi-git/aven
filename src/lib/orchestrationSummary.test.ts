import { describe, expect, it, vi } from "vitest";
import type { OrchestrationRun } from "./orchestration";
import {
  encodedSidebarRuns,
  orchestrationFoldedLine,
  orchestrationProgress,
  orchestrationStatusWord,
  orchestrationTaskLabel,
  sidebarRuns,
  summarizeOrchestration,
  type OrchestrationSummary,
} from "./orchestrationSummary";
import { newSession, type Session } from "./session";

type Task = OrchestrationSummary["tasks"][number];
const task = (status: Task["status"], patch: Partial<Task> = {}): Task => ({
  sessionId: `${status}-${Math.random()}`,
  title: "Task",
  harness: "claude",
  model: "sonnet",
  status,
  ...patch,
});
const summary = (
  status: OrchestrationSummary["status"],
  tasks: Task[],
  live = true,
): OrchestrationSummary => ({ status, live, tasks });

describe("orchestration labels", () => {
  it("says the lead decides a worker's request, in place of Needs input", () => {
    const blocked = task("running", { needsInput: true });
    expect(orchestrationTaskLabel(blocked, summary("active", [blocked]))).toBe(
      "Lead deciding",
    );
  });

  it("says a worker needs you once its lead left the request to you", () => {
    const worker = {
      ...newSession("codex", "/repo"),
      id: "w1",
      pendingQuestion: { requestId: 3 },
    } as unknown as Session;
    const run = {
      status: "active",
      tasks: [
        {
          sessionId: "w1",
          title: "Task",
          harness: "codex",
          model: "m",
          status: "running",
          escalated: "question:3",
        },
      ],
    } as unknown as OrchestrationRun;
    const handed = summarizeOrchestration(run, [worker]);
    expect(orchestrationTaskLabel(handed.tasks[0], handed)).toBe("Needs you");
    // A newer request is the lead's again.
    const next = summarizeOrchestration(run, [
      { ...worker, pendingQuestion: { requestId: 4 } } as unknown as Session,
    ]);
    expect(orchestrationTaskLabel(next.tasks[0], next)).toBe("Lead deciding");
  });

  it("names work cut short in an earlier session instead of “Saved”", () => {
    const old = summary("active", [], false);
    expect(orchestrationTaskLabel(task("running"), old)).toBe("Interrupted");
    expect(orchestrationTaskLabel(task("queued"), old)).toBe("Not started");
    expect(orchestrationTaskLabel(task("completed"), old)).toBe("Done");
  });

  it("uses plain status words for a run", () => {
    expect(
      (["active", "paused", "finished", "stopped"] as const).map(
        orchestrationStatusWord,
      ),
    ).toEqual(["Running", "Paused", "Finished", "Stopped"]);
  });

  it("leaves cancelled tasks out of what had to be done", () => {
    const done = [task("completed"), task("completed"), task("completed")];
    expect(
      orchestrationProgress(summary("finished", [...done, task("cancelled")])),
    ).toBe("3 done · 1 cancelled");
    expect(
      orchestrationProgress(
        summary("active", [task("completed"), task("running"), task("failed")]),
      ),
    ).toBe("1/3 done · 1 failed");
  });

  it("folds an ended run to one dated line", () => {
    const now = 10 * 3_600_000;
    const four = [1, 2, 3, 4].map(() => task("completed"));
    expect(
      orchestrationFoldedLine(
        summary("finished", four),
        now - 2 * 3_600_000,
        now,
      ),
    ).toBe("Finished · 4 agents · 2h ago");
    expect(
      orchestrationFoldedLine(
        summary("stopped", [task("cancelled")]),
        now,
        now,
      ),
    ).toBe("Stopped · 1 agent · just now");
  });
});

describe("the floating sidebar's copy of the runs", () => {
  it("keeps states and rows but never prompts, results or receipts", () => {
    const full = {
      version: 1,
      leadId: "lead",
      cwd: "/repo",
      status: "active",
      allowedHarnesses: ["claude"],
      allowedModels: [{ harness: "claude", model: "sonnet", name: "Sonnet" }],
      maxWorkers: 2,
      cli: "/Applications/Aven.app/Contents/MacOS/aven",
      error: "Paused for a reason",
      continuations: 3,
      requests: { r1: { signature: "x", result: { big: "y".repeat(5000) } } },
      tasks: [
        {
          id: "t1",
          sessionId: "worker",
          title: "Settings UI",
          harness: "claude",
          model: "sonnet",
          prompt: "p".repeat(5000),
          files: ["src"],
          scopes: ["/repo/src"],
          dependsOn: [],
          status: "running",
          accepted: false,
          result: "r".repeat(20_000),
          delivered: true,
        },
      ],
    } as OrchestrationRun;
    const runs = [full];
    const [slim] = sidebarRuns(runs);
    expect(slim).toMatchObject({
      leadId: "lead",
      status: "active",
      error: "Paused for a reason",
      allowedHarnesses: ["claude"],
      maxWorkers: 2,
      cli: "",
      requests: {},
    });
    expect(slim.tasks[0]).toMatchObject({
      id: "t1",
      sessionId: "worker",
      title: "Settings UI",
      status: "running",
      prompt: "",
      result: "",
    });
    expect(JSON.stringify(slim).length).toBeLessThan(1_000);
    // One encode per change of the run list, however often it is asked for.
    const encode = vi.fn((value: unknown) => JSON.stringify(value));
    const first = encodedSidebarRuns(runs, encode);
    expect(encodedSidebarRuns(runs, encode)).toBe(first);
    expect(encode).toHaveBeenCalledTimes(1);
    encodedSidebarRuns([...runs], encode);
    expect(encode).toHaveBeenCalledTimes(2);
  });
});
