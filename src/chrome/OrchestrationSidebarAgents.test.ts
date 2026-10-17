// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  runs: [] as import("../lib/orchestration").OrchestrationRun[],
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("../lib/orchestration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/orchestration")>()),
  orchestrator: {
    subscribe: () => () => {},
    snapshot: () => store.runs,
    stopRun: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
  },
}));

import { orchestrator, type OrchestrationRun } from "../lib/orchestration";
import type { OrchestrationSummary } from "../lib/orchestrationSummary";
import { OrchestrationWorkers } from "./OrchestrationActions";
import { OrchestrationSidebarAgents } from "./OrchestrationSidebarAgents";

type Task = OrchestrationSummary["tasks"][number];
const task = (id: string, status: Task["status"]): Task => ({
  sessionId: id,
  title: `Task ${id}`,
  harness: "claude",
  model: "sonnet",
  status,
});
const HOUR = 3_600_000;
const NOW = 100 * HOUR;

let root: Root;
let host: HTMLDivElement;
async function show(summary: OrchestrationSummary) {
  await act(async () =>
    root.render(
      createElement(
        OrchestrationWorkers.Provider,
        { value: { selectedId: null, inspect: () => {} } },
        createElement(OrchestrationSidebarAgents, {
          leadId: "lead",
          summary,
          endedAt: NOW - 2 * HOUR,
          now: NOW,
        }),
      ),
    ),
  );
}
const rows = () => host.querySelectorAll("[data-orchestration-agent]");
const labels = () =>
  [...host.querySelectorAll("button")].map((button) =>
    button.textContent?.trim(),
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

describe("the sidebar's run card", () => {
  it("folds a finished run to one line that opens on click", async () => {
    await show({
      status: "finished",
      live: true,
      tasks: [
        task("a", "completed"),
        task("b", "completed"),
        task("c", "completed"),
        task("d", "cancelled"),
      ],
    });
    const folded = host.querySelector<HTMLElement>(
      "[data-orchestration-folded]",
    );
    expect(folded?.textContent).toBe("Finished · 4 agents · 2h ago");
    expect(rows()).toHaveLength(0);
    await act(async () => folded!.click());
    expect(rows()).toHaveLength(4);
    // Cancelled work is not counted as missing.
    expect(
      host.querySelector("[data-orchestration-progress]")?.textContent,
    ).toBe("3 done · 1 cancelled");
    await act(async () =>
      host
        .querySelector<HTMLElement>('[aria-label="Fold this run to one line"]')!
        .click(),
    );
    expect(rows()).toHaveLength(0);
  });

  it("offers Stop run whenever the run is open, and Resume while paused", async () => {
    const run = {
      leadId: "lead",
      status: "active",
      allowedHarnesses: ["claude"],
      maxWorkers: 2,
      tasks: [],
    } as unknown as OrchestrationRun;
    const summary: OrchestrationSummary = {
      status: "active",
      live: true,
      tasks: [task("a", "completed")],
    };
    store.runs = [run];
    await show(summary);
    expect(rows()).toHaveLength(1);
    expect(labels()).toContain("Stop run");
    expect(labels()).not.toContain("Resume");
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Stop run")!
        .click(),
    );
    expect(orchestrator.stopRun).toHaveBeenCalledWith("lead");

    store.runs = [{ ...run, status: "paused" }];
    await show({ ...summary, status: "paused" });
    expect(labels()).toEqual(expect.arrayContaining(["Resume", "Stop run"]));

    store.runs = [{ ...run, status: "finished" }];
    await show({ ...summary, status: "finished" });
    expect(labels()).not.toContain("Stop run");
  });
});
