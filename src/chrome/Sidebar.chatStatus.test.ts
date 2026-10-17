// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatStatusWord } from "../lib/chatStatus";
import { decodeSidebarValue, encodeSidebarValue } from "../lib/floatingSidebar";
import type { SessionSummary } from "../lib/sessionStore";
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

const cwd = "/tmp/sidebar-status";
const summary = (id: string, title: string, updatedAt: number) =>
  ({
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
  }) satisfies SessionSummary;

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
      summary("work", "Ready view", 5),
      summary("ask", "Publish reminders", 4),
      summary("fix", "Fix sign-in redirect", 3),
      summary("done", "Clean output dir", 2),
      summary("race", "Team panel polish", 1),
      summary("idle", "Old notes", Date.now() - 2 * 3_600_000),
    ],
    busySessionIds: new Set(["work"]),
    approvalSessionIds: new Set(["ask"]),
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

const words: Record<string, ChatStatusWord> = {
  work: "working",
  ask: "needs-you",
  fix: "review",
  done: "shipped",
  race: "racing",
};

const pill = (id: string) =>
  container.querySelector<HTMLElement>(
    `[data-session-card='${id}'] [data-chat-status]`,
  );

it("shows each chat's word as a pill on its row", async () => {
  await act(async () =>
    root.render(createElement(Sidebar, { ...props, chatStatus: words })),
  );
  expect(
    Object.fromEntries(
      Object.keys(words).map((id) => [id, pill(id)?.textContent]),
    ),
  ).toEqual({
    work: "Working",
    ask: "Needs you",
    fix: "Review",
    done: "Shipped",
    race: "Racing",
  });
  expect(pill("race")?.dataset.stage).toBe("working");
  expect(pill("ask")?.dataset.stage).toBe("needs-you");
  // A chat with nothing pending shows no word, only its time.
  expect(pill("idle")).toBeNull();
  expect(
    container.querySelector("[data-session-card='idle'] .personal-task-status")
      ?.textContent,
  ).toBeTruthy();
});

it("keeps the word across the floating sidebar's copy of its props", async () => {
  const copied = decodeSidebarValue(
    encodeSidebarValue({ ...props, chatStatus: words }),
  ) as SidebarProps;
  await act(async () =>
    root.render(
      createElement(Sidebar, {
        ...props,
        chatStatus: copied.chatStatus,
      }),
    ),
  );
  expect(pill("fix")?.textContent).toBe("Review");
  expect(pill("done")?.textContent).toBe("Shipped");
});

it("follows a word as it changes", async () => {
  await act(async () =>
    root.render(createElement(Sidebar, { ...props, chatStatus: words })),
  );
  await act(async () =>
    root.render(
      createElement(Sidebar, {
        ...props,
        chatStatus: { ...words, work: "review" },
      }),
    ),
  );
  expect(pill("work")?.textContent).toBe("Review");
});
