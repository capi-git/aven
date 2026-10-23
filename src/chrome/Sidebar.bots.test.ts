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
// Only Git projects can have a bot; "/tmp/notes" is a plain folder.
const copy = vi.hoisted(() => ({
  botReadyPaths: vi.fn(async (paths: readonly string[]) =>
    paths.filter((path) => path !== "/tmp/notes"),
  ),
}));
vi.mock("../lib/projectBotCopy", () => copy);

const cwd = "/tmp/sidebar-bots";
const docs = "/tmp/docs-site";
const notes = "/tmp/notes";
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
  project: "sidebar-bots",
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
  copy.botReadyPaths.mockClear();
  props = {
    cwd,
    open: true,
    recents: [
      { path: cwd, openedAt: 3 },
      { path: docs, openedAt: 2 },
      { path: notes, openedAt: 1 },
    ],
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

const chatRows = () =>
  [
    ...container.querySelectorAll(
      ".personal-project-group [data-session-card] .personal-task-title",
    ),
  ].map((row) => row.textContent);
const botsSection = () =>
  container.querySelector<HTMLElement>("[data-sidebar-bots]");
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) =>
      item.textContent === label || item.getAttribute("aria-label") === label,
  );

it("lists bots in their own section below the projects, not with their project's chats", async () => {
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
  expect(chatRows()).toEqual(["Claude Code · Login bug", "Claude Code · Docs"]);
  const section = botsSection()!;
  expect(section.querySelector(".personal-projects-heading")?.textContent).toBe(
    "Bots",
  );
  // Below every project group.
  const groups = container.querySelectorAll(".personal-project-group");
  expect(
    groups[groups.length - 1]!.compareDocumentPosition(section) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    container.querySelectorAll(".personal-project-group [data-bot-row]"),
  ).toHaveLength(0);
  const row = section.querySelector<HTMLButtonElement>("[data-bot-row]")!;
  // Critter, name and its word; the project shows on hover.
  expect(row.querySelector(".personal-task-title")?.textContent).toBe("Jelly");
  expect(row.querySelector(".personal-bot-project")?.textContent).toBe(
    "sidebar-bots",
  );
  expect(row.querySelector("[data-bot-status]")?.textContent).toBe("Fix ready");
  expect(row.title).toContain("sidebar-bots's teammate");
  await act(async () => row.click());
  expect(onOpenBot).toHaveBeenCalledWith(cwd);
  await act(async () => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  });
  expect(onBotSettings).toHaveBeenCalledWith(cwd);
});

it("New bot lists the Git projects without a bot, and picking one adds it", async () => {
  const onAddBot = vi.fn();
  await act(async () =>
    root.render(createElement(Sidebar, { ...props, bots: [jelly], onAddBot })),
  );
  await act(async () => button("New bot")!.click());
  // Jelly's project already has a bot; the plain folder can't have one.
  expect(copy.botReadyPaths).toHaveBeenCalledWith([docs, notes]);
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  expect(
    [...menu.querySelectorAll("button")].map((item) => item.textContent),
  ).toEqual(["docs-site"]);
  await act(async () => button("docs-site")!.click());
  expect(onAddBot).toHaveBeenCalledWith(docs);
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("offers one quiet Add a bot when there are none yet", async () => {
  const onAddBot = vi.fn();
  await act(async () =>
    root.render(createElement(Sidebar, { ...props, onAddBot })),
  );
  const section = botsSection()!;
  expect(section.querySelectorAll("[data-bot-row]")).toHaveLength(0);
  await act(async () => button("Add a bot")!.click());
  expect(
    [...document.querySelectorAll<HTMLElement>('[role="menu"] button')].map(
      (item) => item.textContent,
    ),
  ).toEqual(["sidebar-bots", "docs-site"]);
});

it("lists the chat as usual once the bot is off", async () => {
  await act(async () => root.render(createElement(Sidebar, props)));
  expect(chatRows()).toEqual([
    "Jelly",
    "Claude Code · Login bug",
    "Claude Code · Docs",
  ]);
  expect(container.querySelector("[data-bot-row]")).toBeNull();
  expect(botsSection()).toBeNull();
});
