// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  runs: [] as import("../lib/orchestration").OrchestrationRun[],
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
    subscribe: () => () => {},
    snapshot: () => store.runs,
    hydrate: async () => {},
    stopRun: vi.fn(async () => {}),
  },
}));

import { orchestrator, type OrchestrationRun } from "../lib/orchestration";
import type { OrchestrationProposal } from "../lib/orchestrationPlan";
import type { Block } from "../lib/session";
import { AgentTranscript } from "../surfaces/AgentTranscript";
import { OrchestrationActions } from "./OrchestrationActions";
import { proposalStatusText } from "./OrchestrationPreview";

const choices = [
  { harness: "claude" as const, model: "sonnet", name: "Sonnet" },
];
const plan = (
  patch: Partial<OrchestrationProposal> = {},
): OrchestrationProposal => ({
  version: 1,
  leadId: "lead",
  cwd: "/repo",
  request: "Build settings",
  author: choices[0],
  settings: { choices, maxWorkers: 2 },
  status: "ready",
  title: "Build settings",
  summary: "Split UI and storage",
  tasks: [
    {
      id: "ui",
      title: "Settings UI",
      prompt: "Build the form",
      harness: "claude",
      model: "sonnet",
      files: ["src/settings", "src/styles.css"],
      dependsOn: [],
    },
    {
      id: "check",
      title: "Check everything",
      prompt: "Run the checks",
      harness: "claude",
      model: "sonnet",
      files: ["."],
      dependsOn: ["ui"],
    },
  ],
  ...patch,
});
const card = (id: string, proposal: OrchestrationProposal): Block => ({
  id,
  role: "plan",
  text: "",
  orchestration: proposal,
});

let root: Root;
let host: HTMLDivElement;
const confirm = vi.fn(async () => {});
const discard = vi.fn();
function Chat({ initial }: { initial: Block[] }) {
  const [blocks, setBlocks] = useState(initial);
  return createElement(
    OrchestrationActions.Provider,
    {
      value: {
        update: (_lead, blockId, proposal) =>
          setBlocks((current) =>
            current.map((block) =>
              block.id === blockId
                ? { ...block, orchestration: proposal }
                : block,
            ),
          ),
        confirm,
        retry: () => {},
        open: () => {},
        discard,
      },
    },
    createElement(AgentTranscript, { blocks }),
  );
}
const cards = () => [
  ...host.querySelectorAll<HTMLElement>("[data-orchestration-review]"),
];
const buttonIn = (scope: Element, label: string) =>
  [...scope.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  store.runs = [];
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("the proposal card", () => {
  it("lets only the newest plan start; an older one reads as replaced", async () => {
    await act(async () =>
      root.render(
        createElement(Chat, {
          initial: [card("old", plan()), card("new", plan())],
        }),
      ),
    );
    const [older, newer] = cards();
    expect(buttonIn(older, "Confirm & start")).toBeUndefined();
    expect(buttonIn(older, "Discard plan")).toBeUndefined();
    expect(
      older.querySelector('[aria-label="Model for Settings UI"]'),
    ).toBeNull();
    expect(older.textContent).toContain("Replaced by a newer plan");
    expect(buttonIn(newer, "Confirm & start")).toBeTruthy();
    expect(newer.textContent).toContain("Waiting for you to confirm");
  });

  it("shows each task's files as chips, naming the whole project", async () => {
    await act(async () =>
      root.render(createElement(Chat, { initial: [card("plan", plan())] })),
    );
    const chips = [...host.querySelectorAll("[data-orchestration-scope]")].map(
      (chip) => chip.textContent,
    );
    expect(chips).toEqual(["src/settings", "src/styles.css", "Whole project"]);
  });

  it("removes a task and frees the tasks that waited for it", async () => {
    await act(async () =>
      root.render(createElement(Chat, { initial: [card("plan", plan())] })),
    );
    await act(async () =>
      host
        .querySelector<HTMLElement>('[aria-label="Details for Settings UI"]')!
        .click(),
    );
    await act(async () => buttonIn(cards()[0], "Remove task")!.click());
    expect(host.textContent).not.toContain("Settings UI");
    await act(async () =>
      host
        .querySelector<HTMLElement>(
          '[aria-label="Details for Check everything"]',
        )!
        .click(),
    );
    // It no longer waits for a task that will not run, and the last task
    // cannot be removed: the plan is discarded instead.
    expect(host.textContent).not.toContain("After ·");
    const last = buttonIn(cards()[0], "Remove task")!;
    expect(last.disabled).toBe(true);
    expect(last.title).toContain("Discard the plan instead");
    await act(async () => buttonIn(cards()[0], "Discard plan")!.click());
    expect(discard).toHaveBeenCalledWith("lead", "plan");
  });

  it("becomes the run's card, in plain words, leaving Stop run to the bar", async () => {
    const run = {
      leadId: "lead",
      proposalId: "plan",
      status: "active",
      tasks: [
        {
          id: "t1",
          assignmentId: "ui",
          sessionId: "worker",
          title: "Settings UI",
          harness: "claude",
          status: "running",
        },
      ],
    } as unknown as OrchestrationRun;
    store.runs = [run];
    await act(async () =>
      root.render(
        createElement(Chat, {
          initial: [card("plan", plan({ status: "approved" }))],
        }),
      ),
    );
    expect(host.querySelector("[data-orchestration-status]")?.textContent).toBe(
      "Running",
    );
    expect(host.textContent).not.toContain("Shared project folder");
    expect(
      host
        .querySelector("[data-orchestration-task-status]")
        ?.getAttribute("data-orchestration-task-status"),
    ).toBe("Working");
    // One Stop for the run: the bar's, in the lead's message box.
    expect(buttonIn(cards()[0], "Stop run")).toBeUndefined();
    expect(orchestrator.stopRun).not.toHaveBeenCalled();
    // The plan it started from is a click away, read-only.
    expect(host.querySelector("[data-orchestration-plan]")).toBeNull();
    await act(async () => buttonIn(cards()[0], "Show plan")!.click());
    expect(host.querySelector("[data-orchestration-plan]")).not.toBeNull();
    expect(buttonIn(host, "Confirm & start")).toBeUndefined();

    for (const [status, word] of [
      ["paused", "Paused"],
      ["finished", "Finished"],
      ["stopped", "Stopped"],
    ] as const)
      expect(proposalStatusText(plan(), { ...run, status }, false)).toBe(word);
    expect(
      proposalStatusText(plan({ status: "discarded" }), undefined, false),
    ).toBe("Discarded");
  });
});
