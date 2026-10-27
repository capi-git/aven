// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markInboxItemSeen } from "../lib/inboxSeen";
import {
  saveScheduledRun,
  scheduledRunSeenEntry,
  updateScheduledRun,
  type ScheduledRun,
} from "../lib/scheduledAgents";
import {
  unreadAutomationRuns,
  useUnreadAutomationRuns,
} from "./useUnreadAutomationRuns";

const run = (patch: Partial<ScheduledRun> = {}): ScheduledRun => ({
  id: "run-1",
  scheduleId: "schedule-1",
  name: "Morning briefing",
  project: "/projects/site",
  status: "completed",
  summary: "All quiet.",
  startedAt: 1_000,
  finishedAt: 2_000,
  ...patch,
});

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("unread automation runs", () => {
  it("counts finished runs nobody has opened, not running ones", () => {
    const done = run();
    const failed = run({ id: "run-2", status: "failed", error: "No access" });
    const running = run({
      id: "run-3",
      status: "running",
      finishedAt: undefined,
    });
    expect(unreadAutomationRuns([done, failed, running])).toBe(2);
    markInboxItemSeen(scheduledRunSeenEntry(done));
    expect(unreadAutomationRuns([done, failed, running])).toBe(1);
    // A run that finishes again after it was read is new again.
    expect(unreadAutomationRuns([{ ...done, finishedAt: 9_000 }])).toBe(1);
  });

  it("keeps the sidebar's count current as runs finish and are read", async () => {
    let seen = -1;
    function Probe() {
      seen = useUnreadAutomationRuns();
      return null;
    }
    await act(async () => root.render(createElement(Probe)));
    expect(seen).toBe(0);
    await act(async () =>
      saveScheduledRun(run({ status: "running", finishedAt: undefined })),
    );
    expect(seen).toBe(0);
    await act(async () =>
      updateScheduledRun("run-1", { status: "completed", finishedAt: 3_000 }),
    );
    expect(seen).toBe(1);
    await act(async () =>
      markInboxItemSeen(scheduledRunSeenEntry(run({ finishedAt: 3_000 }))),
    );
    expect(seen).toBe(0);
  });
});
