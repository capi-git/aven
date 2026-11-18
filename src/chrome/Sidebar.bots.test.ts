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
vi.mock("./PersonalWorkspaceSwitcher", () => ({
  PersonalWorkspaceSwitcher: () => null,
  WorkspaceProfileIcon: () => null,
}));
// The project rows' props, to see what their menus offer.
const rows = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("./PersonalProjectRow", () => ({
  PersonalProjectRow: (props: Record<string, unknown>) => {
    rows.props.push(props);
    return null;
  },
}));
// Bots need Claude Code's sandbox, which Windows lacks (see `botsAvailable`).
const platform = vi.hoisted(() => ({ windows: false }));
vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  get IS_WIN() {
    return platform.windows;
  },
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("./SettingsRail", () => ({ SettingsNav: () => null }));

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

const jelly: SidebarBot = { path: cwd, sessionId: "bot-chat" };

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
  rows.props = [];
  platform.windows = false;
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

it("lists no bot, and keeps a bot's chat out of its project's chats", async () => {
  await act(async () =>
    root.render(
      createElement(Sidebar, {
        ...props,
        bots: [jelly],
        onBotSettings: vi.fn(),
      }),
    ),
  );
  expect(chatRows()).toEqual(["Claude Code · Login bug", "Claude Code · Docs"]);
  expect(botsSection()).toBeNull();
  expect(container.querySelector("[data-bot-row]")).toBeNull();
  // Its project's menu still opens it.
  const row = rows.props.find((row) => row.botOn === true);
  expect(row?.onBotSettings).toBeTypeOf("function");
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

it("offers no bot on Windows, where Claude Code's sandbox doesn't run", async () => {
  platform.windows = true;
  await act(async () =>
    root.render(
      createElement(Sidebar, {
        ...props,
        onBotSettings: vi.fn(),
      }),
    ),
  );
  expect(botsSection()).toBeNull();
  expect(button("New bot")).toBeUndefined();
  expect(button("Add a bot")).toBeUndefined();
  // The project menus get no "Add a bot" either.
  expect(rows.props.length).toBeGreaterThan(0);
  expect(rows.props.every((row) => row.onBotSettings === undefined)).toBe(true);
});
