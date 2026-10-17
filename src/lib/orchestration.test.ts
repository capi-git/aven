import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchableTask,
  LEAD_STALLED_AFTER_MS,
  Orchestrator,
  runStalled,
  UNANSWERED_AFTER_MS,
  scopesOverlap,
  visibleUserPrompt,
  workerTurnPrompt,
  type ControlOutcome,
  type OrchestrationHost,
  type OrchestrationRun,
  shellPath,
} from "./orchestration";
import { newSession } from "./session";
import { leadDecidedIds, sessionNeedsUser } from "./teamAttention";
import { orchestrationTeam } from "./teamRuns";
import type { OrchestrationProposal } from "./orchestrationPlan";

function setup() {
  const saved = new Map<string, OrchestrationRun>();
  const store = {
    save: vi.fn(async (run: OrchestrationRun) => {
      saved.set(run.leadId, structuredClone(run));
    }),
    load: vi.fn(async (id: string) => saved.get(id) ?? null),
    enable: vi.fn(async () => "/Applications/Aven.app/Contents/MacOS/aven"),
    disable: vi.fn(async () => {}),
    scopes: vi.fn(async (_cwd: string, files: string[]) =>
      files.map((file) => (file === "." ? "/repo" : `/repo/${file}`)),
    ),
  };
  const manager = new Orchestrator(store);
  const lead = { ...newSession("claude", "/repo"), id: "lead", busy: true };
  const sessions = [lead];
  const completions = new Map<string, (outcome: ControlOutcome) => void>();
  const host: OrchestrationHost = {
    session: (id) => sessions.find((session) => session.id === id),
    sessions: () => sessions,
    choices: () => [
      { harness: "codex", models: [{ id: "codex:test", name: "Test" }] },
    ],
    createWorker: vi.fn(async (run, task) => {
      sessions.push({
        ...newSession(task.harness, run.cwd),
        id: task.sessionId,
        busy: false,
      });
    }),
    submit: vi.fn((id, _text, done) => {
      const session = sessions.find((session) => session.id === id)!;
      session.busy = true;
      completions.set(id, (outcome) => {
        session.busy = false;
        done(outcome);
      });
    }),
    stop: vi.fn(async (id) => {
      const session = sessions.find((entry) => entry.id === id);
      if (session) session.busy = false;
    }),
    steer: vi.fn(async () => {}),
    respondApproval: vi.fn(),
    answerQuestion: vi.fn(),
  };
  manager.bind(host);
  let request = 0;
  const call = (
    action: string,
    input: Record<string, unknown> = {},
    id = `request-${++request}`,
  ) => manager.handle("lead", id, action, input);
  const start = async () => {
    lead.busy = false;
    await manager.start("lead", ["codex"], 2);
    lead.busy = true;
  };
  const delegate = (files: string[], extra = {}) =>
    call("delegate", {
      title: "Task",
      prompt: "Implement the bounded change",
      harness: "codex",
      files,
      ...extra,
    });
  const tasks = () => manager.run("lead")!.tasks;
  return {
    manager,
    store,
    host,
    lead,
    saved,
    sessions,
    start,
    call,
    delegate,
    tasks,
    completions,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("worker assignment prompts", () => {
  it("keeps the task text and wraps it in the assignment envelope", () => {
    const sent = workerTurnPrompt("Review the branch.", ["src/App.tsx"]);
    expect(sent.startsWith("Review the branch.")).toBe(true);
    expect(sent).toContain("<aven_assignment>");
    expect(sent).toContain("src/App.tsx");
    expect(visibleUserPrompt(sent)).toBe("Review the branch.");
  });

  it("leads with the worker's role, which its transcript shows", () => {
    const sent = workerTurnPrompt("Review the branch.", ["src"], "tester");
    expect(visibleUserPrompt(sent)).toBe(
      "Your role for this task: Tester. Work out how to prove it works: run or write the checks that matter, and report what passed, what failed and what is still untested.\n\nReview the branch.",
    );
    expect(sent.match(/Your role/g)).toHaveLength(1);
  });

  it("still hides legacy assignment instructions in restored conversations", () => {
    const restored =
      "Review the branch.\n\n<monocode_assignment>\nLegacy worker instructions\n</monocode_assignment>";
    expect(visibleUserPrompt(restored)).toBe("Review the branch.");
  });
});

describe("local orchestration", () => {
  it("does not start a run over accepted queued work on its idle lead", async () => {
    const f = setup();
    f.lead.busy = false;
    f.lead.queuedMessages = [
      { id: "queued", text: "Do this first", attachments: [] },
    ];
    f.lead.queueStatus = "paused";
    await expect(f.manager.start("lead", ["codex"], 2)).rejects.toThrow(
      "queued messages",
    );
    expect(f.store.enable).not.toHaveBeenCalled();
    expect(f.host.submit).not.toHaveBeenCalled();
    expect(f.manager.snapshot()).toEqual([]);
    expect(f.lead.queuedMessages[0].text).toBe("Do this first");
  });

  it("stops and forgets a deleted lead without persisting it again", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["src"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    const task = f.tasks()[0];
    const remove = vi.fn(async () => {
      expect(f.lead.busy).toBe(false);
      expect(f.manager.run("lead")?.status).toBe("stopped");
      f.saved.delete("lead");
    });
    await f.manager.deleteSession("lead", remove);
    expect(remove).toHaveBeenCalledOnce();
    expect(f.host.stop).toHaveBeenCalledWith(task.sessionId);
    expect(f.manager.snapshot()).toEqual([]);
    f.store.save.mockClear();
    f.completions.get(task.sessionId)?.({
      status: "completed",
      text: "Late result",
    });
    await f.manager.hydrate("lead");
    f.manager.sync();
    await Promise.resolve();
    expect(f.manager.snapshot()).toEqual([]);
    expect(f.store.save).not.toHaveBeenCalled();
  });

  it("reloads a deleted worker's pruned run and preserves state if deletion fails", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["src"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    const task = f.tasks()[0];
    await expect(
      f.manager.deleteSession(task.sessionId, async () => {
        throw new Error("Delete failed");
      }),
    ).rejects.toThrow("Delete failed");
    expect(f.tasks()).toHaveLength(1);
    expect(f.manager.run("lead")?.status).toBe("stopped");
    await f.manager.deleteSession(task.sessionId, async () => {
      f.saved.set("lead", { ...f.saved.get("lead")!, tasks: [], requests: {} });
      f.store.save.mockClear();
    });
    expect(f.tasks()).toEqual([]);
    expect(f.manager.forSession(task.sessionId)).toBeUndefined();
    expect(f.store.save).not.toHaveBeenCalled();
  });

  const proposal = (): OrchestrationProposal => ({
    version: 1,
    leadId: "lead",
    cwd: "/repo",
    request: "Build settings",
    author: { harness: "claude", model: "claude:test", name: "Lead" },
    settings: {
      choices: [{ harness: "codex", model: "codex:test", name: "Test" }],
      maxWorkers: 2,
    },
    status: "ready",
    title: "Settings",
    summary: "Split the work",
    tasks: [
      {
        id: "ui",
        title: "UI",
        prompt: "User edited instructions",
        harness: "codex",
        model: "codex:test",
        files: ["src/ui"],
        dependsOn: ["types"],
      },
      {
        id: "types",
        title: "Types",
        prompt: "Define the types",
        harness: "codex",
        model: "codex:test",
        files: ["src/types"],
        dependsOn: [],
      },
    ],
  });
  it("starts exactly the approved assignments and preserves forward dependencies", async () => {
    const f = setup();
    f.lead.busy = false;
    expect(f.host.submit).not.toHaveBeenCalled();
    await f.manager.startApproved("lead", "card", proposal());
    await vi.waitFor(() =>
      expect(f.host.createWorker).toHaveBeenCalledTimes(1),
    );
    expect(f.tasks().map((task) => task.status)).toEqual(["queued", "running"]);
    expect(f.tasks()[0].prompt).toBe("User edited instructions");
    expect(f.tasks()[0].dependsOn).toEqual([f.tasks()[1].id]);
    expect(f.manager.run("lead")?.proposalId).toBe("card");
    expect(f.saved.get("lead")?.tasks).toHaveLength(2);
    const workerPrompt = vi
      .mocked(f.host.submit)
      .mock.calls.find(
        ([id, prompt]) =>
          id !== "lead" && String(prompt).includes("<aven_assignment>"),
      )?.[1];
    expect(workerPrompt).toContain("Define the types");
    expect(workerPrompt).toContain("<aven_assignment>");
    expect(
      vi.mocked(f.host.submit).mock.calls.find(([id]) => id === "lead")?.[1],
    ).toContain("do not delegate duplicates");
  });
  it("gives a task's worker the role from the card once, in its first message", async () => {
    const f = setup();
    f.lead.busy = false;
    const card = proposal();
    card.tasks[1] = { ...card.tasks[1], role: "skeptic" };
    await f.manager.startApproved("lead", "card", card);
    await vi.waitFor(() =>
      expect(f.host.createWorker).toHaveBeenCalledTimes(1),
    );
    expect(f.tasks().map((task) => task.role)).toEqual([undefined, "skeptic"]);
    const sent = vi
      .mocked(f.host.submit)
      .mock.calls.filter(([id]) => id === f.tasks()[1].sessionId)
      .map(([, prompt]) => String(prompt));
    expect(sent).toHaveLength(1);
    expect(visibleUserPrompt(sent[0])).toMatch(
      /^Your role for this task: Skeptic\. Push back on weak points/,
    );
    // The lead knows which worker has which role.
    const lead = String(
      vi.mocked(f.host.submit).mock.calls.find(([id]) => id === "lead")?.[1],
    );
    expect(lead).toContain('"role":"Skeptic"');
    // A correction from the lead later carries no role again.
    f.completions.get(f.tasks()[1].sessionId)?.({
      status: "completed",
      text: "Done",
    });
    await vi.waitFor(() => expect(f.tasks()[1].status).toBe("completed"));
    await f.call("message", {
      taskId: f.tasks()[1].id,
      text: "Also cover the empty case.",
    });
    const sentToWorker = () =>
      vi
        .mocked(f.host.submit)
        .mock.calls.filter(([id]) => id === f.tasks()[1].sessionId)
        .map(([, prompt]) => String(prompt));
    await vi.waitFor(() => expect(sentToWorker()).toHaveLength(2));
    expect(visibleUserPrompt(sentToWorker()[1])).toBe(
      "Also cover the empty case.",
    );
  });

  it("never launches a partial plan when one assignment has invalid scopes", async () => {
    const f = setup();
    f.lead.busy = false;
    f.store.scopes.mockRejectedValueOnce(new Error("Scope escapes project"));
    await expect(
      f.manager.startApproved("lead", "card", proposal()),
    ).rejects.toThrow("Scope escapes");
    expect(f.store.enable).not.toHaveBeenCalled();
    expect(f.host.submit).not.toHaveBeenCalled();
  });
  it("requires a ready proposal and enforces the exact model pool for later CLI calls", async () => {
    const f = setup();
    f.lead.busy = false;
    await expect(
      f.manager.startApproved("lead", "card", {
        ...proposal(),
        status: "planning",
      }),
    ).rejects.toThrow("completed proposal");
    f.host.choices = () => [
      {
        harness: "codex",
        models: [
          { id: "codex:test", name: "Test" },
          { id: "codex:extra", name: "Unselected" },
        ],
      },
    ];
    await f.manager.startApproved("lead", "card", proposal());
    const result = (await f.call("list")) as {
      harnesses: { models: { id: string }[] }[];
    };
    expect(result.harnesses[0].models.map((model) => model.id)).toEqual([
      "codex:test",
    ]);
    await expect(
      f.delegate(["extra"], { model: "codex:extra" }),
    ).rejects.toThrow("model ID returned by list");
  });
  it("does not duplicate work when confirmation is repeated", async () => {
    const f = setup();
    f.lead.busy = false;
    const results = await Promise.allSettled([
      f.manager.startApproved("lead", "card", proposal()),
      f.manager.startApproved("lead", "card", proposal()),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(f.store.enable).toHaveBeenCalledTimes(1);
    expect(f.tasks()).toHaveLength(2);
  });
  it("ignores unavailable unused catalog models but blocks an unavailable assignment", async () => {
    const f = setup();
    f.lead.busy = false;
    const card = proposal();
    card.settings.choices.push({
      harness: "claude",
      model: "claude:removed",
      name: "Removed",
    });
    await f.manager.startApproved("lead", "card", card);
    expect(f.manager.run("lead")?.allowedHarnesses).toEqual(["codex"]);
    expect(f.manager.run("lead")?.allowedModels).toEqual(
      proposal().settings.choices,
    );

    const unavailable = setup();
    unavailable.lead.busy = false;
    card.tasks[0] = {
      ...card.tasks[0],
      harness: "claude",
      model: "claude:removed",
    };
    await expect(
      unavailable.manager.startApproved("lead", "card", card),
    ).rejects.toThrow("An assigned model is no longer available");
    expect(unavailable.store.enable).not.toHaveBeenCalled();
    expect(unavailable.host.submit).not.toHaveBeenCalled();
  });
  it("treats directory scopes as overlapping only at path boundaries", () => {
    expect(scopesOverlap(["/repo/src"], ["/repo/src/file.ts"])).toBe(true);
    expect(scopesOverlap(["/repo/src"], ["/repo/src2/file.ts"])).toBe(false);
    expect(scopesOverlap(["/repo"], ["/repo/anything"])).toBe(true);
  });
  it("runs disjoint workers concurrently and queues overlap", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["src/a"]);
    await f.delegate(["src/b"]);
    await f.delegate(["src/a/file.ts"]);
    await vi.waitFor(() =>
      expect(f.tasks().map((task) => task.status)).toEqual([
        "running",
        "running",
        "queued",
      ]),
    );
    expect(f.host.submit).toHaveBeenCalledTimes(2);
    f.completions.get(f.tasks()[0].sessionId)!({
      status: "completed",
      text: "Implemented A",
    });
    await vi.waitFor(() => expect(f.tasks()[2].status).toBe("running"));
    expect(f.tasks()[0].accepted).toBe(false);
  });
  it("keeps a dependency queued until the lead accepts the upstream result", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["src/types.ts"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    const upstream = f.tasks()[0];
    await f.delegate(["src/ui"], { dependsOn: [upstream.id] });
    f.completions.get(upstream.sessionId)!({
      status: "completed",
      text: "Types ready",
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    expect(f.tasks()[1].status).toBe("queued");
    await f.call("review", { taskId: upstream.id });
    await vi.waitFor(() => expect(f.tasks()[1].status).toBe("running"));
  });
  it("deduplicates command retries and rejects foreign tasks or unapproved harnesses", async () => {
    const f = setup();
    await f.start();
    const input = {
      title: "A",
      prompt: "Implement",
      harness: "codex",
      files: ["a"],
    };
    const first = await f.call("delegate", input, "same");
    expect(await f.call("delegate", input, "same")).toEqual(first);
    expect(f.tasks()).toHaveLength(1);
    await expect(
      f.call("delegate", { ...input, title: "B" }, "same"),
    ).rejects.toThrow("different input");
    await expect(f.call("get", { taskId: "foreign" })).rejects.toThrow(
      "does not belong",
    );
    await expect(f.delegate(["a"], { harness: "pi" })).rejects.toThrow(
      "not allowed",
    );
  });
  it("does not dispatch a worker if its task cannot be persisted", async () => {
    const f = setup();
    await f.start();
    f.store.save.mockRejectedValueOnce(new Error("Disk full"));
    await expect(f.delegate(["a"])).rejects.toThrow("Disk full");
    expect(f.manager.run("lead")!.status).toBe("paused");
    expect(f.host.submit).not.toHaveBeenCalled();
  });
  it("persists a delegation and its retry receipt in the same snapshot", async () => {
    const f = setup();
    await f.start();
    const input = {
      title: "A",
      prompt: "Implement",
      harness: "codex",
      files: ["a"],
    };
    await f.call("delegate", input, "durable");
    const firstTaskSave = f.store.save.mock.calls.find(
      ([run]) => run.tasks.length === 1,
    )![0];
    expect(firstTaskSave.requests.durable.result).toMatchObject({
      taskId: firstTaskSave.tasks[0].id,
    });
    const restored = new Orchestrator(f.store);
    restored.bind(f.host);
    await restored.hydrate("lead");
    expect(await restored.handle("lead", "durable", "delegate", input)).toEqual(
      firstTaskSave.requests.durable.result,
    );
    expect(restored.run("lead")!.tasks).toHaveLength(1);
  });
  it("rejects conflicting reuse of an in-flight request ID", async () => {
    const f = setup();
    await f.start();
    let release!: (paths: string[]) => void;
    f.store.scopes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const input = {
      title: "A",
      prompt: "Implement",
      harness: "codex",
      files: ["a"],
    };
    const pending = f.call("delegate", input, "pending");
    await vi.waitFor(() => expect(f.store.scopes).toHaveBeenCalled());
    await expect(
      f.call("delegate", { ...input, files: ["b"] }, "pending"),
    ).rejects.toThrow("different input");
    release(["/repo/a"]);
    await pending;
    expect(f.tasks()).toHaveLength(1);
  });
  it("stops an active worker if saving another assignment fails", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    f.store.save.mockRejectedValueOnce(new Error("Disk full"));
    await expect(f.delegate(["b"])).rejects.toThrow("Disk full");
    expect(f.host.stop).toHaveBeenCalledWith(f.tasks()[0].sessionId);
    expect(f.manager.run("lead")!.status).toBe("paused");
    expect(f.host.submit).toHaveBeenCalledTimes(1);
  });
  it("pauses and stops workers when a reported write escapes its scope", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["src/a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    f.manager.observe(f.tasks()[0].sessionId, {
      type: "tool.started",
      callId: "edit",
      title: "Edit",
      preview: { kind: "write", path: "src/a/../b/file.ts" },
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("cancelled"));
    expect(f.manager.run("lead")!.status).toBe("paused");
    expect(f.manager.run("lead")!.error).toBe(
      "“Task” changed a file outside the files it was given (src/a/../b/file.ts). Aven paused the run and stopped its agents. Check the files, then resume or stop the run.",
    );
  });
  it("keeps overlapping work queued when native termination is unconfirmed", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    vi.mocked(f.host.stop).mockRejectedValueOnce(
      new Error("process tree still running"),
    );
    await expect(f.call("cancel", { taskId: f.tasks()[0].id })).rejects.toThrow(
      "still running",
    );
    expect(f.tasks()[0].status).toBe("cancelling");
    expect(f.tasks()[1].status).toBe("queued");
    expect(f.host.submit).toHaveBeenCalledTimes(1);
  });
  it("holds ownership until a cancelled process has stopped", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    let stopped!: () => void;
    vi.mocked(f.host.stop).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          stopped = resolve;
        }),
    );
    const cancel = f.call("cancel", { taskId: f.tasks()[0].id });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("cancelling"));
    expect(f.tasks()[1].status).toBe("queued");
    stopped();
    await cancel;
    await vi.waitFor(() => expect(f.tasks()[1].status).toBe("running"));
  });
  it("stops queued work and suppresses lead continuation on stop", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    const done = f.completions.get(f.tasks()[0].sessionId)!;
    await f.manager.stopRun("lead");
    done({ status: "completed", text: "late output" });
    f.lead.busy = false;
    f.manager.sync();
    expect(f.tasks().map((task) => task.status)).toEqual([
      "cancelled",
      "cancelled",
    ]);
    expect(f.manager.run("lead")!.status).toBe("stopped");
    expect(f.store.disable).toHaveBeenCalledWith("lead");
    expect(f.host.submit).toHaveBeenCalledTimes(1);
  });
  it("returns worker output to an idle lead once", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    f.lead.busy = false;
    f.completions.get(f.tasks()[0].sessionId)!({
      status: "completed",
      text: "Tests pass",
    });
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(2));
    expect(vi.mocked(f.host.submit).mock.calls[1][0]).toBe("lead");
    expect(vi.mocked(f.host.submit).mock.calls[1][1]).toContain("Tests pass");
    f.manager.sync();
    expect(f.host.submit).toHaveBeenCalledTimes(2);
  });
  it("keeps results available and pauses when the lead cannot continue", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    f.lead.busy = false;
    f.completions.get(f.tasks()[0].sessionId)!({
      status: "completed",
      text: "Result",
    });
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(2));
    f.completions.get("lead")!({
      status: "failed",
      text: "",
      error: "Provider unavailable",
    });
    await vi.waitFor(() =>
      expect(f.manager.run("lead")!.status).toBe("paused"),
    );
    expect(f.tasks()[0].delivered).toBe(false);
    f.manager.sync();
    expect(f.host.submit).toHaveBeenCalledTimes(2);
  });
  it("recovers interrupted tasks as failed instead of re-executing edits", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    await vi.waitFor(() =>
      expect(f.saved.get("lead")?.tasks[0].status).toBe("running"),
    );
    const restored = new Orchestrator(f.store);
    restored.bind(f.host);
    const outcomes: string[] = [];
    restored.onOutcome(({ kind, run }) =>
      outcomes.push(`${kind}:${run.error}`),
    );
    await restored.hydrate("lead");
    expect(restored.run("lead")?.status).toBe("paused");
    expect(restored.run("lead")?.tasks[0].status).toBe("failed");
    expect(f.host.submit).toHaveBeenCalledTimes(1);
    // Said once, as any pause is, so Activity and the Dock agree.
    expect(outcomes).toEqual([
      "paused:Aven closed while the run was going. Check the files, then resume or stop the run.",
    ]);
    // A run that was already paused is not announced again.
    const again = new Orchestrator(f.store);
    again.bind(f.host);
    const more: string[] = [];
    again.onOutcome(({ kind }) => more.push(kind));
    await again.hydrate("lead");
    expect(more).toEqual([]);
  });
  it("does not claim a turn or run is successful before review", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await expect(f.call("finish")).rejects.toThrow("Review all");
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    f.completions.get(f.tasks()[0].sessionId)!({
      status: "failed",
      text: "Partial edits",
      error: "Provider crashed",
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("failed"));
    await expect(f.call("review", { taskId: f.tasks()[0].id })).rejects.toThrow(
      "Only a completed",
    );
  });
  it("names the way out of a run that cannot finish yet", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    f.completions.get(f.tasks()[0].sessionId)!({
      status: "failed",
      text: "",
      error: "Provider crashed",
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("failed"));
    // A failed task can never be reviewed, so both exits must be spelled out.
    await expect(f.call("review", { taskId: f.tasks()[0].id })).rejects.toThrow(
      /message.*cancel/,
    );
    await expect(f.call("finish")).rejects.toThrow(/Task \(failed\)/);
    await expect(f.call("finish")).rejects.toThrow(/message.*cancel/);
    await f.call("cancel", { taskId: f.tasks()[0].id });
    expect(await f.call("finish")).toEqual({ finished: true });
  });
  it("rejects mistyped fields instead of silently dropping them", async () => {
    const f = setup();
    await f.start();
    // Silently ignoring depends_on would race two workers over one file.
    await expect(
      f.delegate(["a"], { depends_on: [], modelId: "codex:test" }),
    ).rejects.toThrow("Unknown delegate fields: depends_on, modelId");
    await expect(f.call("finish", { taskId: "x" })).rejects.toThrow(
      "finish takes no input",
    );
    await expect(f.call("wait", { timeout: 5 })).rejects.toThrow(
      "wait accepts: timeoutSeconds",
    );
    expect(f.tasks()).toHaveLength(0);
  });
  it("points a bad delegate at the values list would have returned", async () => {
    const f = setup();
    await f.start();
    await expect(f.delegate(["a"], { harness: "claude" })).rejects.toThrow(
      'Harness "claude" is not allowed in this run. Allowed: codex.',
    );
    await expect(f.delegate(["a"], { model: "codex:ghost" })).rejects.toThrow(
      "Choose a model ID returned by list for codex: codex:test.",
    );
    await expect(f.delegate([], {})).rejects.toThrow("at least one file");
    await expect(
      f.call("delegate", {
        title: "T",
        prompt: "P",
        harness: "codex",
        files: ["a"],
        dependsOn: ["nope"],
      }),
    ).rejects.toThrow("unknown or cancelled: nope");
  });
  it("keeps the retry ledger free of inherited object keys", async () => {
    const f = setup();
    await f.start();
    const first = await f.call(
      "delegate",
      {
        title: "A",
        prompt: "Implement",
        harness: "codex",
        files: ["a"],
      },
      "constructor",
    );
    expect(first).toHaveProperty("taskId");
  });
  it("quotes the control path only when the shell needs it", () => {
    expect(shellPath("/Applications/Aven.app/Contents/MacOS/aven")).toBe(
      "/Applications/Aven.app/Contents/MacOS/aven",
    );
    expect(shellPath("/Users/a b/Aven")).toBe("'/Users/a b/Aven'");
    expect(shellPath("C:/Program Files/Aven/aven.exe")).toBe(
      '"C:/Program Files/Aven/aven.exe"',
    );
    expect(shellPath("C:\\Tools\\aven.exe")).toBe("C:\\Tools\\aven.exe");
    // A backslash escapes in a POSIX shell, so bare would rewrite the path.
    expect(shellPath("/Users/a\\b/Aven")).toBe("'/Users/a\\b/Aven'");
    expect(shellPath("/Users/it's/Aven")).toBe("'/Users/it'\\''s/Aven'");
  });
  it("treats an action named after an Object member as unknown", async () => {
    const f = setup();
    await f.start();
    for (const action of ["constructor", "toString", "__proto__"])
      await expect(f.call(action)).rejects.toThrow(
        `Unknown action "${action}"`,
      );
  });
  it("routes a blocked agent to the lead instead of the user", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    const worker = f.sessions.find(
      (session) => session.id === f.tasks()[0].sessionId,
    )!;
    worker.blocks = [
      {
        id: "ask",
        role: "approval",
        text: "rm -rf build",
        approval: { requestId: 7 },
      },
    ];
    const view = (await f.call("get", { taskId: f.tasks()[0].id })) as {
      needsInput?: { kind: string; requestId: number };
    };
    expect(view.needsInput).toMatchObject({ kind: "approval", requestId: 7 });
    // A stale or invented requestId must never decide a live prompt.
    await expect(
      f.call("respond", {
        taskId: f.tasks()[0].id,
        requestId: 6,
        decision: "allow",
      }),
    ).rejects.toThrow("Stale requestId");
    await expect(
      f.call("respond", {
        taskId: f.tasks()[0].id,
        requestId: 7,
        decision: "maybe",
      }),
    ).rejects.toThrow('decision must be "allow" or "deny"');
    await f.call("respond", {
      taskId: f.tasks()[0].id,
      requestId: 7,
      decision: "deny",
    });
    expect(f.host.respondApproval).toHaveBeenCalledWith(worker.id, 7, "deny");
  });
  it("validates the lead's answer against the agent's own question", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    const worker = f.sessions.find(
      (session) => session.id === f.tasks()[0].sessionId,
    )!;
    worker.pendingQuestion = {
      requestId: 9,
      title: "Pick a check",
      questions: [
        {
          id: "check",
          prompt: "Which check?",
          multiSelect: false,
          allowCustom: false,
          options: [{ id: "unit", label: "Unit" }],
        },
      ],
    };
    const taskId = f.tasks()[0].id;
    await expect(
      f.call("answer", { taskId, requestId: 9, answers: { check: ["e2e"] } }),
    ).rejects.toThrow("Unknown option");
    await expect(
      f.call("answer", { taskId, requestId: 9, answers: { nope: ["unit"] } }),
    ).rejects.toThrow("Unknown question");
    await f.call("answer", {
      taskId,
      requestId: 9,
      answers: { check: ["unit"] },
    });
    expect(f.host.answerQuestion).toHaveBeenCalledWith(worker.id, 9, {
      kind: "answered",
      answers: { check: ["unit"] },
    });
  });
  it.each(["approval", "question"] as const)(
    "returns from wait immediately when a worker already needs %s input",
    async (kind) => {
      const f = setup();
      await f.start();
      await f.delegate(["a"]);
      await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
      vi.useFakeTimers();
      const worker = f.sessions.find(
        (session) => session.id === f.tasks()[0].sessionId,
      )!;
      if (kind === "approval") {
        worker.blocks = [
          {
            id: "ask",
            role: "approval",
            text: "Run the check",
            approval: { requestId: 7 },
          },
        ];
      } else {
        worker.pendingQuestion = {
          requestId: 7,
          title: "Choose a check",
          questions: [
            {
              id: "check",
              prompt: "Which check?",
              multiSelect: false,
              allowCustom: true,
              options: [],
            },
          ],
        };
      }

      const waiting = f.call("wait", { timeoutSeconds: 20 }) as Promise<{
        tasks: Array<{ needsInput?: { kind: string; requestId: number } }>;
      }>;
      expect(vi.getTimerCount()).toBe(0);
      expect((await waiting).tasks[0].needsInput).toMatchObject({
        kind,
        requestId: 7,
      });
    },
  );
  it("wakes an active wait as soon as a worker needs input", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();
    const worker = f.sessions.find(
      (session) => session.id === f.tasks()[0].sessionId,
    )!;

    const waiting = f.call("wait", { timeoutSeconds: 20 }) as Promise<{
      tasks: Array<{ needsInput?: { kind: string; requestId: number } }>;
    }>;
    expect(vi.getTimerCount()).toBe(1);
    worker.blocks = [
      {
        id: "ask",
        role: "approval",
        text: "Run the check",
        approval: { requestId: 8 },
      },
    ];
    f.manager.sync();

    expect((await waiting).tasks[0].needsInput).toMatchObject({
      kind: "approval",
      requestId: 8,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stops the agents whenever the lead stops supervising", async () => {
    const f = setup();
    f.lead.busy = false;
    await f.manager.startApproved("lead", "card", proposal());
    await vi.waitFor(() =>
      expect(f.host.createWorker).toHaveBeenCalledTimes(1),
    );
    const running = f.tasks().find((task) => task.title === "Types")!;
    expect(running.status).toBe("running");
    // The lead's turn dies. Its agents must not carry on editing the shared
    // checkout with nobody left to review them.
    f.completions.get("lead")!({
      status: "failed",
      text: "",
      error: "Provider crashed",
    });
    await vi.waitFor(() =>
      expect(f.manager.run("lead")!.status).toBe("paused"),
    );
    await vi.waitFor(() =>
      expect(f.tasks().find((task) => task.title === "Types")!.status).toBe(
        "cancelled",
      ),
    );
    expect(f.host.stop).toHaveBeenCalledWith(running.sessionId);
    // Queued work is untouched, so resuming picks it up intact.
    expect(f.tasks().find((task) => task.title === "UI")!.status).toBe(
      "queued",
    );
  });
  it("steers a running agent and refuses one that is not", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    const task = f.tasks()[0];
    await f.call("steer", { taskId: task.id, text: "Use the existing helper" });
    expect(f.host.steer).toHaveBeenCalledWith(
      task.sessionId,
      "Use the existing helper",
    );
    // Steering must not end the turn, so the agent keeps its work.
    expect(f.tasks()[0].status).toBe("running");
    expect(f.host.stop).not.toHaveBeenCalledWith(task.sessionId);
    // A stopped agent takes a fresh turn instead, and the error says so.
    f.completions.get(task.sessionId)!({
      status: "completed",
      text: "Done",
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    await expect(
      f.call("steer", { taskId: task.id, text: "Too late" }),
    ).rejects.toThrow(/Only a running agent can be steered.*message/s);
  });
  it("blocks ordinary sessions while a run owns their checkout", async () => {
    const f = setup();
    await f.start();
    f.sessions.push({
      ...newSession("claude", "/repo"),
      id: "other",
      busy: false,
    });
    f.lead.title = "claude · Build settings";
    // Plain words: which project, which chat holds it, and what to do there.
    expect(f.manager.submissionError("other")).toBe(
      "repo is busy with an orchestration in “Build settings”. Finish or stop it there.",
    );
    expect(f.manager.blockingRun("other")?.leadId).toBe("lead");
    expect(f.manager.blockingRun("lead")).toBeUndefined();
    expect(f.manager.submissionError("lead")).toBeNull();
  });
});

describe("a run the lead left open", () => {
  const settle = (f: ReturnType<typeof setup>, index = 0) =>
    f.completions.get(f.tasks()[index].sessionId)!({
      status: "completed",
      text: "Done",
    });

  it("is stalled once the lead is idle and nothing can move it forward", async () => {
    const f = setup();
    await f.start();
    const first = (await f.delegate(["a"])) as { taskId: string };
    await f.delegate(["b"], { dependsOn: [first.taskId] });
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    const run = () => f.manager.run("lead")!;
    // An agent is working.
    f.lead.busy = false;
    expect(runStalled(run(), f.lead)).toBe(false);
    f.lead.busy = true;
    settle(f);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    // A result has not reached the lead yet: Aven will wake it.
    f.lead.busy = false;
    expect(runStalled(run(), f.lead)).toBe(false);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(2));
    expect(run().tasks[0].delivered).toBe(true);
    // The lead is reading the result.
    expect(runStalled(run(), f.lead)).toBe(false);
    f.completions.get("lead")!({ status: "completed", text: "All good." });
    // It ended its turn without accepting the first task, so the second can
    // never start and nothing will wake the lead again.
    expect(f.lead.busy).toBe(false);
    expect(dispatchableTask(run(), run().tasks[1])).toBe(false);
    expect(runStalled(run(), f.lead)).toBe(true);
    // A message waiting for the lead, or a question it asked you, will move it.
    f.lead.queuedMessages = [{ id: "q", text: "Wrap up", attachments: [] }];
    expect(runStalled(run(), f.lead)).toBe(false);
    f.lead.queuedMessages = [];
    // Accepting the first task lets the second one start.
    expect(
      dispatchableTask(run(), {
        ...run().tasks[1],
        dependsOn: [],
      }),
    ).toBe(true);
    await f.call("review", { taskId: first.taskId });
    await vi.waitFor(() => expect(run().tasks[1].status).toBe("running"));
    expect(runStalled(run(), f.lead)).toBe(false);
  });

  it("is never stalled while paused, finished or without its lead", async () => {
    const f = setup();
    await f.start();
    f.lead.busy = false;
    const run = f.manager.run("lead")!;
    expect(runStalled(run, f.lead)).toBe(true);
    expect(runStalled(run, undefined)).toBe(false);
    for (const status of ["paused", "finished", "stopped"] as const)
      expect(runStalled({ ...run, status }, f.lead)).toBe(false);
  });

  it("lets the user finish it, cancelling work that never started", async () => {
    const f = setup();
    await f.start();
    const first = (await f.delegate(["a"])) as { taskId: string };
    await f.delegate(["b"], { dependsOn: [first.taskId] });
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    await expect(f.manager.finishRun("lead")).rejects.toThrow(
      "Agents are still working",
    );
    settle(f);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    f.lead.busy = true;
    await expect(f.manager.finishRun("lead")).rejects.toThrow(
      "The lead is still working",
    );
    f.lead.busy = false;
    await f.manager.finishRun("lead");
    const run = f.manager.run("lead")!;
    expect(run.status).toBe("finished");
    expect(run.tasks.map((task) => task.status)).toEqual([
      "completed",
      "cancelled",
    ]);
    expect(f.saved.get("lead")?.status).toBe("finished");
    expect(f.store.disable).toHaveBeenCalledWith("lead");
    // The project is free again.
    f.sessions.push({
      ...newSession("claude", "/repo"),
      id: "other",
      busy: false,
    });
    expect(f.manager.submissionError("other")).toBeNull();
  });

  it("answers the lead's finish before revoking its control", async () => {
    vi.useFakeTimers();
    const f = setup();
    await f.start();
    expect(await f.call("finish")).toEqual({ finished: true });
    // Revoking first would drop this very call's reply.
    expect(f.store.disable).not.toHaveBeenCalled();
    f.manager.replied("lead");
    expect(f.store.disable).toHaveBeenCalledWith("lead");
    // Without a reply, access still goes soon after.
    const late = setup();
    await late.start();
    await late.call("finish");
    expect(late.store.disable).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(late.store.disable).toHaveBeenCalledWith("lead");
  });

  it("announces a finished or paused run once, and never a stopped one", async () => {
    const f = setup();
    const outcomes: string[] = [];
    f.manager.onOutcome(({ kind, run }) =>
      outcomes.push(`${kind}:${run.tasks.length}`),
    );
    await f.start();
    const task = (await f.delegate(["a"])) as { taskId: string };
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    settle(f);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    await f.call("review", { taskId: task.taskId });
    await f.call("finish");
    // A save of the finished run does not announce it again.
    await f.manager.finishRun("lead");
    expect(outcomes).toEqual(["finished:1"]);

    const paused = setup();
    const pauses: string[] = [];
    paused.manager.onOutcome(({ kind, run }) =>
      pauses.push(`${kind}:${run.error}`),
    );
    await paused.start();
    await paused.delegate(["src/a"]);
    await vi.waitFor(() => expect(paused.host.submit).toHaveBeenCalledTimes(1));
    paused.manager.observe(paused.tasks()[0].sessionId, {
      type: "tool.started",
      callId: "edit",
      title: "Edit",
      preview: { kind: "write", path: "/tmp/scratch.txt" },
    });
    await vi.waitFor(() =>
      expect(paused.manager.run("lead")!.status).toBe("paused"),
    );
    await paused.manager.stopRun("lead");
    expect(pauses).toHaveLength(1);
    expect(pauses[0]).toMatch(/^paused:“Task” changed a file outside/);
  });
});

describe("what only you can move on", () => {
  const team = (f: ReturnType<typeof setup>) =>
    orchestrationTeam(f.manager.run("lead")!, {
      session: (id) => f.sessions.find((session) => session.id === id),
      activity: [],
    });

  it("says the run needs you once its lead stopped without finishing", async () => {
    vi.useFakeTimers();
    const f = setup();
    await f.start();
    f.lead.busy = false;
    f.manager.sync();
    // Aven may still wake it with results; wait a moment first.
    expect(team(f).status).toBe("running");
    await vi.advanceTimersByTimeAsync(LEAD_STALLED_AFTER_MS);
    expect(f.manager.run("lead")!.stalledAt).toEqual(expect.any(Number));
    expect(team(f)).toMatchObject({
      status: "needs-you",
      need: {
        sessionId: "lead",
        kind: "error",
        text: "The lead stopped without finishing",
      },
    });
    // The lead working again clears it.
    f.lead.busy = true;
    f.manager.sync();
    expect(f.manager.run("lead")!.stalledAt).toBeUndefined();
    expect(team(f).status).toBe("running");
    // A run that is over keeps no stall.
    f.lead.busy = false;
    f.manager.sync();
    await vi.advanceTimersByTimeAsync(LEAD_STALLED_AFTER_MS);
    await f.manager.finishRun("lead");
    expect(f.manager.run("lead")!.stalledAt).toBeUndefined();
  });

  it("hands you an agent's request the lead was told about and left unanswered", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    const worker = f.sessions.find(
      (session) => session.id === f.tasks()[0].sessionId,
    )!;
    worker.orchestrationLeadId = "lead";
    worker.busy = true;
    worker.blocks = [
      {
        id: "ask",
        role: "approval",
        text: "rm -rf build",
        approval: { requestId: 7 },
      },
    ];
    const deciding = () =>
      leadDecidedIds(f.manager.snapshot(), (id) =>
        f.sessions.find((session) => session.id === id),
      );
    vi.useFakeTimers();
    // The lead is told once it is free.
    f.lead.busy = false;
    f.manager.sync();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.host.submit).toHaveBeenCalledTimes(2);
    expect(f.host.submit).toHaveBeenLastCalledWith(
      "lead",
      expect.stringContaining("blocked waiting on you"),
      expect.any(Function),
    );
    // While it works, the request stays its own to decide.
    await vi.advanceTimersByTimeAsync(UNANSWERED_AFTER_MS * 2);
    expect(f.tasks()[0].escalated).toBeUndefined();
    expect(sessionNeedsUser(worker, deciding())).toBe(false);
    // It ends its turn without answering.
    f.completions.get("lead")!({ status: "completed", text: "Hmm." });
    expect(team(f).members[1].state).toBe("lead-deciding");
    await vi.advanceTimersByTimeAsync(UNANSWERED_AFTER_MS - 1);
    expect(f.tasks()[0].escalated).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.tasks()[0].escalated).toBe("approval:7");
    // Now it is yours: the chat asks you, and the run needs you there.
    expect(sessionNeedsUser(worker, deciding())).toBe(true);
    expect(team(f)).toMatchObject({
      status: "needs-you",
      need: { sessionId: worker.id, kind: "approval", blocking: true },
    });
    expect(team(f).members[1]).toMatchObject({
      state: "needs-you",
      asking: { kind: "approval" },
    });
    // Once answered, the agent's next request is the lead's again.
    worker.blocks = [
      { ...worker.blocks[0], approval: { requestId: 7, decided: "allow" } },
    ];
    f.manager.sync();
    expect(f.tasks()[0].escalated).toBeUndefined();
    worker.blocks = [
      ...worker.blocks,
      {
        id: "ask2",
        role: "approval",
        text: "npm install",
        approval: { requestId: 8 },
      },
    ];
    expect(sessionNeedsUser(worker, deciding())).toBe(false);
  });

  it("never hands you a request while the lead is busy deciding", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    const worker = f.sessions.find(
      (session) => session.id === f.tasks()[0].sessionId,
    )!;
    worker.busy = true;
    worker.blocks = [
      {
        id: "ask",
        role: "approval",
        text: "rm -rf build",
        approval: { requestId: 7 },
      },
    ];
    vi.useFakeTimers();
    f.lead.busy = false;
    f.manager.sync();
    await vi.advanceTimersByTimeAsync(0);
    f.completions.get("lead")!({ status: "completed", text: "Checking." });
    await vi.advanceTimersByTimeAsync(UNANSWERED_AFTER_MS / 2);
    // The user messages the lead: it is working again.
    f.lead.busy = true;
    f.manager.sync();
    await vi.advanceTimersByTimeAsync(UNANSWERED_AFTER_MS * 2);
    expect(f.tasks()[0].escalated).toBeUndefined();
  });

  it("keeps a finished run finished when saving its verdict fails", async () => {
    const f = setup();
    await f.start();
    f.lead.busy = false;
    await f.manager.finishRun("lead");
    f.store.save.mockRejectedValueOnce(new Error("disk full"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const stops = vi.mocked(f.host.stop).mock.calls.length;
    await expect(f.manager.noteVerdict("lead", "Done.")).rejects.toThrow(
      "disk full",
    );
    expect(f.manager.run("lead")!.status).toBe("finished");
    expect(vi.mocked(f.host.stop).mock.calls).toHaveLength(stops);
    errors.mockRestore();
  });

  it("sends no continuation to a run that ended while it was saved", async () => {
    const f = setup();
    await f.start();
    await f.delegate(["a"]);
    await vi.waitFor(() => expect(f.host.submit).toHaveBeenCalledTimes(1));
    f.completions.get(f.tasks()[0].sessionId)!({
      status: "completed",
      text: "Done",
    });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    let release!: () => void;
    f.store.save.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    f.lead.busy = false;
    f.manager.sync();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const finishing = f.manager.finishRun("lead");
    release();
    await finishing;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.manager.run("lead")!.status).toBe("finished");
    expect(f.host.submit).toHaveBeenCalledTimes(1);
  });
});
