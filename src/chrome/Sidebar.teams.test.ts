// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../lib/sessionStore";
import type { SidebarTeam } from "../lib/teamGrouping";
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

const cwd = "/tmp/sidebar-teams";
function summary(id: string, title: string, updatedAt: number): SessionSummary {
  return {
    id,
    cwd,
    harness: "claude",
    model: "opus",
    runtimeMode: "supervised",
    title,
    createdAt: 1,
    updatedAt,
    additions: 0,
    deletions: 0,
  };
}

const race: SidebarTeam = {
  id: "race:r1",
  kind: "race",
  status: "Racing · 1 of 2 done",
  members: [
    { sessionId: "l0", harness: "claude" },
    { sessionId: "l1", harness: "codex" },
  ],
  count: 2,
  working: 1,
  needsYou: false,
  originId: "chat",
  memberIds: ["l0", "l1"],
};

let container: HTMLDivElement;
let root: Root;
let props: SidebarProps;

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
    sessions: [
      summary("chat", "Claude Code · Login bug", 3),
      summary("l0", "Race · Claude Code · Opus", 2),
      summary("l1", "Race · Codex · GPT-5", 1),
      summary("other", "Claude Code · Docs", 0),
    ],
    busySessionIds: new Set(["l1"]),
    approvalSessionIds: new Set(),
    status: "idle",
    pending: false,
    onSelectSession: vi.fn(),
    onOpenFile: vi.fn(),
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

const titles = () =>
  [...container.querySelectorAll("[data-session-card] .personal-task-title")]
    .map((title) => title.textContent)
    .filter(Boolean);

it("shows an open race as one row, its lanes folded into the chat it came from", async () => {
  await act(async () =>
    root.render(createElement(Sidebar, { ...props, teams: [race] })),
  );
  expect(titles()).toEqual(["Claude Code · Login bug", "Claude Code · Docs"]);
  const badge = container.querySelector<HTMLElement>(
    "[data-sidebar-team='race:r1']",
  )!;
  expect(badge.textContent).toBe("1 of 2 done");
  expect(badge.title).toBe("Racing · 1 of 2 done · 2 agents");
  expect(badge.querySelectorAll("[data-discussion-avatar]")).toHaveLength(2);
  // Once the race is over the lanes are chats of their own again.
  await act(async () =>
    root.render(createElement(Sidebar, { ...props, teams: [] })),
  );
  expect(titles()).toEqual([
    "Claude Code · Login bug",
    "Race · Claude Code · Opus",
    "Race · Codex · GPT-5",
    "Claude Code · Docs",
  ]);
});

it("names a row waiting for its team Needs you", async () => {
  await act(async () =>
    root.render(
      createElement(Sidebar, {
        ...props,
        approvalSessionIds: new Set(["chat"]),
        teamNeedIds: new Set(["chat"]),
      }),
    ),
  );
  const row = container.querySelector("[data-session-card='chat']")!;
  expect(
    row.querySelector(".personal-task-status")?.getAttribute("title"),
  ).toBe("Needs you");
});
