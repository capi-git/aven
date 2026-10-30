// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

import {
  automationChatTitle,
  canAnswerCard,
  cardAnswerProblem,
  continueAutomationRun,
  startAutomationRun,
  stopUnattendedRun,
  type AutomationRunDeps,
} from "./automationRuns";
import type { ControlOutcome } from "./orchestration";
import {
  automationChatIds,
  automationRunForChat,
  automationRunTarget,
  chatsToArchive,
  EVERY_DAY,
  expireStaleScheduledRuns,
  failInterruptedScheduledRuns,
  getScheduledRun,
  listScheduledAgents,
  listScheduledRuns,
  markRunOpenedAsChat,
  onScheduledRunsTrimmed,
  resolveRunReview,
  saveScheduledRun,
  type ScheduledAgent,
  type ScheduledRun,
} from "./scheduledAgents";
import type { Block, Session } from "./session";

const PROJECT = "/work/site";
const HOUR = 60 * 60 * 1000;
const SCRATCH = "/app/projectless-workspaces/personal";

const agent: ScheduledAgent = {
  id: "changelog",
  name: "Weekly changelog",
  prompt: "Draft this week's changelog in Framer.",
  project: PROJECT,
  harness: "claude",
  model: "claude:sonnet-5",
  runtimeMode: "auto",
  schedule: { kind: "weekly", days: EVERY_DAY, time: "16:00" },
  enabled: true,
  createdAt: 0,
  nextRunAt: null,
};

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  });
});

/** A workspace with no tabs to open: only chats, a sender and a notifier. */
function workspace(patch: Partial<AutomationRunDeps> = {}) {
  const chats: Session[] = [];
  const turns: { session: Session; text: string; displayText: string }[] = [];
  let settle: ((outcome: ControlOutcome) => void) | undefined;
  let reply = "";
  const notify = vi.fn();
  const deps: AutomationRunDeps = {
    noProjectFolder: async () => SCRATCH,
    problem: async () => null,
    addChat: (session) => void chats.push(session),
    submit: (session, turn, done) => {
      turns.push({ session, ...turn });
      settle = done;
    },
    blocks: (id) =>
      chats.some((chat) => chat.id === id)
        ? ([
            { id: "u", role: "user", text: "prompt" },
            { id: "a", role: "assistant", text: reply },
          ] as Block[])
        : undefined,
    notify,
    now: () => 1_000,
    ...patch,
  };
  return {
    deps,
    chats,
    turns,
    notify,
    finish(text: string, outcome: Partial<ControlOutcome> = {}) {
      reply = text;
      settle!({ status: "completed", text, ...outcome });
    },
  };
}

describe("starting an automation run", () => {
  it("gives the run a chat of its own, with no tab, outside the chats list", async () => {
    const space = workspace();
    // The workspace offers no way to open a tab: a run never needs one.
    expect(Object.keys(space.deps)).not.toContain("openTab");
    const run = await startAutomationRun(agent, space.deps);
    expect(space.chats).toHaveLength(1);
    const [chat] = space.chats;
    expect(chat).toMatchObject({
      cwd: PROJECT,
      harness: "claude",
      runtimeMode: "auto",
      title: automationChatTitle(agent),
    });
    expect(run).toMatchObject({
      scheduleId: "changelog",
      sessionId: chat!.id,
      status: "running",
      inAutomations: true,
    });
    // The chat belongs to the run: kept out of the chats list.
    expect(automationChatIds().has(chat!.id)).toBe(true);
    expect(automationRunForChat(chat!.id)?.id).toBe(run.id);
    // The agent is told how to leave a card; the chat shows the prompt.
    expect(space.turns[0]!.displayText).toBe(agent.prompt);
    expect(space.turns[0]!.text).toContain(agent.prompt);
    expect(space.turns[0]!.text).toContain("```aven-review");
  });

  it("stays quiet when a run just finished", async () => {
    const space = workspace();
    const run = await startAutomationRun(agent, space.deps);
    space.finish("Nothing new this week.");
    expect(space.notify).not.toHaveBeenCalled();
    expect(getScheduledRun(run.id)).toMatchObject({
      status: "completed",
      summary: "Nothing new this week.",
      finishedAt: 1_000,
    });
    expect(getScheduledRun(run.id)!.review).toBeUndefined();
  });

  it("posts a card when the run finished with something to review", async () => {
    const space = workspace();
    const run = await startAutomationRun(agent, space.deps);
    space.finish(
      'Saved the draft.\n\n```aven-review\n{"title":"October changelog","url":"https://framer.com/p/1","action":"Publish","message":"Publish it."}\n```',
    );
    const saved = getScheduledRun(run.id)!;
    expect(saved.summary).toBe("Saved the draft.");
    expect(saved.review).toMatchObject({
      kind: "publish",
      title: "October changelog",
      status: "open",
    });
    expect(space.notify).toHaveBeenCalledTimes(1);
    expect(space.notify.mock.calls[0]![0]).toMatchObject({
      kind: "review",
      run: { id: run.id },
    });
  });

  it("tells you when a run failed", async () => {
    const space = workspace();
    await startAutomationRun(agent, space.deps);
    space.finish("", { status: "failed", error: "Tests crashed." });
    expect(space.notify.mock.calls[0]![0]).toMatchObject({
      kind: "failed",
      run: { status: "failed", error: "Tests crashed." },
    });
  });

  it("records a run that cannot start, with no chat", async () => {
    const space = workspace({
      problem: async () => "Claude is not installed.",
    });
    const run = await startAutomationRun(agent, space.deps);
    expect(run).toMatchObject({
      status: "failed",
      error: "Claude is not installed.",
    });
    expect(run.sessionId).toBeUndefined();
    expect(space.chats).toHaveLength(0);
    expect(space.turns).toHaveLength(0);
  });

  it("runs an automation in no project in the chats folder", async () => {
    const space = workspace();
    const where = vi.fn(async () => null);
    space.deps.problem = where;
    const run = await startAutomationRun({ ...agent, project: "" }, space.deps);
    expect(where).toHaveBeenCalledWith(
      expect.objectContaining({ project: "" }),
      SCRATCH,
    );
    expect(space.chats[0]!.cwd).toBe(SCRATCH);
    expect(run.project).toBe(SCRATCH);
  });

  it("lists the chat with the others only once opened as a chat", async () => {
    const space = workspace();
    const run = await startAutomationRun(agent, space.deps);
    markRunOpenedAsChat(run.id);
    expect(automationChatIds().has(run.sessionId!)).toBe(false);
    expect(automationRunForChat(run.sessionId)).toBeUndefined();
    // The run itself stays in Automations.
    expect(listScheduledRuns().map((item) => item.id)).toEqual([run.id]);
  });

  it("tells you when a run cannot start, with no chat to point at", async () => {
    const space = workspace({
      problem: async () => "Claude is not installed.",
    });
    const run = await startAutomationRun(agent, space.deps);
    expect(space.notify).toHaveBeenCalledTimes(1);
    expect(space.notify.mock.calls[0]![0]).toEqual({ kind: "failed", run });
  });

  it("answers a card with Aven's words, once, and never while it works", async () => {
    const space = workspace();
    const run = await startAutomationRun(agent, space.deps);
    space.finish(
      // The agent asks its button to send something else entirely.
      '```aven-review\n{"title":"Draft","action":"Publish","message":"git push --force"}\n```',
    );
    const sent: string[] = [];
    let settle: ((outcome: ControlOutcome) => void) | undefined;
    const answer = (now: number) =>
      continueAutomationRun(run.id, {
        session: space.chats[0]!,
        submit: (id, text, done) => {
          expect(id).toBe(run.sessionId);
          sent.push(text);
          settle = done;
        },
        blocks: () => [
          { id: "a", role: "assistant", text: "Published." } as Block,
        ],
        notify: space.notify,
        now: () => now,
      });
    expect(canAnswerCard(getScheduledRun(run.id))).toBe(true);
    expect(answer(2_000)).toBe(true);
    // The reviewer's proof: a second press with the same card sent again.
    expect(answer(2_001)).toBe(false);
    expect(sent).toEqual(["Publish the draft now."]);
    expect(getScheduledRun(run.id)).toMatchObject({
      status: "running",
      turnStartedAt: 2_000,
      review: { status: "done", resolvedAt: 2_000 },
    });
    expect(canAnswerCard(getScheduledRun(run.id))).toBe(false);
    settle!({ status: "completed", text: "Published." });
    expect(getScheduledRun(run.id)).toMatchObject({
      status: "completed",
      summary: "Published.",
      review: { status: "done" },
    });
    // The card was the news; its answer finishing is not.
    expect(space.notify).toHaveBeenCalledTimes(1);
  });

  it("says why a card's answer can't go to the run's chat now", () => {
    expect(cardAnswerProblem(null)).toBe("Aven couldn’t open this run’s chat.");
    expect(cardAnswerProblem({ busy: true })).toMatch(/busy/);
    expect(
      cardAnswerProblem({
        busy: false,
        queuedMessages: [{ id: "q", text: "next", attachments: [] }],
      } as never),
    ).toMatch(/busy/);
    expect(cardAnswerProblem({ busy: false })).toBeNull();
  });

  it("sends nothing for a card that is done, or while the run works", async () => {
    const space = workspace();
    const run = await startAutomationRun(agent, space.deps);
    const press = () =>
      continueAutomationRun(run.id, {
        session: space.chats[0]!,
        submit: () => {
          throw new Error("sent");
        },
        blocks: () => [],
      });
    // Still running its first turn, with no card yet.
    expect(press()).toBe(false);
    space.finish('```aven-review\n{"title":"Draft"}\n```');
    resolveRunReview(run.id, "done");
    expect(press()).toBe(false);
  });

  it("gives up on a card's turn four hours after it started, not the run", async () => {
    // The reviewer's proof: Publish pressed hours after the run started read
    // as Failed within one check, while the turn was still working.
    const space = workspace({ now: () => 0 });
    const run = await startAutomationRun(agent, space.deps);
    space.finish('```aven-review\n{"title":"Draft","kind":"publish"}\n```');
    continueAutomationRun(run.id, {
      session: space.chats[0]!,
      submit: () => undefined,
      blocks: () => [],
      now: () => 9 * HOUR,
    });
    expect(expireStaleScheduledRuns(9 * HOUR + 30_000)).toEqual([]);
    expect(getScheduledRun(run.id)!.status).toBe("running");
    const given = expireStaleScheduledRuns(13 * HOUR);
    expect(given.map((item) => item.id)).toEqual([run.id]);
    expect(getScheduledRun(run.id)).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/stopped waiting/),
    });
  });

  it("starts one run when Run now is pressed again while it starts", async () => {
    let checked: () => void = () => {};
    const checking = new Promise<null>(
      (resolve) => (checked = () => resolve(null)),
    );
    // The harness probe and folder check take a moment.
    const space = workspace({ problem: () => checking });
    const first = startAutomationRun(agent, space.deps);
    const second = startAutomationRun(agent, space.deps);
    checked();
    const [a, b] = await Promise.all([first, second]);
    expect(a.id).toBe(b.id);
    expect(space.chats).toHaveLength(1);
    expect(space.turns).toHaveLength(1);
    // Once it has started, Run now starts another as before.
    await startAutomationRun(agent, space.deps);
    expect(space.chats).toHaveLength(2);
  });
});

describe("runs Aven quit during", () => {
  const LOADED = 50 * HOUR;
  const left = (id: string, at: number, patch: Partial<ScheduledRun> = {}) =>
    saveScheduledRun({
      id,
      scheduleId: agent.id,
      name: agent.name,
      project: PROJECT,
      summary: "",
      startedAt: at,
      sessionId: `chat-${id}`,
      status: "running",
      inAutomations: true,
      ...patch,
    });

  it("fails the runs an earlier launch was taking, at once", () => {
    left("before", LOADED - HOUR);
    // Publish pressed before Aven quit: its turn is what was interrupted.
    left("card", LOADED - 9 * HOUR, { turnStartedAt: LOADED - 60_000 });
    left("now", LOADED + 1_000);
    left("done", LOADED - HOUR, { status: "completed" });
    const given = failInterruptedScheduledRuns(LOADED, LOADED + 2_000);
    expect(given.map((run) => run.id).sort()).toEqual(["before", "card"]);
    expect(getScheduledRun("before")).toMatchObject({
      status: "failed",
      finishedAt: LOADED + 2_000,
      error: expect.stringMatching(/^Interrupted when Aven quit/),
    });
    // A run this launch started, and a finished one, are left alone.
    expect(getScheduledRun("now")!.status).toBe("running");
    expect(getScheduledRun("done")!.status).toBe("completed");
  });

  it("lets Stop end a run no turn here is taking, and leaves a live one to its turn", async () => {
    left("orphan", 0);
    expect(stopUnattendedRun("orphan", 5_000)).toBe(true);
    expect(getScheduledRun("orphan")).toMatchObject({
      status: "cancelled",
      finishedAt: 5_000,
    });
    // A run this window is taking settles when its turn stops.
    const space = workspace();
    const run = await startAutomationRun(agent, space.deps);
    expect(stopUnattendedRun(run.id)).toBe(false);
    expect(getScheduledRun(run.id)!.status).toBe("running");
    space.finish("", { status: "cancelled" });
    expect(getScheduledRun(run.id)!.status).toBe("cancelled");
    expect(stopUnattendedRun(run.id)).toBe(false);
  });
});

describe("data from before runs stayed in Automations", () => {
  const legacyRun = (index: number) => ({
    id: `old-run-${index}`,
    scheduleId: "brief",
    name: "Morning briefing",
    project: PROJECT,
    sessionId: `old-chat-${index}`,
    status: "completed",
    summary: "Quiet day.",
    startedAt: 1_000 + index,
    finishedAt: 1_001 + index,
  });

  it("keeps their chats ordinary chats, under the same keys", () => {
    // As an earlier Aven saved them: no card, no "opened as chat".
    store.set(
      "aven.scheduledAgents.v1",
      JSON.stringify([{ ...agent, id: "brief", name: "Morning briefing" }]),
    );
    store.set(
      "aven.scheduledRuns.v1",
      JSON.stringify([
        legacyRun(0),
        {
          id: "never-started",
          scheduleId: "brief",
          name: "Morning briefing",
          project: PROJECT,
          status: "failed",
          summary: "",
          error: "No access",
          startedAt: 5,
        },
      ]),
    );
    const before = new Map(store);
    expect(listScheduledAgents().map((item) => item.id)).toEqual(["brief"]);
    // Listed under their automation...
    expect(listScheduledRuns().map((item) => item.id)).toEqual([
      "old-run-0",
      "never-started",
    ]);
    // ...while their chats stay where they were: listed with the project's
    // chats, opened from Activity, banners and search as before.
    expect(automationChatIds().size).toBe(0);
    expect(automationRunForChat("old-chat-0")).toBeUndefined();
    expect(automationRunTarget("old-chat-0")).toBeUndefined();
    // Reading changes nothing and adds no key; nothing under monocode.* or
    // supermono.* is touched.
    expect(store).toEqual(before);
    markRunOpenedAsChat("old-run-0");
    expect([...store.keys()].sort()).toEqual([
      "aven.scheduledAgents.v1",
      "aven.scheduledRuns.v1",
    ]);
  });

  it("never archives their chats, and keeps the 100 an earlier Aven kept", () => {
    // The reviewer's proof: the first save after the upgrade let go of 51
    // run chats of a busy automation, which were then archived.
    store.set(
      "aven.scheduledRuns.v1",
      JSON.stringify(
        Array.from({ length: 100 }, (_, index) => legacyRun(index)),
      ),
    );
    const dropped: ScheduledRun[] = [];
    const off = onScheduledRunsTrimmed((runs) => dropped.push(...runs));
    saveScheduledRun({
      id: "new",
      scheduleId: "brief",
      name: "Morning briefing",
      project: PROJECT,
      sessionId: "chat-new",
      status: "running",
      summary: "",
      startedAt: 5_000,
      inAutomations: true,
    });
    off();
    expect(dropped).toEqual([]);
    expect(listScheduledRuns()).toHaveLength(101);
    expect(chatsToArchive(dropped, new Set())).toEqual([]);
    // Only the new run's chat is the run's own.
    expect([...automationChatIds()]).toEqual(["chat-new"]);
  });
});
