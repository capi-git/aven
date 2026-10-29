// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../lib/sessionStore";
import {
  markRunOpenedAsChat,
  saveScheduledRun,
  type ScheduledRun,
} from "../lib/scheduledAgents";
import { Sidebar, type SidebarProps } from "./Sidebar";

vi.mock("./TitleBar", () => ({
  DevModeSlot: () => null,
  TabVisitNav: () => null,
}));
vi.mock("./WorkspaceThemePopover", () => ({
  WorkspaceThemePopover: () => null,
}));
vi.mock("./PersonalWorkspaceSwitcher", () => ({
  PersonalWorkspaceSwitcher: () => null,
  WorkspaceProfileIcon: () => null,
}));
vi.mock("./PersonalProjectRow", () => ({ PersonalProjectRow: () => null }));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("./SettingsRail", () => ({ SettingsNav: () => null }));
vi.mock("../lib/projectBotCopy", () => ({
  botProjectStates: async (paths: readonly string[]) =>
    paths.map(() => "ready"),
}));

const cwd = "/tmp/sidebar-runs";
function summary(id: string, title: string, updatedAt: number): SessionSummary {
  return {
    id,
    cwd,
    harness: "claude",
    model: "opus",
    runtimeMode: "auto",
    title,
    createdAt: 1,
    updatedAt,
    additions: 0,
    deletions: 0,
  };
}

let container: HTMLDivElement;
let root: Root;
let props: SidebarProps;

const run = (patch: Partial<ScheduledRun>): ScheduledRun => ({
  id: "run-1",
  scheduleId: "brief",
  name: "Morning briefing",
  project: cwd,
  sessionId: "run-chat",
  status: "completed",
  summary: "Quiet day.",
  startedAt: 5,
  finishedAt: 6,
  ...patch,
});

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  props = {
    cwd,
    open: true,
    recents: [{ path: cwd, openedAt: 3 }],
    sessions: [
      // The run's chat is the newest, yet never listed with the others.
      summary("run-chat", "Scheduled · Morning briefing", 9),
      summary("chat", "Claude Code · Login bug", 3),
    ],
    busySessionIds: new Set(),
    approvalSessionIds: new Set(),
    status: "idle",
    pending: false,
    onSelectSession: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenInbox: vi.fn(),
    onOpenAutomations: vi.fn(),
    tab: "sessions",
    onTabChange: vi.fn(),
    filesSearchOpen: false,
    onFilesSearchOpenChange: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const chatRows = () =>
  [
    ...container.querySelectorAll(
      ".personal-project-group [data-session-card] .personal-task-title",
    ),
  ].map((row) => row.textContent);
const tileCount = (id: string) =>
  container.querySelector(
    `.personal-library-tile[data-library="${id}"] .personal-library-count`,
  )?.textContent ?? null;

it("keeps an automation run's chat out of the chats list until it is opened as a chat", async () => {
  saveScheduledRun(run({}));
  await act(async () => root.render(createElement(Sidebar, props)));
  expect(chatRows()).toEqual(["Claude Code · Login bug"]);

  await act(async () => markRunOpenedAsChat("run-1"));
  expect(chatRows()).toEqual([
    "Scheduled · Morning briefing",
    "Claude Code · Login bug",
  ]);
});

it("counts the cards automations left on the Inbox, and failed runs on Automations", async () => {
  await act(async () => root.render(createElement(Sidebar, props)));
  expect(tileCount("inbox")).toBeNull();
  expect(tileCount("automations")).toBeNull();
  await act(async () =>
    saveScheduledRun(
      run({
        review: {
          kind: "review",
          title: "Preview",
          summary: "",
          status: "open",
          postedAt: 7,
        },
      }),
    ),
  );
  expect(tileCount("inbox")).toBe("1");
  await act(async () =>
    root.render(createElement(Sidebar, { ...props, automationsUnread: 2 })),
  );
  expect(tileCount("automations")).toBe("2");
});
