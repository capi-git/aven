// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatSessionTitle } from "../lib/session";
import { Sidebar } from "./Sidebar";

// Keep native services out of these menu tests.
vi.mock("../hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
}));
vi.mock("../hooks/useGitFileStatuses", () => ({
  useGitFileStatuses: () => ({ files: new Map(), dirs: new Map() }),
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("./FileTree", () => ({ FileTree: () => null }));

let container: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof Sidebar>;

const chat = (id: string, title: string, at: number) => ({
  id,
  cwd: "/workspace/project",
  harness: "codex" as const,
  model: "",
  runtimeMode: "supervised" as const,
  title: formatSessionTitle("codex", title),
  createdAt: at,
  updatedAt: at,
});

function openMenu(sessionId: string) {
  act(() => {
    container
      .querySelector(`[data-session-card="${sessionId}"]`)!
      .dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
  });
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  return (label: string) =>
    [...(menu?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (item) => item.textContent?.includes(label),
    );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  const now = Date.now();
  props = {
    cwd: "/workspace/project",
    open: true,
    sessions: [chat("one", "Fix sign-in", now), chat("two", "Docs", now - 1)],
    busySessionIds: new Set(),
    approvalSessionIds: new Set(),
    activeSessionId: "one",
    status: "idle",
    pending: false,
    tab: "sessions",
    filesSearchOpen: false,
    onSelectSession: vi.fn(),
    onOpenFile: vi.fn(),
    onTabChange: vi.fn(),
    onFilesSearchOpenChange: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Add to board in a chat's menu", () => {
  it("puts the right-clicked chat on its project's board", () => {
    const onAddToBoard = vi.fn();
    props = { ...props, onAddToBoard };
    act(() => root.render(createElement(Sidebar, props)));
    const item = openMenu("two")("Add to board");
    expect(item).toBeDefined();
    act(() => item!.click());
    expect(onAddToBoard).toHaveBeenCalledExactlyOnceWith(["two"]);
  });

  it("is not offered where there is no board to add to", () => {
    act(() => root.render(createElement(Sidebar, props)));
    expect(openMenu("one")("Add to board")).toBeUndefined();
  });
});
