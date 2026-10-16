// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encodeSidebarValue } from "../lib/floatingSidebar";
import type { SessionSummary } from "../lib/sessionStore";
import type { WorkConflictMap } from "../lib/workConflicts";
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

const cwd = "/tmp/sidebar-conflicts";
function summary(id: string, updatedAt: number): SessionSummary {
  return {
    id,
    cwd,
    harness: id === "b" ? "claude" : "codex",
    model: "gpt-5",
    runtimeMode: "supervised",
    title: `Chat ${id}`,
    createdAt: 1,
    updatedAt,
    additions: 0,
    deletions: 0,
  };
}

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
    sessions: [summary("a", 3), summary("b", 2), summary("c", 1)],
    busySessionIds: new Set(["a", "b"]),
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

const conflicts: WorkConflictMap = {
  a: { kind: "files", label: "Claude is also editing src/App.tsx" },
  b: { kind: "files", label: "Codex is also editing src/App.tsx" },
};

function mark(id: string) {
  return container.querySelector<HTMLElement>(
    `[data-session-card="${id}"] [data-work-conflict]`,
  );
}

it("marks both chats' rows while they edit the same file", async () => {
  await act(async () => root.render(createElement(Sidebar, props)));
  expect(mark("a")).toBeNull();
  await act(async () =>
    root.render(createElement(Sidebar, { ...props, workConflicts: conflicts })),
  );
  expect(mark("a")?.getAttribute("aria-label")).toBe(
    "Claude is also editing src/App.tsx",
  );
  expect(mark("b")?.title).toBe("Codex is also editing src/App.tsx");
  expect(mark("c")).toBeNull();
  await act(async () =>
    root.render(createElement(Sidebar, { ...props, workConflicts: {} })),
  );
  expect(mark("a")).toBeNull();
});

it("travels to the floating sidebar unchanged", () => {
  expect(encodeSidebarValue(conflicts)).toEqual(conflicts);
});
