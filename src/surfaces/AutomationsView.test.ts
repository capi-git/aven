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
// The run's conversation, as the transcript would draw it.
vi.mock("./AgentTranscript", () => ({
  AgentTranscript: ({ blocks }: { blocks: { text: string }[] }) =>
    createElement(
      "div",
      { "data-transcript": "" },
      blocks.map((block) => block.text).join(" | "),
    ),
}));

import { AUTOMATION_EXAMPLES } from "../lib/automationExamples";
import { isInboxEntryUnread } from "../lib/inboxSeen";
import {
  automationChatIds,
  EVERY_DAY,
  getScheduledRun,
  listScheduledAgents,
  requestAutomationRun,
  requestScheduleEditor,
  saveScheduledAgent,
  saveScheduledRun,
  scheduledRunSeenEntry,
  takeAutomationsRequest,
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
const NOTES = "/work/notes";

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
  inAutomations: true,
};

/** The run's saved chat, as `session_get` returns it. */
const savedChat = {
  id: "session-1",
  cwd: PROJECT,
  harness: "claude",
  model: "claude:sonnet-5",
  modelSettings: {},
  runtimeMode: "auto",
  title: "Scheduled · Morning review",
  blocks: [
    { id: "u1", role: "user", text: "Review yesterday's commits" },
    { id: "a1", role: "assistant", text: "Three commits landed." },
  ],
  createdAt: 1,
  updatedAt: 2,
};

let root: Root;
let container: HTMLDivElement;
const onRun = vi.fn();
const onOpenRunAsChat = vi.fn();
const onClose = vi.fn();

async function render() {
  await act(async () =>
    root.render(
      createElement(AutomationsView, {
        cwd: PROJECT,
        recents: [
          { path: PROJECT, openedAt: 2 },
          { path: NOTES, openedAt: 1 },
        ],
        onClose,
        onRunAutomation: onRun,
        onOpenRunAsChat,
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

/** Each folder's name and its automations' names, top to bottom. */
function folders() {
  return [
    ...container.querySelectorAll<HTMLElement>("[data-automation-folder]"),
  ].map((folder) => ({
    name: folder.querySelector(".aven-menu-label")?.textContent,
    count: folder.querySelector(".automation-folder-count")?.textContent,
    items: [
      ...folder.querySelectorAll<HTMLElement>(
        "[data-automation-row] .automation-row-name",
      ),
    ].map((row) => row.textContent),
  }));
}

function row(id: string) {
  return container.querySelector<HTMLButtonElement>(
    `[data-automation-row="${id}"]`,
  )!;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mockLocalStorage();
  host.invoke.mockReset();
  host.invoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "session_get")
      return (args as { sessionId: string }).sessionId === savedChat.id
        ? savedChat
        : null;
    return [];
  });
  host.ask.mockReset();
  onRun.mockReset();
  onOpenRunAsChat.mockReset();
  onClose.mockReset();
  takeAutomationsRequest();
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

  it("lists one folder per project, then No project, with counts", async () => {
    saveScheduledAgent(schedule);
    saveScheduledAgent({ ...schedule, id: "tests", name: "Nightly tests" });
    saveScheduledAgent({
      ...schedule,
      id: "deps",
      name: "Dependency check",
      project: NOTES,
      enabled: false,
    });
    saveScheduledAgent({
      ...schedule,
      id: "inbox",
      name: "Triage",
      project: "",
    });
    await render();
    expect(folders()).toEqual([
      { name: "notes", count: "1", items: ["Dependency check"] },
      { name: "site", count: "2", items: ["Morning review", "Nightly tests"] },
      { name: "No project", count: "1", items: ["Triage"] },
    ]);
    // When it runs, in plain words; an automation that is off says so.
    expect(row("daily").textContent).toContain("Every day at 09:00 · Next");
    expect(row("deps").textContent).toContain("Every day at 09:00 · Off");
    expect(row("daily").getAttribute("aria-label")).toMatch(
      /^Morning review: Not run yet\. Every day at 09:00 · Next /,
    );

    // A folder folds away, and stays folded.
    const site = container.querySelector<HTMLButtonElement>(
      '[data-automation-folder="/work/site"] [aria-expanded]',
    )!;
    await click(site);
    expect(site.getAttribute("aria-expanded")).toBe("false");
    expect(row("daily")).toBeNull();
    expect(localStorage.getItem("aven.automations.collapsedFolders.v1")).toBe(
      JSON.stringify(["/work/site"]),
    );
  });

  it("shows each automation's last run, and its runs when chosen", async () => {
    saveScheduledAgent(schedule);
    saveScheduledRun(finished);
    saveScheduledRun({
      ...finished,
      id: "run-0",
      sessionId: "session-0",
      status: "failed",
      error: "2 tests failed.",
      startedAt: finished.startedAt - 86_400_000,
      finishedAt: finished.finishedAt! - 86_400_000,
    });
    await render();
    expect(row("daily").getAttribute("aria-label")).toMatch(
      /^Morning review: Last run completed 1m ago\. Every day at 09:00/,
    );
    expect(
      row("daily").querySelector(".automation-dot")?.getAttribute("data-tone"),
    ).toBe("completed");
    await click(row("daily"));
    const runs = [
      ...container.querySelectorAll<HTMLElement>("[data-automation-run]"),
    ];
    expect(runs.map((item) => item.dataset.automationRun)).toEqual([
      "run-1",
      "run-0",
    ]);
    expect(runs[0]!.textContent).toContain("Three commits landed");
    expect(runs[1]!.textContent).toContain("2 tests failed.");
    // A screen reader hears the row's summary as well as how it went.
    expect(runs[0]!.getAttribute("aria-label")).toMatch(
      /: completed, new\. Three commits landed; nothing risky\.\. 1 min$/,
    );
    expect(runs[1]!.getAttribute("aria-label")).toContain(
      "failed, new. 2 tests failed.",
    );
  });

  it("opens a run's conversation inside Automations, and back", async () => {
    saveScheduledAgent(schedule);
    saveScheduledRun(finished);
    await render();
    await click(row("daily"));
    expect(isInboxEntryUnread(scheduledRunSeenEntry(finished))).toBe(true);
    await click(
      container.querySelector<HTMLButtonElement>(
        '[data-automation-run="run-1"]',
      )!,
    );
    await flush();
    const view = container.querySelector("[data-automation-run-view]")!;
    expect(view.querySelector("[data-transcript]")?.textContent).toBe(
      "Review yesterday's commits | Three commits landed.",
    );
    expect(host.invoke).toHaveBeenCalledWith("session_get", {
      sessionId: "session-1",
    });
    // Opening it reads it.
    expect(isInboxEntryUnread(scheduledRunSeenEntry(finished))).toBe(false);
    // Still Automations: nothing asked to open a chat.
    expect(onOpenRunAsChat).not.toHaveBeenCalled();
    await click(button("Back to Morning review"));
    expect(container.querySelector("[data-automation-run-view]")).toBeNull();
    expect(container.querySelector("[data-automation-runs]")).not.toBeNull();
  });

  it("opens a run as a chat only when asked", async () => {
    saveScheduledAgent(schedule);
    saveScheduledRun(finished);
    await render();
    await click(row("daily"));
    await click(
      container.querySelector<HTMLButtonElement>(
        '[data-automation-run="run-1"]',
      )!,
    );
    await click(button("Open as chat"));
    expect(onOpenRunAsChat).toHaveBeenCalledTimes(1);
    expect(onOpenRunAsChat.mock.calls[0]![0]).toMatchObject({ id: "run-1" });
  });

  it("shows the run asked for elsewhere, opening its folder", async () => {
    saveScheduledAgent(schedule);
    saveScheduledRun(finished);
    localStorage.setItem(
      "aven.automations.collapsedFolders.v1",
      JSON.stringify(["/work/site"]),
    );
    requestAutomationRun("run-1");
    await render();
    await flush();
    expect(
      container.querySelector('[data-automation-run-view="run-1"]'),
    ).not.toBeNull();
    expect(row("daily").getAttribute("aria-current")).toBe("true");
  });

  it("keeps a deleted automation's runs, and their chats reachable", async () => {
    saveScheduledRun({ ...finished, scheduleId: "gone", name: "Old report" });
    await render();
    expect(folders()).toEqual([
      { name: "site", count: "1", items: ["Old report"] },
    ]);
    expect(automationChatIds().has("session-1")).toBe(true);
    await click(row("gone"));
    expect(container.textContent).toContain("This automation was deleted");
    await click(
      container.querySelector<HTMLButtonElement>(
        '[data-automation-run="run-1"]',
      )!,
    );
    await flush();
    expect(container.querySelector("[data-transcript]")).not.toBeNull();
  });

  it("lists a run from before runs stayed here, and opens its chat as before", async () => {
    // An earlier Aven's run: its chat is an ordinary chat, listed with the
    // project's chats, and stays one.
    const { inAutomations: _, ...legacy } = finished;
    saveScheduledAgent(schedule);
    saveScheduledRun(legacy);
    await render();
    expect(automationChatIds().has("session-1")).toBe(false);
    await click(row("daily"));
    await click(
      container.querySelector<HTMLButtonElement>(
        '[data-automation-run="run-1"]',
      )!,
    );
    await flush();
    expect(container.querySelector("[data-transcript]")).not.toBeNull();
    // Already a chat: the button opens it, and says so.
    expect(() => button("Open as chat")).toThrow();
    await click(button("Open chat"));
    expect(onOpenRunAsChat.mock.calls[0]![0]).toMatchObject({ id: "run-1" });
  });

  it("creates an automation from a blank form", async () => {
    await render();
    await click(button("New automation"));
    expect(button("Create automation").disabled).toBe(true);
    // Ask first is the default access and may stall an unattended run.
    expect(container.querySelector('[role="note"]')?.textContent).toMatch(
      /pauses whenever the agent asks for approval/,
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
    // It is in the open project's folder, and shown.
    expect(folders()).toEqual([
      { name: "site", count: "1", items: ["Morning review"] },
    ]);
    expect(row(saved!.id).getAttribute("aria-current")).toBe("true");
  });

  it("creates an automation in the folder whose + was pressed", async () => {
    saveScheduledAgent({ ...schedule, project: NOTES });
    await render();
    await click(button("New automation in notes"));
    await type("Name", "Lint");
    await type("Prompt", "Run the linter");
    await click(button("Create automation"));
    const lint = listScheduledAgents().find((item) => item.name === "Lint")!;
    expect(lint.project).toBe(NOTES);
    expect(folders()).toEqual([
      { name: "notes", count: "2", items: ["Lint", "Morning review"] },
    ]);
  });

  it("moves an automation to another project's folder", async () => {
    saveScheduledAgent(schedule);
    await render();
    await click(row("daily"));
    await click(button("Edit Morning review"));
    await click(
      container.querySelector<HTMLButtonElement>(
        '[data-scheduled-editor] [aria-label="Project"]',
      )!,
    );
    await click(
      [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (option) => option.textContent?.includes("notes"),
      )!,
    );
    await click(button("Save"));
    expect(listScheduledAgents()[0]!.project).toBe(NOTES);
    expect(folders()).toEqual([
      { name: "notes", count: "1", items: ["Morning review"] },
    ]);
  });

  it("turns an automation off and back on, and runs it now", async () => {
    saveScheduledAgent(schedule);
    await render();
    await click(row("daily"));
    const toggle = button("Run Morning review on schedule");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await click(toggle);
    expect(listScheduledAgents()[0]!.enabled).toBe(false);
    expect(row("daily").textContent).toContain("Off");
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
    await click(row("daily"));
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
    await click(row("daily"));
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

  it("shows the GitHub list with no source tabs", async () => {
    await renderInbox();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(
      container.querySelector('input[aria-label="Filter inbox"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-scheduled-editor]")).toBeNull();
  });

  it("opens normally when the saved source was Scheduled", async () => {
    localStorage.setItem("monocode.inboxSource", "scheduled");
    await renderInbox();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(
      container.querySelector('input[aria-label="Filter inbox"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-scheduled-editor]")).toBeNull();
  });

  it("shows a card an automation left, and nothing for a plain run", async () => {
    saveScheduledRun(finished);
    await renderInbox();
    expect(container.querySelector("[data-review-card]")).toBeNull();

    const onReviewAction = vi.fn();
    const onOpenAutomationRun = vi.fn();
    saveScheduledRun({
      ...finished,
      id: "run-2",
      sessionId: "session-2",
      review: {
        kind: "publish",
        title: "October changelog",
        summary: "Saved as a draft in Framer.",
        url: "https://framer.com/projects/site",
        status: "open",
        postedAt: Date.now(),
      },
    });
    await act(async () =>
      root.render(
        createElement(InboxView, {
          onAsk: async () => "",
          onAskRestart: async () => "",
          onAskMount: () => {},
          cwd: PROJECT,
          recents: [{ path: PROJECT, openedAt: 1 }],
          onReviewAction,
          onOpenAutomationRun,
        }),
      ),
    );
    const card = container.querySelector<HTMLElement>(
      '[data-review-card="run-2"]',
    )!;
    expect(card.getAttribute("aria-label")).toBe(
      "Ready to publish: October changelog, from Morning review",
    );
    // Shown first, with its link and its button.
    const detail = container.querySelector('[data-review-detail="run-2"]')!;
    expect(detail.textContent).toContain("Saved as a draft in Framer.");
    expect(detail.textContent).toContain("framer.com/projects/site");
    // The button is Aven's, and says what it sends.
    expect(button("Publish").title).toBe(
      "Sends “Publish the draft now.” to the run",
    );
    await click(button("Publish"));
    expect(onReviewAction).toHaveBeenCalledTimes(1);
    expect(onReviewAction.mock.calls[0]![0]).toMatchObject({ id: "run-2" });
    await click(button("Open run"));
    expect(onOpenAutomationRun).toHaveBeenCalledWith("run-2");
    // Done takes it out of the Inbox; the run keeps it, marked done.
    await click(button("Done"));
    expect(container.querySelector("[data-review-card]")).toBeNull();
    expect(getScheduledRun("run-2")!.review!.status).toBe("done");
  });

  it("names reviews in its header and its empty list", async () => {
    await renderInbox();
    await flush();
    expect(container.textContent).toContain("Reviews, issues & pull requests");
    expect(container.textContent).toContain(
      "No matching reviews, issues or pull requests",
    );
  });

  it("keeps a card's button off while its run is working", async () => {
    saveScheduledRun({
      ...finished,
      id: "run-3",
      status: "running",
      finishedAt: undefined,
      review: {
        kind: "review",
        title: "Preview",
        summary: "",
        status: "open",
        postedAt: Date.now(),
      },
    });
    const onReviewAction = vi.fn();
    await act(async () =>
      root.render(
        createElement(InboxView, {
          onAsk: async () => "",
          onAskRestart: async () => "",
          onAskMount: () => {},
          cwd: PROJECT,
          recents: [{ path: PROJECT, openedAt: 1 }],
          onReviewAction,
        }),
      ),
    );
    const approve = button("Approve");
    expect(approve.disabled).toBe(true);
    expect(approve.title).toBe("The run is still working");
    await click(approve);
    expect(onReviewAction).not.toHaveBeenCalled();
  });

  it("hides a card from a project the Inbox's filters hide", async () => {
    saveScheduledRun({
      ...finished,
      id: "run-4",
      review: {
        kind: "review",
        title: "Preview",
        summary: "",
        status: "open",
        postedAt: Date.now(),
      },
    });
    localStorage.setItem(
      "monocode.inboxFilters",
      JSON.stringify({ hiddenProjects: [PROJECT] }),
    );
    await renderInbox();
    expect(container.querySelector("[data-review-card]")).toBeNull();
  });

  it("ignores a palette request for a new automation", async () => {
    await renderInbox();
    await act(async () => requestScheduleEditor());
    expect(container.querySelector("[data-scheduled-editor]")).toBeNull();
    expect(
      container.querySelector('input[aria-label="Filter inbox"]'),
    ).not.toBeNull();
    // Still waiting for the Automations view to take it.
    expect(takeAutomationsRequest()).toEqual({ kind: "new" });
  });
});
