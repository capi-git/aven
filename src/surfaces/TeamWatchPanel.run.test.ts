// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  runs: [] as import("../lib/orchestration").OrchestrationRun[],
  listeners: new Set<() => void>(),
}));
vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => text,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  isTauri: () => false,
}));
vi.mock("../lib/orchestration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/orchestration")>()),
  orchestrator: {
    subscribe: (listener: () => void) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    snapshot: () => store.runs,
    run: (id: string) => store.runs.find((entry) => entry.leadId === id),
    start: vi.fn(async () => {}),
    finishRun: vi.fn(async () => {}),
    stopRun: vi.fn(async () => {}),
  },
}));

import { OrchestrationActions } from "../chrome/OrchestrationActions";
import { OrchestrationTeamCard } from "../chrome/OrchestrationTeamCard";
import { STALLED_AFTER_MS } from "../chrome/TeamBar";
import { useTeamWatch, type TeamWatchControls } from "../hooks/useTeamWatch";
import {
  createLiveSessionStore,
  LiveSessionsContext,
  type LiveSessionStore,
} from "../lib/liveSessions";
import {
  orchestrator,
  type OrchestrationRun,
  type OrchestrationTask,
} from "../lib/orchestration";
import { newSession, type Session } from "../lib/session";
import { installTeamWorkspace } from "../lib/teamWorkspace";
import { TeamWatchFloat } from "./TeamWatchPanel";

const task = (
  id: string,
  patch: Partial<OrchestrationTask> = {},
): OrchestrationTask => ({
  id,
  sessionId: `w-${id}`,
  title: `Task ${id}`,
  harness: "codex",
  model: "gpt-5",
  prompt: "Do it",
  files: [],
  scopes: [`/repo/${id}`],
  dependsOn: [],
  status: "running",
  accepted: false,
  result: "",
  delivered: true,
  ...patch,
});
const run = (patch: Partial<OrchestrationRun> = {}): OrchestrationRun => ({
  version: 1,
  leadId: "lead",
  cwd: "/repo",
  status: "active",
  allowedHarnesses: ["codex"],
  maxWorkers: 2,
  cli: "aven",
  tasks: [],
  continuations: 0,
  requests: {},
  title: "Split the settings page",
  lead: { harness: "claude", model: "Opus" },
  startedAt: 0,
  ...patch,
});

const chat = (id: string, patch: Partial<Session> = {}): Session => ({
  ...newSession("claude", "/repo"),
  id,
  ...patch,
});
const worker = (id: string, patch: Partial<Session> = {}): Session =>
  chat(`w-${id}`, { orchestrationLeadId: "lead", ...patch });

let root: Root;
let container: HTMLDivElement;
let live: LiveSessionStore;
let values: Map<string, string>;
let panel: TeamWatchControls;
let card: OrchestrationRun | null = null;
const onStop = vi.fn();
const openAgents = vi.fn();
const open = vi.fn();
let uninstall: () => void;

function Workspace() {
  panel = useTeamWatch("main", {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  });
  return createElement(
    OrchestrationActions.Provider,
    {
      value: {
        update: () => {},
        confirm: async () => {},
        retry: () => {},
        open,
        openAgents,
      },
    },
    createElement(TeamWatchFloat, {
      panel,
      sessions: [chat("lead")],
      onStop,
      popOuts: null,
    }),
    card
      ? createElement(OrchestrationTeamCard, {
          run: card,
          modelName: (_harness, model) => model,
          planShown: false,
          onTogglePlan: () => {},
        })
      : null,
  );
}

async function mount() {
  await act(async () =>
    root.render(
      createElement(
        LiveSessionsContext.Provider,
        { value: live },
        createElement(Workspace),
      ),
    ),
  );
}

const view = () =>
  container.querySelector<HTMLElement>('[data-team-panel="orchestrate:lead"]');
const pill = () =>
  container.querySelector<HTMLElement>('[data-team-pill="orchestrate:lead"]');
const row = (id: string) =>
  view()?.querySelector<HTMLElement>(`[data-team-member="${id}"]`);
const words = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, " ").trim();
const buttons = (selector = ".team-watch-actions button") =>
  [...(view()?.querySelectorAll(selector) ?? [])].map((button) =>
    words(button),
  );
const press = async (label: string) => {
  const button = [...(view()?.querySelectorAll("button") ?? [])].find(
    (entry) => words(entry) === label,
  );
  expect(button, `a "${label}" button`).toBeTruthy();
  await act(async () => (button as HTMLElement).click());
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  card = null;
  live = createLiveSessionStore([]);
  uninstall = installTeamWorkspace({
    reviewChanges: vi.fn(),
    openChat: open,
    send: vi.fn(async () => true),
    watch: (id) => panel.open(id),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  uninstall();
  container.remove();
  store.runs = [];
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("an orchestration in the team panel", () => {
  it("shows the lead, then each agent with what it does, waits for or asks", async () => {
    store.runs = [
      run({
        tasks: [
          task("a"),
          task("b", {
            dependsOn: ["a"],
            status: "queued",
            scopes: ["/repo/b"],
          }),
          task("c"),
          task("d", {
            status: "completed",
            accepted: true,
            touched: ["/repo/src/Form.tsx", "/repo/src/Store.ts"],
          }),
        ],
      }),
    ];
    live.set([
      chat("lead", {
        busy: true,
        blocks: [
          { id: "u", role: "user", text: "Go", startedAt: 1 },
          { id: "t", role: "assistant", text: "Checking", streaming: true },
        ],
      }),
      worker("a", {
        busy: true,
        blocks: [
          { id: "u", role: "user", text: "Go", startedAt: 1 },
          { id: "r", role: "reasoning", text: "Hmm" },
        ],
      }),
      worker("b"),
      worker("c", {
        busy: true,
        blocks: [
          { id: "u", role: "user", text: "Go", startedAt: 1 },
          {
            id: "x",
            role: "tool",
            text: "npm install",
            tool: { kind: "bash", title: "npm install" },
            approval: { requestId: 3, decided: false },
          } as never,
        ],
      }),
      worker("d"),
    ]);
    card = store.runs[0];
    await mount();
    // A run started here gets a pill; Watch on its card opens the panel.
    expect(pill()?.dataset.state).toBe("live");
    expect(words(pill())).toContain("Lead reviewing");
    await act(async () =>
      container
        .querySelector<HTMLElement>(
          "[data-orchestration-run] [data-team-watch]",
        )!
        .click(),
    );
    expect(view()?.dataset.teamKind).toBe("orchestrate");
    expect(words(view()!.querySelector(".discussion-float-title"))).toBe(
      "Run · “Split the settings page”",
    );
    expect(words(view()!.querySelector(".team-watch-status"))).toBe(
      "Orchestrating · 2 working · 1 queued",
    );
    expect(view()!.querySelectorAll(".team-watch-tile")).toHaveLength(5);
    expect(row("lead")?.dataset.role).toBe("lead");
    expect(words(row("lead"))).toContain("Lead · Claude");
    expect(words(row("lead"))).toContain("Writing a reply");
    expect(words(row("lead"))).toContain("Reviewing");
    expect(words(row("w-a"))).toContain("Task a");
    expect(words(row("w-a"))).toContain("Codex gpt-5 · Thinking");
    expect(words(row("w-b"))).toContain(
      "Codex gpt-5 · Waiting for review: Task a",
    );
    expect(words(row("w-b"))).toContain("Queued");
    expect(row("w-c")?.dataset.memberState).toBe("lead-deciding");
    expect(words(row("w-c"))).toContain(
      "Lead deciding: Codex gpt-5 wants approval: npm install",
    );
    expect(words(row("w-d"))).toContain("Accepted");
    expect(words(row("w-d"))).toContain("Form.tsx, Store.ts");
    expect(buttons()).toEqual(["Open agents", "Stop run"]);
    await press("Open agents");
    expect(openAgents).toHaveBeenCalledWith([
      expect.objectContaining({ sessionId: "w-a", leadId: "lead" }),
      expect.objectContaining({ sessionId: "w-b" }),
      expect.objectContaining({ sessionId: "w-c" }),
      expect.objectContaining({ sessionId: "w-d" }),
    ]);
    await press("Stop run");
    expect(onStop).toHaveBeenCalledWith("lead");
    // Pressing an agent's row opens its chat.
    await act(async () =>
      row("w-b")!.querySelector<HTMLElement>("button")!.click(),
    );
    expect(open).toHaveBeenCalledWith("w-b");
  });

  it("badges an agent given a role on the plan card, in its row, tile and pill", async () => {
    store.runs = [run({ tasks: [task("a", { role: "tester" }), task("b")] })];
    live.set([chat("lead"), worker("a", { busy: true }), worker("b")]);
    await mount();
    expect(
      pill()?.querySelectorAll('[data-discussion-avatar][data-role="tester"]'),
    ).toHaveLength(1);
    await act(async () => panel.open("orchestrate:lead"));
    expect(row("w-a")?.querySelector("[data-agent-role]")?.textContent).toBe(
      "Tester",
    );
    expect(words(row("w-a")?.querySelector(".team-watch-name"))).toBe("Task a");
    expect(row("w-b")?.querySelector("[data-agent-role]")).toBeNull();
    expect(
      view()!.querySelectorAll(
        '.team-watch-tile [data-discussion-avatar][data-role="tester"]',
      ),
    ).toHaveLength(1);
  });

  it("says plainly why a run paused, with Resume, and its pill turns amber", async () => {
    store.runs = [
      run({
        status: "paused",
        error:
          "The lead checked in 20 times without finishing. Aven paused the run and stopped its agents.",
        tasks: [task("a", { status: "cancelled" })],
      }),
    ];
    live.set([chat("lead"), worker("a")]);
    await mount();
    expect(pill()?.dataset.state).toBe("needs-you");
    expect(words(pill())).toContain("Paused");
    await act(async () => panel.open("orchestrate:lead"));
    const notice = view()!.querySelector<HTMLElement>("[data-team-notice]");
    expect(notice?.dataset.teamNotice).toBe("paused");
    expect(words(notice)).toContain(
      "The lead checked in 20 times without finishing.",
    );
    await press("Resume");
    expect(orchestrator.start).toHaveBeenCalledWith("lead", ["codex"], 2);
  });

  it("never resumes a run that ended while its panel still showed Resume", async () => {
    store.runs = [
      run({ status: "paused", tasks: [task("a", { status: "cancelled" })] }),
    ];
    live.set([chat("lead"), worker("a")]);
    await mount();
    await act(async () => panel.open("orchestrate:lead"));
    // Finished in another window; this panel has not heard yet.
    store.runs = [{ ...store.runs[0], status: "finished" }];
    await press("Resume");
    expect(orchestrator.start).not.toHaveBeenCalled();
    expect(words(view()!.querySelector(".team-watch-problem"))).toBe(
      "This run isn't paused any more.",
    );
  });

  it("offers Finish run once the lead stops without finishing", async () => {
    vi.useFakeTimers();
    store.runs = [
      run({
        tasks: [
          task("a", { status: "completed" }),
          task("b", { status: "queued", dependsOn: ["a"] }),
        ],
      }),
    ];
    live.set([chat("lead"), worker("a"), worker("b")]);
    await mount();
    await act(async () => panel.open("orchestrate:lead"));
    expect(view()!.querySelector("[data-team-notice]")).toBeNull();
    await act(async () => vi.advanceTimersByTime(STALLED_AFTER_MS));
    expect(
      view()!.querySelector<HTMLElement>("[data-team-notice]")?.dataset
        .teamNotice,
    ).toBe("stalled");
    expect(words(view()!.querySelector(".team-watch-status"))).toBe(
      "Needs you · The lead stopped without finishing.",
    );
    await press("Finish run");
    expect(orchestrator.finishRun).toHaveBeenCalledWith("lead");
  });

  it("reads its result once over, with Open agents and no Stop", async () => {
    store.runs = [
      run({
        status: "finished",
        endedAt: 5,
        verdict: "Both pieces are in and the tests pass.",
        tasks: [
          task("a", {
            status: "completed",
            accepted: true,
            summary: "Moved the form.",
          }),
        ],
      }),
    ];
    live.set([chat("lead"), worker("a")]);
    await mount();
    expect(pill()).toBeNull();
    await act(async () => panel.open("orchestrate:lead"));
    expect(words(view()!.querySelector(".team-watch-status"))).toBe(
      "Run finished · 1 agent",
    );
    expect(words(view()!.querySelector(".team-watch-verdict"))).toBe(
      "Both pieces are in and the tests pass.",
    );
    expect(words(row("w-a"))).toContain("Moved the form.");
    expect(buttons()).toEqual(["Open agents"]);
  });
});
