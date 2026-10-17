// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  runs: [] as import("../lib/orchestration").OrchestrationRun[],
  listeners: new Set<() => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("../lib/orchestration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/orchestration")>()),
  orchestrator: {
    subscribe: (listener: () => void) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    snapshot: () => store.runs,
    finishRun: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
  },
}));

import {
  DiscussionStore,
  discussionStore,
  RELOAD_REASON,
  resetDiscussionStore,
  type DiscussionParty,
} from "../lib/discussions";
import {
  createLiveSessionStore,
  LiveSessionsContext,
  type LiveSessionStore,
} from "../lib/liveSessions";
import { orchestrator, type OrchestrationRun } from "../lib/orchestration";
import { recordActivity } from "../lib/activity";
import {
  installRaceWorkspace,
  saveRace,
  updateRace,
  type RaceRecord,
} from "../lib/race";
import { newSession, type Session } from "../lib/session";
import { installTeamWorkspace } from "../lib/teamWorkspace";
import { OrchestrationActions } from "./OrchestrationActions";
import {
  runningSummary,
  STALLED_AFTER_MS,
  TeamBar,
  teamBarOwnsStop,
  WRAP_UP_REQUEST,
} from "./TeamBar";

type Task = OrchestrationRun["tasks"][number];
const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  sessionId: `worker-${id}`,
  title: `Task ${id}`,
  harness: "claude",
  model: "sonnet",
  prompt: "Do it",
  files: ["src"],
  scopes: ["/repo/src"],
  dependsOn: [],
  status: "queued",
  accepted: false,
  result: "",
  delivered: true,
  ...patch,
});
const run = (patch: Partial<OrchestrationRun> = {}): OrchestrationRun => ({
  version: 1,
  leadId: "lead",
  cwd: "/Users/me/app",
  status: "active",
  allowedHarnesses: ["claude"],
  maxWorkers: 2,
  cli: "aven",
  tasks: [],
  continuations: 0,
  requests: {},
  ...patch,
});

const A: DiscussionParty = {
  sessionId: "a",
  harness: "claude",
  model: "Opus",
  title: "Caching",
  cwd: "/work/site",
};
const B: DiscussionParty = {
  sessionId: "b",
  harness: "codex",
  model: "GPT-5",
  title: "Review",
  cwd: "/work/site",
};

const race: RaceRecord = {
  id: "r1",
  project: "/work/site",
  root: "/work/site",
  base: "a".repeat(40),
  prompt: "Fix the login loop",
  createdAt: 0,
  uncommitted: false,
  untracked: false,
  state: "running",
  origin: { sessionId: "chat", blockId: "msg" },
  lanes: ["l0", "l1"].map((sessionId, slot) => ({
    sessionId,
    harness: slot ? ("codex" as const) : ("claude" as const),
    model: "m",
    label: slot ? "Codex · GPT" : "Claude Code · Opus",
    path: `/data/races/r1/${slot}`,
    branch: `aven/race/r1-${slot}`,
  })),
};

const lane = (id: string, busy: boolean): Session => ({
  ...newSession("claude", "/work/site"),
  id,
  busy,
  blocks: [
    { id: `${id}-user`, role: "user", text: "Go", startedAt: 1_000 },
    ...(busy
      ? []
      : [{ id: `${id}-reply`, role: "assistant" as const, text: "Done." }]),
  ],
});

const completed = (sessionId: string) =>
  recordActivity({
    id: `${sessionId}:turn:t:completed`,
    sessionId,
    outcome: "completed",
    title: "",
    summary: "",
    cwd: "/work/site",
    harness: "claude",
    model: "m",
    createdAt: 2_000,
  });

let root: Root;
let host: HTMLDivElement;
let live: LiveSessionStore;
const submit = vi.fn();
const stop = vi.fn();
const open = vi.fn();
const openAgents = vi.fn();
const compare = vi.fn();
const stopLanes = vi.fn();
let uninstall: () => void;

async function show(
  sessionId: string,
  {
    idle = true,
    cwd = "/Users/me/app",
    onOpenDiscussion,
  }: {
    idle?: boolean;
    cwd?: string;
    onOpenDiscussion?: (id: string) => void;
  } = {},
) {
  await act(async () =>
    root.render(
      createElement(
        LiveSessionsContext.Provider,
        { value: live },
        createElement(
          OrchestrationActions.Provider,
          {
            value: {
              update: () => {},
              confirm: async () => {},
              retry: () => {},
              open,
              openAgents,
              title: (id: string) =>
                id === "lead" ? "Build settings" : undefined,
            },
          },
          createElement(TeamBar, {
            sessionId,
            cwd,
            idle,
            onSubmit: submit,
            onStop: stop,
            onOpenDiscussion,
          }),
        ),
      ),
    ),
  );
}
const bar = () => host.querySelector<HTMLElement>("[data-team-bar]");
const text = () => bar()?.querySelector('[role="status"]')?.textContent;
const state = () =>
  bar()?.querySelector("[data-state]")?.getAttribute("data-state");
const labels = () =>
  [...host.querySelectorAll("button")].map((element) =>
    element.textContent?.trim(),
  );
const press = async (label: string) => {
  const target = [...host.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  expect(target, `a "${label}" button`).toBeTruthy();
  await act(async () => target!.click());
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  resetDiscussionStore("main");
  live = createLiveSessionStore([]);
  uninstall = installRaceWorkspace({
    stop: stopLanes,
    settle: vi.fn(),
    release: vi.fn(),
    openChat: vi.fn(),
    compare,
    retry: vi.fn(),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  store.runs = [];
  uninstall();
  resetDiscussionStore();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("while discussing", () => {
  it("names the other chat and the round, and its one Stop ends it", async () => {
    discussionStore().start({
      id: "d1",
      a: A,
      b: B,
      topic: "Topic",
      rounds: 3,
    });
    await show("a", { onOpenDiscussion: vi.fn() });
    expect(bar()?.dataset.discussionBar).toBe("d1");
    expect(text()).toBe(
      "Discussing · round 1 of 3 · with Codex · GPT-5 in “Review”",
    );
    expect(labels()).toEqual(["Open discussion", "Stop"]);
    await press("Stop");
    expect(discussionStore().get("d1")?.status).toBe("ended");
    expect(bar()).toBeNull();
  });

  it("badges the other chat with the role it was brought in with", async () => {
    discussionStore().start({
      id: "d1",
      a: A,
      b: { ...B, role: "skeptic" },
      topic: "Topic",
      rounds: 3,
    });
    await show("a");
    const badge = bar()?.querySelector("[data-agent-role]");
    expect(badge?.textContent).toBe("Skeptic");
    expect(badge?.getAttribute("title")).toBe(
      "Skeptic: Push back on weak points and look for what could go wrong; agree only when convinced.",
    );
    // The text stays as it was.
    expect(text()).toBe(
      "Discussing · round 1 of 3 · with Codex · GPT-5 in “Review”",
    );
  });

  it("shows the pause reason with Resume in either chat", async () => {
    const discussions = discussionStore();
    discussions.start({ id: "d1", a: A, b: B, topic: "Topic", rounds: 2 });
    discussions.pause("d1", RELOAD_REASON);
    await show("b");
    expect(state()).toBe("paused");
    expect(text()).toBe(
      "Discussing · Paused · Its window reloaded or closed. Resume to continue.",
    );
    await press("Resume");
    expect(discussions.get("d1")?.status).toBe("active");
    expect(text()).toContain("with Claude · Opus in “Caching”");
  });

  it("goes to the chat it waits for instead of resuming", async () => {
    const discussions = discussionStore();
    discussions.start({ id: "d1", a: A, b: B, topic: "Topic", rounds: 2 });
    discussions.pause("d1", "“Review” is busy with your own turn.", "b");
    await show("a");
    // The reason is never cut off: it may take a second line.
    expect(bar()?.querySelector("[data-team-bar-reason]")?.textContent).toBe(
      "“Review” is busy with your own turn.",
    );
    expect(bar()?.querySelector("[data-state]")?.className).toContain(
      "min-h-7",
    );
    expect(bar()?.querySelector("[data-team-bar-text]")?.className).toContain(
      "line-clamp-2",
    );
    expect(text()).toBe(
      "Discussing · Paused · “Review” is busy with your own turn.",
    );
    expect(labels()).toEqual(["Go to Codex", "Stop"]);
    await press("Go to Codex");
    expect(open).toHaveBeenCalledWith("b");
    await show("b");
    expect(labels()).toEqual(["Resume", "Stop"]);
  });

  it("lets a chat moved here stop or resume another window's discussion", async () => {
    const theirs = new DiscussionStore(localStorage, "other");
    theirs.start({ id: "theirs", a: A, b: B, topic: "Topic", rounds: 2 });
    theirs.pause("theirs", "“Review” isn't open in this window.");
    resetDiscussionStore("main");
    await show("b");
    expect(text()).toContain("isn't open in this window");
    await press("Resume");
    expect(discussionStore().get("theirs")).toMatchObject({
      owner: "main",
      status: "active",
    });
  });
});

describe("while racing", () => {
  beforeEach(() => {
    saveRace(race);
    live.set([lane("l0", false), lane("l1", true)]);
    completed("l0");
  });

  it("shows a lane how far the race is, with Compare and no second Stop", async () => {
    await show("l1");
    expect(bar()?.dataset.raceBar).toBe("r1");
    expect(text()).toBe("Racing · 1 of 2 done");
    // The lane's own Stop stops that lane; the bar does not add another.
    expect(labels()).toEqual(["Compare"]);
    await press("Compare");
    expect(compare).toHaveBeenCalledWith("r1");
  });

  it("gives the chat it started from Stop all, until every lane is done", async () => {
    await show("chat");
    expect(labels()).toEqual(["Compare", "Stop all"]);
    await press("Stop all");
    expect(stopLanes).toHaveBeenCalledWith(["l1"]);
    await act(async () => {
      completed("l1");
      live.set([lane("l0", false), lane("l1", false)]);
    });
    expect(state()).toBe("ready");
    expect(text()).toBe("Racing · Ready to compare · 2 of 2 done");
    expect(labels()).toEqual(["Compare"]);
  });

  it("names a lane by its model when two models of one provider race", async () => {
    saveRace({
      ...race,
      lanes: [
        race.lanes[0],
        {
          ...race.lanes[1],
          harness: "claude",
          label: "Claude Code · Sonnet 5",
        },
      ],
    });
    live.set([
      lane("l0", false),
      {
        ...lane("l1", true),
        pendingQuestion: { requestId: 1, title: "Which file?", questions: [] },
      },
    ]);
    await show("chat");
    expect(labels()).toContain("Go to Claude Code · Sonnet 5");
  });

  it("offers Watch where the window has a team panel", async () => {
    const watch = vi.fn();
    const stopWatching = installTeamWorkspace({
      reviewChanges: vi.fn(),
      openChat: vi.fn(),
      send: vi.fn(async () => true),
      watch,
    });
    await show("chat");
    expect(labels()).toEqual(["Watch", "Compare", "Stop all"]);
    // One line while nothing waits on you.
    expect(bar()?.querySelector("[data-state]")?.className).toContain("h-7");
    expect(bar()?.querySelector("[data-team-bar-reason]")).toBeNull();
    await press("Watch");
    expect(watch).toHaveBeenCalledWith("race:r1");
    stopWatching();
  });

  it("goes away once the race is kept, and never shows in other chats", async () => {
    await show("other");
    expect(bar()).toBeNull();
    await show("l0");
    expect(bar()).not.toBeNull();
    await act(async () => updateRace("r1", { state: "kept" }));
    expect(bar()).toBeNull();
  });
});

describe("while orchestrating", () => {
  beforeEach(() => vi.useFakeTimers());

  it("shows what the run is doing, with Stop run and Open agents", async () => {
    store.runs = [
      run({
        tasks: [
          task("a", { status: "running" }),
          task("b", { status: "running" }),
          task("c"),
        ],
      }),
    ];
    await show("lead");
    expect(bar()?.dataset.orchestrationBar).toBe("lead");
    expect(text()).toBe("Orchestrating · 2 working · 1 waiting");
    expect(labels()).toEqual(["Open agents", "Stop run"]);
    await press("Stop run");
    expect(stop).toHaveBeenCalledWith("lead");
    await press("Open agents");
    expect(openAgents).toHaveBeenCalledWith([
      expect.objectContaining({ sessionId: "worker-a", leadId: "lead" }),
      expect.objectContaining({ sessionId: "worker-b" }),
      expect.objectContaining({ sessionId: "worker-c" }),
    ]);
  });

  it("says why a run paused and offers Resume", async () => {
    store.runs = [
      run({
        status: "paused",
        error: "The lead checked in 20 times without finishing.",
        tasks: [task("a", { status: "cancelled" })],
      }),
    ];
    await show("lead");
    expect(text()).toBe(
      "Orchestrating · Paused · The lead checked in 20 times without finishing.",
    );
    expect(labels()).toEqual(["Resume", "Open agents", "Stop run"]);
    await press("Resume");
    expect(orchestrator.start).toHaveBeenCalledWith("lead", ["claude"], 2);
  });

  it("drops a failed Resume's error once the run moves on elsewhere", async () => {
    store.runs = [run({ status: "paused", error: "Out of credits." })];
    vi.mocked(orchestrator.start).mockRejectedValueOnce(
      new Error("Claude Code isn't signed in."),
    );
    await show("lead");
    await press("Resume");
    expect(text()).toBe("Claude Code isn't signed in.");
    // Resumed from the team panel instead.
    store.runs = [run({ tasks: [task("a", { status: "running" })] })];
    await act(async () => {
      for (const listener of store.listeners) listener();
    });
    expect(text()).toBe("Orchestrating · 1 working");
  });

  it("says the lead stopped without finishing once nothing can move the run", async () => {
    store.runs = [
      run({
        tasks: [
          task("a", { status: "completed" }),
          task("b", { dependsOn: ["a"] }),
        ],
      }),
    ];
    await show("lead", { idle: false });
    expect(text()).toBe("Orchestrating · 1 waiting");
    await show("lead");
    expect(state()).toBe("running");
    await act(async () => vi.advanceTimersByTime(STALLED_AFTER_MS));
    expect(state()).toBe("stalled");
    expect(text()).toBe("Orchestrating · The lead stopped without finishing");
    expect(labels()).toEqual([
      "Finish run",
      "Ask the lead to wrap up",
      "Stop run",
    ]);
    await press("Ask the lead to wrap up");
    expect(submit).toHaveBeenCalledWith("lead", WRAP_UP_REQUEST);
    await press("Finish run");
    expect(orchestrator.finishRun).toHaveBeenCalledWith("lead");
  });

  it("tells another chat in the project which chat holds it", async () => {
    store.runs = [run({ tasks: [task("a", { status: "running" })] })];
    await show("other");
    expect(text()).toBe(
      "app is busy with an orchestration in “Build settings”. Finish or stop it there.",
    );
    await press("Go to lead");
    expect(open).toHaveBeenCalledWith("lead");
    await show("elsewhere", { cwd: "/Users/me/site" });
    expect(bar()).toBeNull();
    await show("worker-a");
    expect(bar()).toBeNull();
  });

  it("goes away once the run is over", async () => {
    for (const status of ["finished", "stopped"] as const) {
      store.runs = [run({ status })];
      await show("lead");
      expect(bar()).toBeNull();
      await show("other");
      expect(bar()).toBeNull();
    }
  });

  it("words what the agents are doing", () => {
    expect(runningSummary(run(), false)).toBe(
      "Orchestrating · the lead is reviewing",
    );
    expect(runningSummary(run(), true)).toBe(
      "Orchestrating · waiting on the lead",
    );
    expect(
      runningSummary(
        run({ tasks: [task("a", { status: "cancelling" })] }),
        true,
      ),
    ).toBe("Orchestrating · 1 working");
  });
});

describe("one Stop for one thing", () => {
  it("takes over a chat's own Stop only where both would stop the same", async () => {
    vi.useFakeTimers();
    discussionStore().start({
      id: "d1",
      a: A,
      b: B,
      topic: "Topic",
      rounds: 2,
    });
    saveRace(race);
    live.set([lane("l0", true), lane("l1", true)]);
    store.runs = [run({ tasks: [task("a", { status: "running" })] })];
    const stops = async (id: string) => {
      await show(id);
      return labels().filter((label) => label?.startsWith("Stop"));
    };
    expect(await stops("a")).toEqual(["Stop"]);
    expect(await stops("lead")).toEqual(["Stop run"]);
    expect(await stops("chat")).toEqual(["Stop all"]);
    expect(await stops("l0")).toEqual([]);
    const { teamRunsFrom } = await import("../lib/teamRuns");
    const teams = teamRunsFrom(
      {
        discussions: discussionStore().snapshot(),
        races: [race],
        runs: store.runs,
      },
      { session: (id) => live.session(id), activity: [] },
    );
    const of = (kind: string) => teams.find((team) => team.kind === kind)!;
    // The run status's Stop gives way to the bar's for a discussion or a lead.
    expect(teamBarOwnsStop(of("discuss"), "b")).toBe(true);
    expect(teamBarOwnsStop(of("orchestrate"), "lead")).toBe(true);
    // A race lane keeps its own Stop; the race's chat has nothing of its own.
    expect(teamBarOwnsStop(of("race"), "l0")).toBe(false);
    expect(teamBarOwnsStop(of("race"), "chat")).toBe(false);
  });
});
