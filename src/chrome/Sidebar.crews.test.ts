// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../lib/sessionStore";
import { Sidebar, type SidebarBot, type SidebarProps } from "./Sidebar";
import { crewMenuItems, type SidebarCrew } from "./SidebarCrews";

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
const docs = "/tmp/docs";

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
      name: "Beetle",
      roleLabel: "Builder",
      status: "working",
      line: "Fixing Dark mode toggle · round 2",
      sessionId: "builder-chat",
      active: true,
    },
    {
      id: "checker",
      role: "checker",
      name: "Owl",
      roleLabel: "Checker",
      sessionId: "checker-chat",
      active: false,
    },
    {
      id: "scout",
      role: "scout",
      name: "Fox",
      roleLabel: "Scout",
      active: false,
    },
    {
      id: "fixer",
      role: "fixer",
      name: "Jelly",
      roleLabel: "Fixer",
      status: "watching",
      active: false,
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
      { path: docs, openedAt: 1 },
    ],
    sessions: [
      // The crew's chats are newest, yet never listed with the project's.
      summary("builder-chat", "Beetle", 9),
      summary("checker-chat", "Owl", 8),
      summary("chat", "Claude Code · Sign-up flow", 3),
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

const section = () =>
  container.querySelector<HTMLElement>("[data-sidebar-bots]")!;
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) =>
      item.textContent === label || item.getAttribute("aria-label") === label,
  );

it("lists a crew per project in Crews, with its critters and one word", async () => {
  const onOpenCrew = vi.fn();
  await act(async () =>
    root.render(
      createElement(Sidebar, {
        ...props,
        crews: [crew],
        bots: [puffin],
        onOpenCrew,
        onAddCrew: vi.fn(),
      }),
    ),
  );
  expect(
    section().querySelector(".personal-projects-heading")?.textContent,
  ).toBe("Crews");
  const chats = [
    ...container.querySelectorAll(
      ".personal-project-group [data-session-card] .personal-task-title",
    ),
  ].map((row) => row.textContent);
  expect(chats).toEqual(["Claude Code · Sign-up flow"]);
  const row = section().querySelector<HTMLElement>("[data-crew-row]")!;
  expect(row.querySelector(".personal-task-title")?.textContent).toBe(
    "aven-site",
  );
  expect(row.querySelectorAll("[data-crew-critter]")).toHaveLength(3);
  expect(row.querySelector(".crew-critters-more")?.textContent).toBe("+1");
  expect(row.querySelector("[data-crew-status]")?.textContent).toBe("Working");
  await act(async () =>
    row.querySelector<HTMLButtonElement>(".personal-crew-open")!.click(),
  );
  expect(onOpenCrew).toHaveBeenCalledWith(site);
  // A project whose only bot is its Fixer looks just like today's bot row.
  const bot = section().querySelector<HTMLElement>("[data-bot-row]")!;
  expect(bot.querySelector(".personal-task-title")?.textContent).toBe("Puffin");
});

it("says a role once when a member goes by it, and shows a Fixer's project", async () => {
  const roles: SidebarCrew = {
    ...crew,
    members: [
      { ...crew.members[0], name: "Builder" },
      { ...crew.members[0], id: "builder-2", name: "Builder 2", active: false },
      { ...crew.members[1], name: "Checker" },
      { ...crew.members[3], name: "Fixer" },
    ],
  };
  await act(async () =>
    root.render(
      createElement(Sidebar, {
        ...props,
        crews: [roles],
        bots: [{ ...puffin, name: "Fixer" }],
      }),
    ),
  );
  await act(async () => button("Show aven-site's crew")!.click());
  const members = [
    ...section().querySelectorAll<HTMLElement>("[data-crew-member]"),
  ];
  expect(
    members.map((member) => [
      member.querySelector(".personal-task-title")?.textContent,
      member.querySelector(".personal-crew-role")?.textContent ?? null,
      member.title.split("\n")[0],
    ]),
  ).toEqual([
    ["Builder", null, "Builder"],
    ["Builder 2", null, "Builder 2"],
    ["Checker", null, "Checker"],
    ["Fixer", null, "Fixer"],
  ]);
  // A bot called by its role keeps its project in view, not only on hover.
  const bot = section().querySelector<HTMLElement>("[data-bot-row]")!;
  expect(bot.querySelector(".personal-task-title")?.textContent).toBe("Fixer");
  expect(bot.hasAttribute("data-role-name")).toBe(true);
});

it("unfolds into each bot with its role, its word and what it's doing", async () => {
  const onOpenCrewMember = vi.fn();
  await act(async () =>
    root.render(
      createElement(Sidebar, { ...props, crews: [crew], onOpenCrewMember }),
    ),
  );
  expect(section().querySelector("[data-crew-member]")).toBeNull();
  await act(async () => button("Show aven-site's crew")!.click());
  const members = [
    ...section().querySelectorAll<HTMLElement>("[data-crew-member]"),
  ];
  expect(
    members.map((member) => [
      member.querySelector(".personal-task-title")?.textContent,
      member.querySelector(".personal-crew-role")?.textContent,
      member.querySelector("[data-crew-status]")?.textContent ?? null,
    ]),
  ).toEqual([
    ["Beetle", "Builder", "Working"],
    ["Owl", "Checker", null],
    ["Fox", "Scout", null],
    ["Jelly", "Fixer", "Watching"],
  ]);
  expect(members[0].querySelector(".personal-crew-line")?.textContent).toBe(
    "Fixing Dark mode toggle · round 2",
  );
  // Each wears its role's mark; the Builder's light sweeps while it works.
  expect(
    members.map(
      (member) =>
        member.querySelector<HTMLElement>("[data-crew-critter] .dot-mark")
          ?.dataset.sigil,
    ),
  ).toEqual(["builder", "checker", "scout", "fixer"]);
  expect(
    members[0].querySelector<HTMLElement>(".dot-mark")?.dataset.state,
  ).toBe("working");
  await act(async () => members[1].click());
  expect(onOpenCrewMember).toHaveBeenCalledWith(site, "checker");
  // The fold is remembered.
  expect(localStorage.getItem("aven.sidebar.crewsOpen")).toBe(
    JSON.stringify([site]),
  );
});

it("offers Open crew, Tell the crew, Pause and Settings on right-click, with today's runs", async () => {
  const onCrewAction = vi.fn();
  await act(async () =>
    root.render(
      createElement(Sidebar, { ...props, crews: [crew], onCrewAction }),
    ),
  );
  const row = section().querySelector<HTMLElement>("[data-crew-row]")!;
  await act(async () => {
    row.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 }),
    );
  });
  const items = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ];
  expect(items.map((item) => item.textContent)).toEqual([
    "Open crew",
    "Tell the crew…",
    "Pause crew",
    "Settings…",
    "7 of 20 runs today",
  ]);
  expect(items[4].disabled).toBe(true);
  await act(async () => items[2].click());
  expect(onCrewAction).toHaveBeenCalledWith(site, "pause");
  expect(
    crewMenuItems({ ...crew, paused: true }).some(
      (item) => item.kind === "item" && item.label === "Resume crew",
    ),
  ).toBe(true);
});

it("New crew lists the projects without one, and picking one adds it", async () => {
  const onAddCrew = vi.fn();
  await act(async () =>
    root.render(createElement(Sidebar, { ...props, crews: [crew], onAddCrew })),
  );
  await act(async () => button("New crew")!.click());
  expect(copy.botProjectStates).toHaveBeenCalledWith([notes, docs]);
  expect(
    document.querySelector('[role="dialog"][aria-label="Add a crew to"]'),
  ).toBeTruthy();
  await act(async () => button("notes-app")!.click());
  expect(onAddCrew).toHaveBeenCalledWith(notes);
});

it("offers no crews where bots can't run", async () => {
  platform.windows = true;
  await act(async () =>
    root.render(
      createElement(Sidebar, { ...props, crews: [], onAddCrew: vi.fn() }),
    ),
  );
  expect(button("New crew")).toBeUndefined();
});
