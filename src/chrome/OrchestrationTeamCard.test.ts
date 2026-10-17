// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  runs: [] as import("../lib/orchestration").OrchestrationRun[],
  listeners: new Set<() => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("../lib/orchestration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/orchestration")>()),
  orchestrator: {
    subscribe: (listener: () => void) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    snapshot: () => store.runs,
    hydrate: async () => {},
    stopRun: vi.fn(async () => {}),
  },
}));

import type { OrchestrationRun, OrchestrationTask } from "../lib/orchestration";
import type { OrchestrationProposal } from "../lib/orchestrationPlan";
import type { Block } from "../lib/session";
import { installTeamWorkspace } from "../lib/teamWorkspace";
import { AgentTranscript } from "../surfaces/AgentTranscript";
import { OrchestrationActions } from "./OrchestrationActions";

const choices = [
  { harness: "claude" as const, model: "sonnet", name: "Sonnet" },
  { harness: "codex" as const, model: "gpt-5", name: "GPT-5" },
];
const proposal: OrchestrationProposal = {
  version: 1,
  leadId: "lead",
  cwd: "/repo",
  request: "Split settings",
  author: choices[0],
  settings: { choices, maxWorkers: 2 },
  status: "approved",
  title: "Split the settings page",
  summary: "",
  tasks: [],
};
const task = (
  id: string,
  patch: Partial<OrchestrationTask> = {},
): OrchestrationTask => ({
  id,
  assignmentId: id,
  sessionId: `w-${id}`,
  title: `Task ${id}`,
  harness: "codex",
  model: "gpt-5",
  prompt: "Do it",
  files: [],
  scopes: [],
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
  proposalId: "plan",
  maxWorkers: 2,
  cli: "aven",
  tasks: [task("a"), task("b", { status: "queued" })],
  continuations: 0,
  requests: {},
  title: "Split the settings page",
  lead: { harness: "claude", model: "Sonnet" },
  startedAt: 1,
  ...patch,
});
const block: Block = {
  id: "plan",
  role: "plan",
  text: "",
  orchestration: proposal,
};

let root: Root;
let host: HTMLDivElement;
const openAgents = vi.fn();
const review = vi.fn();
let uninstall: () => void;

async function render() {
  await act(async () =>
    root.render(
      createElement(
        OrchestrationActions.Provider,
        {
          value: {
            update: () => {},
            confirm: async () => {},
            retry: () => {},
            open: () => {},
            openAgents,
          },
        },
        createElement(AgentTranscript, { blocks: [block] }),
      ),
    ),
  );
}
const card = () => host.querySelector<HTMLElement>("[data-orchestration-run]");
const text = (selector: string) =>
  card()?.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim();
const rows = () =>
  [...(card()?.querySelectorAll("[data-orchestration-agent]") ?? [])].map(
    (row) => ({
      name: row.querySelector(".team-card-member-name")?.textContent,
      detail: row.querySelector(".team-card-member-detail")?.textContent,
      state: row.querySelector(".team-card-member-state")?.textContent,
      meta: row.querySelector(".team-card-member-meta")?.textContent ?? "",
    }),
  );
const labels = () =>
  [...(card()?.querySelectorAll(".team-card-actions button") ?? [])].map(
    (button) => button.textContent,
  );

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  uninstall = installTeamWorkspace({
    reviewChanges: review,
    openChat: vi.fn(),
    send: vi.fn(async () => true),
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
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("an orchestration's card", () => {
  it("shows the lead's agents while the run goes, with Open agents", async () => {
    store.runs = [run()];
    await render();
    expect(card()?.dataset.state).toBe("live");
    expect(text(".team-card-title")).toBe("Split the settings page");
    expect(text("[data-orchestration-status]")).toBe("Running");
    expect(text(".team-card-status")).toBe("1 working · 1 waiting");
    expect(rows()).toEqual([
      { name: "Task a", detail: "GPT-5", state: "Working", meta: "" },
      { name: "Task b", detail: "GPT-5", state: "Queued", meta: "" },
    ]);
    // The lead and both agents in the header.
    expect(
      card()!.querySelectorAll(".team-card-faces [data-discussion-avatar]"),
    ).toHaveLength(3);
    expect(labels()).toEqual(["Open agents", "Show plan"]);
  });

  it("becomes the result: the verdict, each agent's outcome and files, and the next steps", async () => {
    store.runs = [
      run({
        status: "finished",
        endedAt: 9,
        verdict: "All three pages are split and tested.",
        tasks: [
          task("a", {
            status: "completed",
            accepted: true,
            touched: ["src/a.ts", "src/b.ts", "src/c.ts"],
            summary: "Moved the form into its own component.",
          }),
          task("b", { status: "cancelled" }),
          task("c", { status: "failed", touched: ["src/d.ts"] }),
        ],
      }),
    ];
    await render();
    expect(card()?.dataset.state).toBe("done");
    expect(card()?.getAttribute("data-orchestration-ended")).toBe("finished");
    expect(text(".team-card-title")).toBe("Run finished · 3 agents");
    expect(text("[data-orchestration-status]")).toBe("Finished");
    expect(text(".team-card-status")).toBe(
      "All three pages are split and tested.",
    );
    expect(rows()).toEqual([
      {
        name: "Task a",
        detail: "GPT-5 · Moved the form into its own component.",
        state: "Accepted",
        meta: "3 files",
      },
      { name: "Task b", detail: "GPT-5", state: "Cancelled", meta: "" },
      { name: "Task c", detail: "GPT-5", state: "Failed", meta: "1 file" },
    ]);
    expect(labels()).toEqual(["Review changes", "Open agents", "Show plan"]);
    const press = async (label: string) =>
      act(async () =>
        [...card()!.querySelectorAll("button")]
          .find((button) => button.textContent === label)!
          .click(),
      );
    await press("Review changes");
    expect(review).toHaveBeenCalledWith("/repo");
    await press("Open agents");
    expect(openAgents).toHaveBeenCalledWith([
      expect.objectContaining({ sessionId: "w-a" }),
      expect.objectContaining({ sessionId: "w-b" }),
      expect.objectContaining({ sessionId: "w-c" }),
    ]);
  });

  it("reads a stopped run plainly, with nothing to review", async () => {
    store.runs = [run({ status: "stopped", endedAt: 9 })];
    await render();
    expect(card()?.dataset.state).toBe("stopped");
    expect(text(".team-card-title")).toBe("Run stopped · 2 agents");
    expect(text(".team-card-status")).toBe("Stopped before the lead finished.");
    expect(labels()).toEqual(["Open agents", "Show plan"]);
  });
});
