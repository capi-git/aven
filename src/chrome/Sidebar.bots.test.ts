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
// Only Git projects can have a bot; "/tmp/notes" is a plain folder,
// "/tmp/drafts" uses Git with nothing saved yet, and "/tmp/gone" is missing.
const copy = vi.hoisted(() => ({
  botProjectStates: vi.fn(async (paths: readonly string[]) =>
    paths.map((path) =>
      path === "/tmp/notes"
        ? "no-git"
        : path === "/tmp/drafts"
          ? "no-commit"
          : path === "/tmp/gone"
            ? "unavailable"
            : "ready",
    ),
  ),
}));
vi.mock("../lib/projectBotCopy", () => copy);
const gitSetup = vi.hoisted(() => ({
  setUpProjectGit: vi.fn(),
}));
vi.mock("../lib/projectGitSetup", async (original) => ({
  ...(await original<typeof import("../lib/projectGitSetup")>()),
  setUpProjectGit: gitSetup.setUpProjectGit,
}));

const cwd = "/tmp/sidebar-bots";
const docs = "/tmp/docs-site";
const notes = "/tmp/notes";
const drafts = "/tmp/drafts";
const gone = "/tmp/gone";
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
  copy.botProjectStates.mockClear();
  gitSetup.setUpProjectGit.mockReset();
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

const picker = () =>
  document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Add a bot to"]',
  );
const readyRows = () =>
  [...picker()!.querySelectorAll<HTMLElement>("[data-bot-ready]")].map(
    (row) => row.textContent,
  );
const setupRows = () =>
  [...picker()!.querySelectorAll<HTMLElement>("[data-bot-setup]")].map(
    (row) => row.textContent,
  );

it("New bot lists the Git projects without a bot, and picking one adds it", async () => {
  const onAddBot = vi.fn();
  await act(async () =>
    root.render(createElement(Sidebar, { ...props, bots: [jelly], onAddBot })),
  );
  await act(async () => button("New bot")!.click());
  // Jelly's project already has a bot.
  expect(copy.botProjectStates).toHaveBeenCalledWith([docs, notes]);
  expect(readyRows()).toEqual(["docs-site"]);
  await act(async () => button("docs-site")!.click());
  expect(onAddBot).toHaveBeenCalledWith(docs);
  expect(gitSetup.setUpProjectGit).not.toHaveBeenCalled();
  expect(picker()).toBeNull();
});

it("lists the projects that need Git below the ready ones, each with its button", async () => {
  await act(async () =>
    root.render(
      createElement(Sidebar, {
        ...props,
        recents: [
          { path: notes, openedAt: 5 },
          { path: cwd, openedAt: 4 },
          { path: drafts, openedAt: 3 },
          { path: docs, openedAt: 2 },
          { path: gone, openedAt: 1 },
        ],
        onAddBot: vi.fn(),
      }),
    ),
  );
  await act(async () => button("New bot")!.click());
  // Ready first, in project order; a missing folder isn't offered at all.
  expect(readyRows()).toEqual(["sidebar-bots", "docs-site"]);
  expect(setupRows()).toEqual([
    "notesNot using Git yetSet up Git",
    "draftsNothing saved in Git yetMake a first save",
  ]);
  const rows = [
    ...picker()!.querySelectorAll("[data-bot-ready], [data-bot-setup]"),
  ];
  expect(
    rows.indexOf(picker()!.querySelector("[data-bot-setup]")!),
  ).toBeGreaterThan(
    rows.indexOf(picker()!.querySelectorAll("[data-bot-ready]")[1]!),
  );
  expect(picker()!.querySelector(".bot-picker-note")?.textContent).toMatch(
    /^Bots need Git to keep their own copy of your project\. Set up Git turns it on for that project on this (Mac|computer)\. Nothing is uploaded\.$/,
  );
});

it("Set up Git sets it up on that row, then adds the bot", async () => {
  const onAddBot = vi.fn();
  let finish: (value: unknown) => void = () => {};
  gitSetup.setUpProjectGit.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () =>
    root.render(createElement(Sidebar, { ...props, onAddBot })),
  );
  await act(async () => button("New bot")!.click());
  await act(async () => button("Set up Git for notes")!.click());
  expect(gitSetup.setUpProjectGit).toHaveBeenCalledWith(notes);
  const row = picker()!.querySelector<HTMLElement>("[data-bot-setup]")!;
  expect(row.querySelector('[role="status"]')?.textContent).toBe(
    "Setting up Git…",
  );
  expect(button("Set up Git for notes")!.disabled).toBe(true);
  // Nothing else can start meanwhile, and the picker stays.
  expect(button("docs-site")!.disabled).toBe(true);
  await act(async () => {
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
  });
  expect(picker()).not.toBeNull();
  expect(onAddBot).not.toHaveBeenCalled();
  await act(async () => finish({ started: true, wroteIgnore: true, files: 3 }));
  expect(onAddBot).toHaveBeenCalledExactlyOnceWith(notes);
  expect(picker()).toBeNull();
});

it("shows a problem setting up Git on the row, in plain words", async () => {
  const onAddBot = vi.fn();
  gitSetup.setUpProjectGit.mockRejectedValue(
    "This folder is too big to start tracking automatically: 34,120 files. Add a .gitignore for large folders, or set up Git yourself.",
  );
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () =>
    root.render(createElement(Sidebar, { ...props, onAddBot })),
  );
  await act(async () => button("New bot")!.click());
  await act(async () => button("Set up Git for notes")!.click());
  const row = picker()!.querySelector<HTMLElement>("[data-bot-setup]")!;
  expect(row.querySelector('[role="alert"]')?.textContent).toBe(
    "This folder is too big to start tracking automatically: 34,120 files. Add a .gitignore for large folders, or set up Git yourself.",
  );
  expect(row.querySelector('[role="status"]')).toBeNull();
  // It can be tried again, and nothing was added.
  expect(button("Set up Git for notes")!.disabled).toBe(false);
  expect(onAddBot).not.toHaveBeenCalled();
  expect(picker()).not.toBeNull();
  quiet.mockRestore();
});

it("offers one quiet Add a bot when there are none yet", async () => {
  const onAddBot = vi.fn();
  await act(async () =>
    root.render(createElement(Sidebar, { ...props, onAddBot })),
  );
  const section = botsSection()!;
  expect(section.querySelectorAll("[data-bot-row]")).toHaveLength(0);
  await act(async () => button("Add a bot")!.click());
  expect(readyRows()).toEqual(["sidebar-bots", "docs-site"]);
  expect(setupRows()).toEqual(["notesNot using Git yetSet up Git"]);
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
        onAddBot: vi.fn(),
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
