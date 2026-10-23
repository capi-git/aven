// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../lib/sessionStore";
import { Sidebar, type SidebarBot, type SidebarProps } from "./Sidebar";

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

const cwd = "/tmp/sidebar-bots";
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

const jelly: SidebarBot = {
  path: cwd,
  sessionId: "bot-chat",
  name: "Jelly",
  status: "fix-ready",
  headline: "Fix ready: 2 files",
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
      // The bot's chat is the newest, yet never listed with the others.
      summary("bot-chat", "Jelly", 9),
      summary("chat", "Claude Code · Login bug", 3),
      summary("other", "Claude Code · Docs", 1),
    ],
    busySessionIds: new Set(),
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

const rows = () =>
  [
    ...container.querySelectorAll(
      "[data-bot-row], [data-session-card] .personal-task-title",
    ),
  ].map((row) =>
    row.hasAttribute("data-bot-row")
      ? `bot:${row.querySelector(".personal-task-title")?.textContent}`
      : row.textContent,
  );

it("pins a project's bot above its chats and leaves its chat out of the list", async () => {
  const onOpenBot = vi.fn();
  const onBotSettings = vi.fn();
  await act(async () =>
    root.render(
      createElement(Sidebar, {
        ...props,
        bots: [jelly],
        onOpenBot,
        onBotSettings,
      }),
    ),
  );
  expect(rows()).toEqual([
    "bot:Jelly",
    "Claude Code · Login bug",
    "Claude Code · Docs",
  ]);
  const row = container.querySelector<HTMLButtonElement>("[data-bot-row]")!;
  expect(row.querySelector("[data-bot-status]")?.textContent).toBe("Fix ready");
  // No extra "bot" label: the critter, the name and its word.
  expect(row.textContent).toBe("JellyFix ready");
  await act(async () => row.click());
  expect(onOpenBot).toHaveBeenCalledWith(cwd);
  await act(async () => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  });
  expect(onBotSettings).toHaveBeenCalledWith(cwd);
});

it("lists the chat as usual once the bot is off", async () => {
  await act(async () => root.render(createElement(Sidebar, props)));
  expect(rows()).toEqual([
    "Jelly",
    "Claude Code · Login bug",
    "Claude Code · Docs",
  ]);
  expect(container.querySelector("[data-bot-row]")).toBeNull();
});
