// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../lib/sessionStore";
import type { AvosGlance } from "../lib/avos";
import { Sidebar, type SidebarBot, type SidebarProps } from "./Sidebar";
import type { SidebarCrew } from "./SidebarCrews";

vi.mock("./TitleBar", () => ({
  DevModeSlot: () => null,
  TabVisitNav: () => null,
}));
vi.mock("./PersonalWorkspaceSwitcher", () => ({
  PersonalWorkspaceSwitcher: () => null,
  WorkspaceProfileIcon: () => null,
}));
vi.mock("./PersonalProjectRow", () => ({
  PersonalProjectRow: () => null,
}));
const platform = vi.hoisted(() => ({ windows: false }));
vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  get IS_WIN() {
    return platform.windows;
  },
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("./SettingsRail", () => ({ SettingsNav: () => null }));
const copy = vi.hoisted(() => ({
  botProjectStates: vi.fn(async (paths: readonly string[]) =>
    paths.map(() => "ready"),
  ),
}));
vi.mock("../lib/projectBotCopy", () => copy);
// The menu as plain buttons, so its items can be read and picked.
vi.mock("./ExplorerMenu", async () => {
  const react = await import("react");
  return {
    ...(await vi.importActual<typeof import("./ExplorerMenu")>(
      "./ExplorerMenu",
    )),
    ExplorerMenu: ({
      items,
      onPick,
      ariaLabel,
    }: {
      items: {
        kind: string;
        id?: string;
        label?: string;
        disabled?: boolean;
      }[];
      onPick: (id: string) => void;
      ariaLabel?: string;
    }) =>
      react.createElement(
        "div",
        { role: "menu", "aria-label": ariaLabel },
        items
          .filter((item) => item.kind === "item")
          .map((item) =>
            react.createElement(
              "button",
              {
                key: item.id,
                role: "menuitem",
                disabled: item.disabled,
                onClick: () => onPick(item.id!),
              },
              item.label,
            ),
          ),
      ),
  };
});

const site = "/tmp/aven-site";
const notes = "/tmp/notes-app";

function summary(id: string, title: string, updatedAt: number): SessionSummary {
  return {
    id,
    cwd: site,
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

// A team that was on: its helpers' chats are never the project's chats.
const crew: SidebarCrew = {
  path: site,
  project: "aven-site",
  status: "working",
  runsLine: "7 of 20 runs today",
  paused: false,
  members: [
    {
      id: "builder",
      role: "builder",
      name: "Builder",
      roleLabel: "Builder",
      sessionId: "builder-chat",
      active: true,
    },
  ],
};

const puffin: SidebarBot = {
  path: notes,
  sessionId: "puffin-chat",
  name: "Puffin",
  project: "notes-app",
  status: "watching",
  headline: "Watching",
};

const glance = (over: Partial<AvosGlance> = {}): AvosGlance => ({
  path: site,
  note: null,
  state: "watching",
  line: "Quiet",
  ...over,
});

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
  platform.windows = false;
  copy.botProjectStates.mockClear();
  props = {
    cwd: site,
    open: true,
    recents: [
      { path: site, openedAt: 3 },
      { path: notes, openedAt: 2 },
    ],
    sessions: [
      summary("builder-chat", "Builder", 9),
      summary("chat", "Claude Code · Sign-up flow", 3),
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

const avosRow = () =>
  container.querySelector<HTMLButtonElement>(`[data-avos-row="${site}"]`);

it("puts the project's Avos first under it, and opens it on click", async () => {
  const onOpenAvos = vi.fn();
  await act(async () =>
    root.render(
      createElement(Sidebar, {
        ...props,
        crews: [crew],
        avos: [glance()],
        onOpenAvos,
      }),
    ),
  );
  const tasks = container.querySelector("#personal-project-tasks")!;
  expect(tasks.firstElementChild).toBe(avosRow());
  const row = avosRow()!;
  expect(row.querySelector(".personal-task-title")?.textContent).toBe("Avos");
  // Quiet: no note, and its Bot watches.
  expect(row.querySelector(".personal-avos-note")).toBeNull();
  expect(row.querySelector<HTMLElement>(".agent-mark")?.dataset.agent).toBe(
    "watching",
  );
  // Its helpers' chats are still not the project's chats.
  expect(
    [
      ...container.querySelectorAll("[data-session-card] .personal-task-title"),
    ].map((title) => title.textContent),
  ).toEqual(["Claude Code · Sign-up flow"]);
  await act(async () => row.click());
  expect(onOpenAvos).toHaveBeenCalledWith(site);
});

it("says Needs you in amber, or Working, and nothing else", async () => {
  const render = (over: Partial<AvosGlance>) =>
    act(async () =>
      root.render(
        createElement(Sidebar, {
          ...props,
          avos: [glance(over)],
          onOpenAvos: vi.fn(),
          activeAvosPath: site,
        }),
      ),
    );
  await render({ note: "needs-you", state: "needs" });
  expect(avosRow()?.dataset.avosNote).toBe("needs-you");
  expect(avosRow()?.querySelector(".personal-avos-note")?.textContent).toBe(
    "Needs you",
  );
  expect(avosRow()?.getAttribute("aria-current")).toBe("true");
  await render({ note: "working", state: "working" });
  expect(avosRow()?.querySelector(".personal-avos-note")?.textContent).toBe(
    "Working",
  );
  await render({ note: null, state: "resting" });
  expect(avosRow()?.querySelector(".personal-avos-note")).toBeNull();
});

it("has no Teams section: only bots that work on their own, and nothing to add", async () => {
  await act(async () =>
    root.render(
      createElement(Sidebar, {
        ...props,
        crews: [crew],
        bots: [puffin],
        avos: [glance()],
        onOpenAvos: vi.fn(),
      }),
    ),
  );
  const section = container.querySelector<HTMLElement>("[data-sidebar-bots]")!;
  expect(section.querySelector(".personal-projects-heading")?.textContent).toBe(
    "Bots",
  );
  expect(section.querySelector("[data-bot-row]")).toBeTruthy();
  expect(container.querySelector("[data-crew-row]")).toBeNull();
  expect(
    [...container.querySelectorAll("button")].some((button) =>
      /New (team|bot)|Add a (team|bot)/.test(
        button.textContent || button.getAttribute("aria-label") || "",
      ),
    ),
  ).toBe(false);
});

it("shows no Avos row where Avos isn't wired in", async () => {
  await act(async () =>
    root.render(createElement(Sidebar, { ...props, avos: [glance()] })),
  );
  expect(avosRow()).toBeNull();
});
