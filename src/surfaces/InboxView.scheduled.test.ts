// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ invoke: vi.fn(), ask: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: host.invoke,
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: host.ask }));
vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  IS_MAC: true,
}));

import { isInboxEntryUnread } from "../lib/inboxSeen";
import {
  EVERY_DAY,
  listScheduledAgents,
  requestScheduleEditor,
  saveScheduledAgent,
  saveScheduledRun,
  scheduledRunSeenEntry,
  type ScheduledAgent,
  type ScheduledRun,
} from "../lib/scheduledAgents";
import { InboxView } from "./InboxView";

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    },
  });
}

const PROJECT = "/work/site";

const schedule: ScheduledAgent = {
  id: "daily",
  name: "Morning review",
  prompt: "Review yesterday's commits",
  project: PROJECT,
  harness: "claude",
  model: "claude:sonnet-5",
  runtimeMode: "auto",
  schedule: { kind: "weekly", days: EVERY_DAY, time: "09:00" },
  enabled: true,
  createdAt: 0,
  nextRunAt: Date.now() + 60 * 60 * 1000,
};

const finished: ScheduledRun = {
  id: "run-1",
  scheduleId: "daily",
  name: "Morning review",
  project: PROJECT,
  sessionId: "session-1",
  status: "completed",
  summary: "Three commits landed; nothing risky.",
  startedAt: Date.now() - 120_000,
  finishedAt: Date.now() - 60_000,
};

let root: Root;
let container: HTMLDivElement;
const onRun = vi.fn();
const onOpenChat = vi.fn();

async function render() {
  await act(async () =>
    root.render(
      createElement(InboxView, {
        onAsk: async () => "",
        onAskRestart: async () => "",
        onAskMount: () => {},
        cwd: PROJECT,
        recents: [{ path: PROJECT, openedAt: 1 }],
        onRunScheduledAgent: onRun,
        onOpenScheduledChat: onOpenChat,
      }),
    ),
  );
}

function button(name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find(
    (item) =>
      item.getAttribute("aria-label") === name ||
      item.textContent?.trim() === name,
  );
  if (!match) throw new Error(`No button ${name}`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

async function type(label: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  )!;
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(field),
    "value",
  )!.set!;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mockLocalStorage();
  localStorage.setItem("monocode.inboxSource", "scheduled");
  host.invoke.mockReset();
  host.invoke.mockResolvedValue([]);
  host.ask.mockReset();
  onRun.mockReset();
  onOpenChat.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Inbox scheduled tab", () => {
  it("creates a schedule from the form", async () => {
    await render();
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("Scheduled");
    await click(button("New schedule"));
    expect(button("Create schedule").disabled).toBe(true);
    // Supervised access is the default and may stall an unattended run.
    expect(container.querySelector('[role="note"]')?.textContent).toMatch(
      /pause whenever the agent asks for approval/,
    );

    await type("Name", "Morning review");
    await type("Prompt", "Review yesterday's commits");
    await click(button("Saturday"));
    await click(button("Every few hours"));
    await click(button("On days"));
    await click(button("Create schedule"));

    const [saved] = listScheduledAgents();
    expect(saved).toMatchObject({
      name: "Morning review",
      prompt: "Review yesterday's commits",
      project: PROJECT,
      enabled: true,
      schedule: { kind: "weekly", days: [1, 2, 3, 4, 5, 6], time: "09:00" },
    });
    expect(saved!.nextRunAt).toBeGreaterThan(Date.now());
    expect(container.querySelector("[data-scheduled-editor]")).toBeNull();
    expect(
      container.querySelector('[aria-label="Schedules"] li')?.textContent,
    ).toContain("Morning review");
  });

  it("turns a schedule off and back on, and runs it now", async () => {
    saveScheduledAgent(schedule);
    await render();
    const toggle = button("Run Morning review on schedule");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await click(toggle);
    expect(listScheduledAgents()[0]!.enabled).toBe(false);
    expect(container.textContent).toContain("Off");
    await click(button("Run Morning review on schedule"));
    expect(listScheduledAgents()[0]!.enabled).toBe(true);

    await click(button("Run Morning review now"));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0]![0]).toMatchObject({ id: "daily" });
    expect(listScheduledAgents()[0]!.lastRunAt).toBeTypeOf("number");
  });

  it("edits a schedule without moving its next run", async () => {
    saveScheduledAgent(schedule);
    await render();
    await click(button("Edit Morning review"));
    await type("Name", "Evening review");
    await click(button("Save"));
    expect(listScheduledAgents()[0]).toMatchObject({
      name: "Evening review",
      nextRunAt: schedule.nextRunAt,
    });
  });

  it("deletes a schedule only after confirmation", async () => {
    saveScheduledAgent(schedule);
    await render();
    host.ask.mockResolvedValueOnce(false);
    await click(button("Delete Morning review"));
    expect(host.ask).toHaveBeenCalledTimes(1);
    expect(listScheduledAgents()).toHaveLength(1);
    host.ask.mockResolvedValueOnce(true);
    await click(button("Delete Morning review"));
    expect(listScheduledAgents()).toHaveLength(0);
    expect(container.textContent).toContain("No schedules yet");
  });

  it("shows a new run as unread until it is opened", async () => {
    await render();
    await act(async () => saveScheduledRun(finished));
    const card = () =>
      container.querySelector<HTMLButtonElement>(
        "[data-unread], [title='Morning review']",
      )!;
    expect(card().getAttribute("aria-label")).toBe(
      "Morning review: completed, new",
    );
    expect(isInboxEntryUnread(scheduledRunSeenEntry(finished))).toBe(true);
    // The newest run is shown without marking it read.
    expect(container.textContent).toContain("Three commits landed");

    await click(card());
    expect(card().getAttribute("aria-label")).toBe("Morning review: completed");
    expect(isInboxEntryUnread(scheduledRunSeenEntry(finished))).toBe(false);

    await click(button("Open chat"));
    expect(onOpenChat).toHaveBeenCalledWith("session-1");
  });

  it("opens a blank schedule from the command palette", async () => {
    localStorage.setItem("monocode.inboxSource", "github");
    await render();
    expect(container.querySelector("[data-scheduled-editor]")).toBeNull();
    await act(async () => requestScheduleEditor());
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("Scheduled");
    expect(container.querySelector("[data-scheduled-editor]")).not.toBeNull();
  });

  it("keeps GitHub and Linear as they were", async () => {
    localStorage.setItem("monocode.inboxSource", "github");
    await render();
    const tabs = [...container.querySelectorAll('[role="tab"]')].map(
      (tab) => tab.textContent,
    );
    expect(tabs).toEqual(["GitHub", "Linear", "Scheduled"]);
    expect(
      container.querySelector('[aria-label="Filter inbox"]'),
    ).not.toBeNull();
    await click(button("Scheduled"));
    expect(
      container.querySelector('input[aria-label="Filter inbox"]'),
    ).toBeNull();
    expect(localStorage.getItem("monocode.inboxSource")).toBe("scheduled");
  });
});
