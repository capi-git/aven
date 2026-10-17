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

import { orchestrator, type OrchestrationRun } from "../lib/orchestration";
import { OrchestrationActions } from "./OrchestrationActions";
import {
  OrchestrationBar,
  runningSummary,
  STALLED_AFTER_MS,
  WRAP_UP_REQUEST,
} from "./OrchestrationBar";

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

let root: Root;
let host: HTMLDivElement;
const submit = vi.fn();
const stop = vi.fn();
const open = vi.fn();
const openAgents = vi.fn();
async function show(
  sessionId: string,
  { idle = true, cwd = "/Users/me/app" } = {},
) {
  await act(async () =>
    root.render(
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
        createElement(OrchestrationBar, {
          sessionId,
          cwd,
          idle,
          onSubmit: submit,
          onStop: stop,
        }),
      ),
    ),
  );
}
const bar = () => host.querySelector<HTMLElement>("[data-orchestration-bar]");
const state = () =>
  bar()?.querySelector("[data-state]")?.getAttribute("data-state");
const press = async (label: string) => {
  const target = [...host.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
  expect(target, `a "${label}" button`).toBeTruthy();
  await act(async () => target!.click());
};
const labels = () =>
  [...host.querySelectorAll("button")].map((element) =>
    element.textContent?.trim(),
  );

beforeEach(() => {
  vi.useFakeTimers();
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the orchestration bar", () => {
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
    expect(bar()?.textContent).toContain(
      "Orchestrating · 2 working · 1 waiting",
    );
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
    expect(bar()?.textContent).toContain(
      "Paused · The lead checked in 20 times without finishing.",
    );
    expect(labels()).toEqual(["Resume", "Open agents", "Stop run"]);
    await press("Resume");
    expect(orchestrator.start).toHaveBeenCalledWith("lead", ["claude"], 2);
  });

  it("says the lead stopped without finishing once nothing can move the run", async () => {
    // The first task is done but was never accepted, so the second waits.
    store.runs = [
      run({
        tasks: [
          task("a", { status: "completed" }),
          task("b", { dependsOn: ["a"] }),
        ],
      }),
    ];
    // While the lead works, the run is simply running.
    await show("lead", { idle: false });
    expect(bar()?.textContent).toContain("Orchestrating · 1 waiting");
    await show("lead");
    // Not at once: results reach the lead a moment after a worker ends.
    expect(state()).toBe("running");
    await act(async () => vi.advanceTimersByTime(STALLED_AFTER_MS));
    expect(state()).toBe("stalled");
    expect(bar()?.textContent).toContain("The lead stopped without finishing");
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
    expect(bar()?.textContent).toContain(
      "app is busy with an orchestration in “Build settings”. Finish or stop it there.",
    );
    await press("Go to lead");
    expect(open).toHaveBeenCalledWith("lead");
    // A chat in another project, and the run's own workers, are not blocked.
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
    expect(
      runningSummary(
        run({ tasks: [task("a", { status: "cancelling" })] }),
        true,
      ),
    ).toBe("Orchestrating · 1 working");
  });
});
