// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

import {
  automationChatTitle,
  continueAutomationRun,
  startAutomationRun,
  type AutomationRunDeps,
} from "./automationRuns";
import type { ControlOutcome } from "./orchestration";
import {
  automationChatIds,
  automationRunForChat,
  EVERY_DAY,
  getScheduledRun,
  listScheduledAgents,
  listScheduledRuns,
  markRunOpenedAsChat,
  type ScheduledAgent,
} from "./scheduledAgents";
import type { Block, Session } from "./session";

const PROJECT = "/work/site";
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

  it("sends the card's message to the run's chat, and the card is done", async () => {
    const space = workspace();
    const run = await startAutomationRun(agent, space.deps);
    space.finish(
      '```aven-review\n{"title":"Draft","action":"Publish","message":"Publish it now."}\n```',
    );
    const sent: string[] = [];
    let settle: ((outcome: ControlOutcome) => void) | undefined;
    continueAutomationRun(getScheduledRun(run.id)!, "Publish it now.", {
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
      now: () => 2_000,
    });
    expect(sent).toEqual(["Publish it now."]);
    expect(getScheduledRun(run.id)).toMatchObject({
      status: "running",
      review: { status: "done", resolvedAt: 2_000 },
    });
    settle!({ status: "completed", text: "Published." });
    expect(getScheduledRun(run.id)).toMatchObject({
      status: "completed",
      summary: "Published.",
      review: { status: "done" },
    });
    // The card was the news; its answer finishing is not.
    expect(space.notify).toHaveBeenCalledTimes(1);
  });
});

describe("data from before runs stayed in Automations", () => {
  it("reads the stored automations and runs as they were, under the same keys", () => {
    // As an earlier Aven saved them: no card, no "opened as chat".
    store.set(
      "aven.scheduledAgents.v1",
      JSON.stringify([{ ...agent, id: "brief", name: "Morning briefing" }]),
    );
    store.set(
      "aven.scheduledRuns.v1",
      JSON.stringify([
        {
          id: "old-run",
          scheduleId: "brief",
          name: "Morning briefing",
          project: PROJECT,
          sessionId: "old-chat",
          status: "completed",
          summary: "Quiet day.",
          startedAt: 10,
          finishedAt: 20,
        },
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
    expect(listScheduledRuns().map((item) => item.id)).toEqual([
      "old-run",
      "never-started",
    ]);
    // Its chat, once in the chats list, is now listed under its automation.
    expect(automationChatIds()).toEqual(new Set(["old-chat"]));
    expect(automationRunForChat("old-chat")?.id).toBe("old-run");
    // Reading changes nothing and adds no key; nothing under monocode.* or
    // supermono.* is touched.
    expect(store).toEqual(before);
    markRunOpenedAsChat("old-run");
    expect([...store.keys()].sort()).toEqual([
      "aven.scheduledAgents.v1",
      "aven.scheduledRuns.v1",
    ]);
    expect(JSON.parse(store.get("aven.scheduledRuns.v1")!)[0]).toMatchObject({
      id: "old-run",
      openedAsChat: true,
    });
  });
});
