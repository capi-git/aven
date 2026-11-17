import { afterEach, describe, expect, it, vi } from "vitest";
import {
  blockingRunFor,
  helperBrief,
  helperTurnPrompt,
  MAX_HELPERS,
  Orchestrator,
  visibleUserPrompt,
  type ControlOutcome,
  type OrchestrationHost,
  type OrchestrationRun,
  type ShownTurn,
} from "./orchestration";
import {
  prepareGuidanceTurn,
  resetGuidanceDeliveryState,
} from "./agentGuidanceDelivery";
import { newSession, type Block } from "./session";
import { leadDecidedIds } from "./teamAttention";
import { teamRunsFrom } from "./teamRuns";

const CLI = "/Applications/Aven.app/Contents/MacOS/aven";

function setup({ asksFirst = false } = {}) {
  const saved = new Map<string, OrchestrationRun>();
  const store = {
    save: vi.fn(async (run: OrchestrationRun) => {
      saved.set(run.leadId, structuredClone(run));
    }),
    load: vi.fn(async (id: string) => saved.get(id) ?? null),
    enable: vi.fn(async () => CLI),
    disable: vi.fn(async () => {}),
    scopes: vi.fn(async (_cwd: string, files: string[]) =>
      files.map((file) => (file === "." ? "/repo" : `/repo/${file}`)),
    ),
  };
  const manager = new Orchestrator(store);
  const ask: Block = {
    id: "ask",
    role: "user",
    text: "Start two agents side by side",
  };
  const lead = {
    ...newSession("claude", "/repo"),
    model: "claude:opus",
    id: "lead",
    title: "Fix the hero",
    busy: true,
    blocks: [ask],
  };
  const sessions = [lead];
  const completions = new Map<string, (outcome: ControlOutcome) => void>();
  const shown = new Map<string, ShownTurn | undefined>();
  const sent = new Map<string, string>();
  const host: OrchestrationHost = {
    session: (id) => sessions.find((session) => session.id === id),
    sessions: () => sessions,
    choices: () => [
      {
        harness: "claude",
        models: [
          { id: "claude:sonnet", name: "Sonnet 5" },
          { id: "claude:opus", name: "Opus 5.5" },
        ],
      },
      { harness: "codex", models: [{ id: "codex:test", name: "Test" }] },
    ],
    createWorker: vi.fn(async (run, task) => {
      sessions.push({
        ...newSession(task.harness, run.cwd, task.model),
        id: task.sessionId,
        orchestrationLeadId: run.leadId,
        busy: false,
      });
    }),
    submit: vi.fn((id, text, done, turn) => {
      const session = sessions.find((session) => session.id === id)!;
      session.busy = true;
      shown.set(id, turn);
      sent.set(id, text);
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
    answerQuestion: vi.fn(() => true),
    asksFirst: () => asksFirst,
  };
  manager.bind(host);
  let request = 0;
  const call = (action: string, input: Record<string, unknown> = {}) =>
    manager.handle("lead", `request-${++request}`, action, input);
  const settle = async () => {
    for (let index = 0; index < 5; index++)
      await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return {
    manager,
    store,
    host,
    lead,
    sessions,
    call,
    completions,
    shown,
    sent,
    settle,
  };
}

afterEach(() => {
  vi.useRealTimers();
  resetGuidanceDeliveryState();
});

describe("helpers a chat starts when asked", () => {
  it("tells a chat how, once, and only after it was given the command", async () => {
    const f = setup();
    expect(f.manager.prompt("lead", "Hi")).toBe("Hi");
    expect(await f.manager.allowHelpers("lead", "/repo")).toBe(true);
    expect(f.store.enable).toHaveBeenCalledWith("lead", "/repo", true);
    const first = f.manager.prompt("lead", "Start two agents");
    expect(first).toContain(helperBrief(`${CLI} control`));
    expect(first).toContain(`Run \`${CLI} control --help\``);
    // The conversation holds it after its first message: a reminder.
    prepareGuidanceTurn({
      harness: "claude",
      sessionId: "lead",
      cwd: "/repo",
      text: first,
    });
    const second = prepareGuidanceTurn({
      harness: "claude",
      sessionId: "lead",
      cwd: "/repo",
      text: f.manager.prompt("lead", "Thanks"),
    }).text;
    expect(second).not.toContain("Give each helper a title");
    expect(second).toContain("You can still start helpers");
  });

  it("stays quiet when the project refuses helpers", async () => {
    const f = setup();
    f.store.enable.mockRejectedValueOnce(new Error("orchestrator holds it"));
    expect(await f.manager.allowHelpers("lead", "/repo")).toBe(false);
    expect(f.manager.prompt("lead", "Hi")).toBe("Hi");
  });

  it("starts helpers on the chat's model with no plan, files or review", async () => {
    const f = setup();
    await f.manager.allowHelpers("lead", "/repo");
    expect(await f.call("list")).toMatchObject({ helpers: [] });
    await expect(f.call("get", { taskId: "x" })).rejects.toThrow(
      "No helpers yet",
    );
    const started = (await f.call("delegate", {
      title: "Hero",
      prompt: "Make the hero wrap.",
    })) as { taskId: string };
    await f.call("delegate", { title: "Pricing", prompt: "Check pricing." });
    await f.settle();
    const run = f.manager.run("lead")!;
    expect(run).toMatchObject({
      mode: "helpers",
      status: "active",
      maxWorkers: MAX_HELPERS,
      title: "Fix the hero",
    });
    expect(
      run.tasks.map((task) => [task.title, task.harness, task.model]),
    ).toEqual([
      ["Hero", "claude", "claude:opus"],
      ["Pricing", "claude", "claude:opus"],
    ]);
    // Under the reply of the message that asked; no files reserved, so
    // both start at once.
    expect(run.tasks.every((task) => task.turn === "ask")).toBe(true);
    expect(run.tasks.every((task) => task.scopes.length === 0)).toBe(true);
    expect(run.tasks.map((task) => task.status)).toEqual([
      "running",
      "running",
    ]);
    const helper = run.tasks.find((task) => task.id === started.taskId)!;
    expect(f.shown.get(helper.sessionId)).toEqual({
      kind: "helper-task",
      from: "Fix the hero",
      harness: "claude",
      model: "Opus 5.5",
    });
    expect(visibleUserPrompt(f.sent.get(helper.sessionId)!)).toBe(
      "Make the hero wrap.",
    );
  });

  it("wakes the chat once, when every helper is done, then ends", async () => {
    const f = setup();
    await f.manager.allowHelpers("lead", "/repo");
    await f.call("delegate", { title: "Hero", prompt: "Hero." });
    await f.call("delegate", { title: "Pricing", prompt: "Pricing." });
    await f.settle();
    f.lead.busy = false;
    const [hero, pricing] = f.manager.run("lead")!.tasks;
    f.completions.get(hero.sessionId)!({ status: "completed", text: "Done" });
    await f.settle();
    f.manager.sync();
    await f.settle();
    // One helper still works: the chat is not woken yet.
    expect(f.host.submit).not.toHaveBeenCalledWith(
      "lead",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    f.completions.get(pricing.sessionId)!({
      status: "completed",
      text: "Checked",
    });
    await f.settle();
    f.manager.sync();
    await f.settle();
    expect(f.shown.get("lead")).toEqual({ kind: "helpers-done", count: 2 });
    expect(f.sent.get("lead")).toContain("Your helpers are done.");
    expect(f.manager.run("lead")!.tasks.every((task) => task.accepted)).toBe(
      true,
    );
    expect(f.manager.run("lead")!.status).toBe("active");
    f.completions.get("lead")!({ status: "completed", text: "Reported" });
    await f.settle();
    f.manager.sync();
    await f.settle();
    expect(f.manager.run("lead")!.status).toBe("finished");
    expect(
      (f.host.submit as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([id]) => id === "lead",
      ),
    ).toHaveLength(1);
    // A later request starts helpers again, keeping the earlier ones.
    f.lead.busy = true;
    await f.call("delegate", { title: "Docs", prompt: "Docs." });
    expect(f.manager.run("lead")!.status).toBe("active");
    expect(f.manager.run("lead")!.tasks).toHaveLength(3);
  });

  it("holds at most four at once", async () => {
    const f = setup();
    await f.manager.allowHelpers("lead", "/repo");
    for (let index = 0; index < MAX_HELPERS; index++)
      await f.call("delegate", { title: `H${index}`, prompt: "Work." });
    await expect(
      f.call("delegate", { title: "One more", prompt: "Work." }),
    ).rejects.toThrow(`At most ${MAX_HELPERS} helpers`);
  });

  it("waits for you first when the project asks before building", async () => {
    const f = setup({ asksFirst: true });
    await f.manager.allowHelpers("lead", "/repo");
    await f.call("delegate", { title: "Hero", prompt: "Hero." });
    await f.settle();
    expect(f.manager.run("lead")!.held).toBe(true);
    expect(f.host.createWorker).not.toHaveBeenCalled();
    await f.manager.startHelpers("lead");
    await f.settle();
    expect(f.host.createWorker).toHaveBeenCalledTimes(1);
    expect(f.manager.run("lead")!.tasks[0].status).toBe("running");
  });

  it("leaves other chats, the lead's Stop and helpers' requests alone", async () => {
    const f = setup();
    await f.manager.allowHelpers("lead", "/repo");
    await f.call("delegate", { title: "Hero", prompt: "Hero." });
    await f.settle();
    const run = f.manager.run("lead")!;
    const helper = run.tasks[0].sessionId;
    // Another chat in the project keeps working.
    expect(blockingRunFor([run], "other", "/repo")).toBeUndefined();
    // Stopping the chat stops its own turn, not its helpers.
    expect(f.manager.stopForSession("lead")).toBeNull();
    // A helper asks you itself, in its pane.
    expect(leadDecidedIds([run], () => undefined).size).toBe(0);
    // It takes your messages once its task is done, not while it works.
    expect(f.manager.submissionError(helper)).toContain("still working");
    f.completions.get(helper)!({ status: "completed", text: "Done" });
    await f.settle();
    expect(f.manager.submissionError(helper)).toBeNull();
    // No team bar: its card and panes show it.
    expect(
      teamRunsFrom(
        { discussions: [], races: [], runs: [run] },
        { session: () => undefined, activity: [] },
      ),
    ).toEqual([]);
  });

  it("ends helpers cut short by a reload instead of pausing", async () => {
    const f = setup();
    await f.manager.allowHelpers("lead", "/repo");
    await f.call("delegate", { title: "Hero", prompt: "Hero." });
    await f.settle();
    const saved = structuredClone(f.manager.run("lead")!);
    const reloaded = new Orchestrator({
      ...f.store,
      load: vi.fn(async () => saved),
    });
    reloaded.bind(f.host);
    await reloaded.hydrate("lead");
    const run = reloaded.run("lead")!;
    expect(run.status).toBe("finished");
    expect(run.tasks[0]).toMatchObject({
      status: "failed",
      delivered: true,
      error: "Stopped when Aven closed.",
    });
  });
});

describe("a helper's message", () => {
  it("shows the task and hides the rules it works by", () => {
    const text = helperTurnPrompt("Fix the hero.", ["src/hero.css"]);
    expect(visibleUserPrompt(text)).toBe("Fix the hero.");
    expect(text).toContain("Change only these paths: src/hero.css");
    expect(text).toContain("stage or commit");
  });
});
