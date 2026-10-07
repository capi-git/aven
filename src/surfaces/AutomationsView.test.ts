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

import { AUTOMATION_EXAMPLES } from "../lib/automationExamples";
import { loadInboxSource } from "../lib/inboxFilters";
import { isInboxEntryUnread } from "../lib/inboxSeen";
import {
  EVERY_DAY,
  listScheduledAgents,
  requestScheduleEditor,
  saveScheduledAgent,
  saveScheduledRun,
  scheduledRunSeenEntry,
  takeScheduleEditorRequest,
  type ScheduledAgent,
  type ScheduledRun,
} from "../lib/scheduledAgents";
import { AutomationsView } from "./AutomationsView";
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
const onClose = vi.fn();

async function render() {
  await act(async () =>
    root.render(
      createElement(AutomationsView, {
        cwd: PROJECT,
        recents: [{ path: PROJECT, openedAt: 1 }],
        onClose,
        onRunAutomation: onRun,
        onOpenChat,
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

function field(label: string) {
  return container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  )!;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

async function type(label: string, value: string) {
  const input = field(label);
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressedDays() {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Days"] button[aria-pressed="true"]',
    ),
  ].map((day) => day.getAttribute("aria-label"));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mockLocalStorage();
  host.invoke.mockReset();
  host.invoke.mockResolvedValue([]);
  host.ask.mockReset();
  onRun.mockReset();
  onOpenChat.mockReset();
  onClose.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Automations view", () => {
  it("is its own region, apart from the Inbox", async () => {
    await render();
    const region = container.querySelector("[data-app-automations]");
    expect(region?.getAttribute("aria-label")).toBe("Automations");
    expect(container.querySelector("[data-app-inbox]")).toBeNull();
    // No Inbox source tabs or filters here.
    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(container.querySelector('[aria-label="Filter inbox"]')).toBeNull();
  });

  it("creates an automation from a blank form", async () => {
    await render();
    await click(button("New automation"));
    expect(button("Create automation").disabled).toBe(true);
    // Supervised access is the default and may stall an unattended run.
    expect(container.querySelector('[role="note"]')?.textContent).toMatch(
      /pause whenever the agent asks for approval/,
    );

    await type("Name", "Morning review");
    await type("Prompt", "Review yesterday's commits");
    await click(button("Saturday"));
    await click(button("Every few hours"));
    await click(button("On days"));
    await click(button("Create automation"));

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
      container.querySelector('ul[aria-label="Automations"] li')?.textContent,
    ).toContain("Morning review");
  });

  it("turns an automation off and back on, and runs it now", async () => {
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

  it("edits an automation without moving its next run", async () => {
    saveScheduledAgent(schedule);
    await render();
    await click(button("Edit Morning review"));
    // Examples only prefill new automations.
    expect(
      container.querySelector('[aria-label="Start from an example"]'),
    ).toBeNull();
    await type("Name", "Evening review");
    await click(button("Save"));
    expect(listScheduledAgents()[0]).toMatchObject({
      name: "Evening review",
      nextRunAt: schedule.nextRunAt,
    });
  });

  it("deletes an automation only after confirmation", async () => {
    saveScheduledAgent(schedule);
    await render();
    host.ask.mockResolvedValueOnce(false);
    await click(button("Delete Morning review"));
    expect(host.ask).toHaveBeenCalledTimes(1);
    expect(listScheduledAgents()).toHaveLength(1);
    host.ask.mockResolvedValueOnce(true);
    await click(button("Delete Morning review"));
    expect(listScheduledAgents()).toHaveLength(0);
    // Back to the empty state, with the examples.
    expect(container.textContent).toContain("Start from an example");
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

  it("opens a blank automation from the command palette request", async () => {
    await render();
    expect(container.querySelector("[data-scheduled-editor]")).toBeNull();
    await act(async () => requestScheduleEditor());
    expect(
      container
        .querySelector("[data-scheduled-editor]")
        ?.getAttribute("aria-label"),
    ).toBe("New automation");
  });

  it("takes a palette request made before the view opened", async () => {
    requestScheduleEditor();
    await render();
    expect(container.querySelector("[data-scheduled-editor]")).not.toBeNull();
  });

  it("closes on Escape unless the editor has focus", async () => {
    await render();
    await click(button("New automation"));
    field("Name").focus();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).not.toHaveBeenCalled();
    field("Name").blur();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Automation examples", () => {
  it("fills the empty state with every example", async () => {
    await render();
    const cards = [
      ...container.querySelectorAll<HTMLButtonElement>("[data-example]"),
    ];
    expect(cards.map((card) => card.dataset.example)).toEqual(
      AUTOMATION_EXAMPLES.map((example) => example.id),
    );
    expect(cards[0]!.textContent).toContain("Morning briefing");
    expect(cards[0]!.textContent).toContain("Weekdays at 08:30");
  });

  it("opens the editor prefilled from the chosen example", async () => {
    await render();
    const example = AUTOMATION_EXAMPLES.find(
      (item) => item.id === "weekly-changelog",
    )!;
    await click(
      container.querySelector<HTMLButtonElement>(
        '[data-example="weekly-changelog"]',
      )!,
    );
    expect(container.querySelector("[data-example]")).toBeNull();
    expect(field("Name").value).toBe("Weekly changelog");
    expect(field("Prompt").value).toBe(example.prompt);
    expect(pressedDays()).toEqual(["Friday"]);
    expect((field("Time") as HTMLInputElement).value).toBe("16:00");
    expect(
      container.querySelector(
        '[aria-label="Start from an example"] [aria-pressed="true"]',
      )?.textContent,
    ).toBe("Weekly changelog");

    // Project and agent keep the editor's defaults; saving works as is.
    await click(button("Create automation"));
    expect(listScheduledAgents()[0]).toMatchObject({
      name: "Weekly changelog",
      prompt: example.prompt,
      project: PROJECT,
      schedule: { kind: "weekly", days: [5], time: "16:00" },
    });
  });

  it("prefills an interval example", async () => {
    await render();
    await click(
      container.querySelector<HTMLButtonElement>(
        '[data-example="stale-todos-docs"]',
      )!,
    );
    expect(field("Name").value).toBe("Stale TODOs and docs");
    expect(button("Every few hours").getAttribute("aria-checked")).toBe("true");
    expect(field("Interval")?.textContent).toContain("24 hours");
    await click(button("Create automation"));
    expect(listScheduledAgents()[0]!.schedule).toEqual({
      kind: "interval",
      hours: 24,
    });
  });

  it("can start a blank form from an example", async () => {
    saveScheduledAgent(schedule);
    await render();
    // With automations saved, the gallery gives way to the list.
    expect(container.querySelector("[data-example]")).toBeNull();
    await click(button("New automation"));
    expect(field("Name").value).toBe("");
    await click(button("Morning briefing"));
    expect(field("Name").value).toBe("Morning briefing");
    expect(field("Prompt").value).toContain("morning briefing");
    expect(pressedDays()).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
    ]);
    expect((field("Time") as HTMLInputElement).value).toBe("08:30");
  });
});

describe("Inbox without the Scheduled tab", () => {
  async function renderInbox() {
    await act(async () =>
      root.render(
        createElement(InboxView, {
          onAsk: async () => "",
          onAskRestart: async () => "",
          onAskMount: () => {},
          cwd: PROJECT,
          recents: [{ path: PROJECT, openedAt: 1 }],
        }),
      ),
    );
  }

  it("lists GitHub and Linear only", async () => {
    localStorage.setItem("monocode.inboxSource", "github");
    await renderInbox();
    const tabs = [...container.querySelectorAll('[role="tab"]')].map(
      (tab) => tab.textContent,
    );
    expect(tabs).toEqual(["GitHub", "Linear"]);
    expect(
      container.querySelector('input[aria-label="Filter inbox"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-scheduled-editor]")).toBeNull();
  });

  it("falls back to GitHub when the saved source was Scheduled", async () => {
    localStorage.setItem("monocode.inboxSource", "scheduled");
    expect(loadInboxSource()).toBe("github");
    await renderInbox();
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("GitHub");
    expect(
      container.querySelector('input[aria-label="Filter inbox"]'),
    ).not.toBeNull();
  });

  it("keeps Linear when that was saved", async () => {
    localStorage.setItem("monocode.inboxSource", "linear");
    expect(loadInboxSource()).toBe("linear");
  });

  it("ignores a palette request for a new automation", async () => {
    await renderInbox();
    await act(async () => requestScheduleEditor());
    expect(container.querySelector("[data-scheduled-editor]")).toBeNull();
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toBe("GitHub");
    // Still waiting for the Automations view to take it.
    expect(takeScheduleEditorRequest()).toBe(true);
  });
});
