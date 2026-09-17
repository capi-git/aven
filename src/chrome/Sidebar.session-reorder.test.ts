// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExternalPaneDrop } from "../lib/paneDrop";
import {
  loadSessionFolders,
  saveSessionFolders,
  type SessionFolder,
} from "../lib/sessionFolders";
import type { SessionSummary } from "../lib/sessionStore";
import { Sidebar, type SidebarProps } from "./Sidebar";

// Keep this mounted-sidebar test focused on its real session cards and drag
// handlers, without mounting unrelated native menus or update polling.
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

const cwd = "/tmp/sidebar-session-reorder";
function summary(id: string, updatedAt: number): SessionSummary {
  return {
    id,
    cwd,
    harness: "codex",
    model: "gpt-5",
    runtimeMode: "supervised",
    title: id,
    createdAt: 1,
    updatedAt,
    additions: 0,
    deletions: 0,
  };
}
function folder(id: string, sessionIds: string[]): SessionFolder {
  return { id, name: id, sessionIds, collapsed: false };
}

describe("Sidebar folder session dragging", () => {
  let container: HTMLDivElement;
  let root: Root;
  let props: SidebarProps;
  let hit: Element | null;
  let now: number;

  beforeEach(() => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
      clear: () => stored.clear(),
    });
    localStorage.clear();
    now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(document, "elementFromPoint").mockImplementation(() => hit);
    hit = null;
    saveSessionFolders(cwd, [folder("work", ["c", "a", "b"])]);
    props = {
      cwd,
      open: true,
      sessions: [summary("a", 3), summary("b", 2), summary("c", 1)],
      busySessionIds: new Set(),
      approvalSessionIds: new Set(),
      activeSessionId: "a",
      status: "idle",
      pending: false,
      onSelectSession: vi.fn(),
      onSessionNavigationOrder: vi.fn(),
      onPlaceSessionOnPane: vi.fn(),
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
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => root.render(createElement(Sidebar, props)));
  }
  function card(id: string) {
    const element = container.querySelector<HTMLButtonElement>(
      `[data-session-card="${id}"]`,
    );
    if (!element) throw new Error(`Missing session ${id}`);
    element.setPointerCapture = vi.fn();
    element.releasePointerCapture = vi.fn();
    element.getBoundingClientRect = () => new DOMRect(10, 100, 200, 40);
    return element;
  }
  function order(folderId = "work") {
    return [
      ...container.querySelectorAll<HTMLElement>(
        `[data-session-folder="${folderId}"] [data-session-card]`,
      ),
    ].map((element) => element.dataset.sessionCard);
  }
  async function pointer(target: EventTarget, type: string, y: number) {
    await act(async () =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerId: 1,
          clientX: 30,
          clientY: y,
        }),
      ),
    );
  }
  async function start(from = "c", to = "a", y = 105) {
    await render();
    const source = card(from);
    await pointer(source, "pointerdown", 200);
    hit = card(to);
    await pointer(window, "pointermove", y);
    return source;
  }
  async function click(target: HTMLElement, shiftKey = false) {
    await act(async () =>
      target.dispatchEvent(
        new MouseEvent("click", { bubbles: true, shiftKey }),
      ),
    );
  }

  it("shows an insertion line, preserves selection, and restores the dragged order after reopening", async () => {
    await render();
    expect(order()).toEqual(["a", "b", "c"]);
    await click(card("a"), true);
    const source = await start();
    expect(
      card("a").querySelector('[data-session-insert="before"]'),
    ).not.toBeNull();
    await pointer(window, "pointerup", 105);
    expect(order()).toEqual(["c", "a", "b"]);
    expect(loadSessionFolders(cwd)[0]).toMatchObject({
      sessionIds: ["c", "a", "b"],
      manualOrder: true,
    });
    expect(card("a").getAttribute("aria-current")).toBe("true");
    expect(card("a").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("[data-session-insert]")).toBeNull();
    await click(source);
    expect(props.onSelectSession).not.toHaveBeenCalled();
    expect(props.onPlaceSessionOnPane).not.toHaveBeenCalled();
    expect(props.onSessionNavigationOrder).toHaveBeenLastCalledWith([
      "c",
      "a",
      "b",
    ]);
    await act(async () => root.unmount());
    root = createRoot(container);
    props = {
      ...props,
      sessions: [summary("a", 100), summary("b", 200), summary("c", 1)],
    };
    await render();
    expect(order()).toEqual(["c", "a", "b"]);
  });

  it("updates the insertion edge over the same row and commits the release position", async () => {
    await start();
    await pointer(window, "pointermove", 135);
    expect(
      card("a").querySelector('[data-session-insert="after"]'),
    ).not.toBeNull();
    // Pointerup can arrive at a new position before the last pointermove.
    await pointer(window, "pointerup", 105);
    expect(order()).toEqual(["c", "a", "b"]);
  });

  it("can place a session after its sibling", async () => {
    await start("a", "c", 135);
    await pointer(window, "pointerup", 135);
    expect(order()).toEqual(["b", "c", "a"]);
  });

  it.each(["Escape", "pointercancel", "lostpointercapture", "blur", "unmount"])(
    "cancels an interrupted drag on %s without changing saved order or opening a pane",
    async (reason) => {
      const source = await start();
      if (reason === "Escape") {
        await act(async () =>
          window.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          ),
        );
      } else if (reason === "blur") {
        await act(async () => window.dispatchEvent(new Event("blur")));
      } else if (reason === "unmount") {
        await act(async () => root.unmount());
        root = createRoot(container);
      } else {
        await pointer(
          reason === "lostpointercapture" ? source : window,
          reason,
          105,
        );
      }
      await pointer(window, "pointerup", 105);
      expect(loadSessionFolders(cwd)[0]).toMatchObject({
        sessionIds: ["c", "a", "b"],
      });
      expect(loadSessionFolders(cwd)[0]?.manualOrder).toBeUndefined();
      expect(props.onPlaceSessionOnPane).not.toHaveBeenCalled();
      expect(getExternalPaneDrop()).toBeNull();
      expect(document.documentElement.classList.contains("is-reordering")).toBe(
        false,
      );
      expect(container.querySelector("[data-session-insert]")).toBeNull();
    },
  );

  it("keeps cross-folder drops as moves into that folder", async () => {
    saveSessionFolders(cwd, [
      folder("work", ["a", "b", "c"]),
      folder("other", ["z"]),
    ]);
    props = { ...props, sessions: [...props.sessions, summary("z", 10)] };
    await start("c", "z");
    expect(container.querySelector("[data-session-insert]")).toBeNull();
    await pointer(window, "pointerup", 105);
    expect(loadSessionFolders(cwd).map((entry) => entry.sessionIds)).toEqual([
      ["a", "b"],
      ["z", "c"],
    ]);
    expect(props.onSelectSession).not.toHaveBeenCalled();
  });

  it("still groups ungrouped session cards on a drop", async () => {
    props = {
      ...props,
      sessions: [
        ...props.sessions,
        summary("loose-a", 5),
        summary("loose-b", 4),
      ],
    };
    await start("loose-a", "loose-b");
    expect(card("loose-b").querySelector("[data-session-insert]")).toBeNull();
    await pointer(window, "pointerup", 105);
    const created = loadSessionFolders(cwd).find(
      (entry) => entry.id !== "work",
    );
    expect(created?.sessionIds).toEqual(["loose-a", "loose-b"]);
    expect(props.onSelectSession).not.toHaveBeenCalled();
  });

  it("still reorders whole folders from their headers without reordering their sessions", async () => {
    saveSessionFolders(cwd, [
      folder("work", ["a", "b", "c"]),
      folder("other", ["z"]),
    ]);
    props = { ...props, sessions: [...props.sessions, summary("z", 10)] };
    await render();
    const folders = [
      ...container.querySelectorAll<HTMLElement>("[data-session-folder]"),
    ];
    folders.forEach((element, index) => {
      element.getBoundingClientRect = () =>
        new DOMRect(0, 100 + index * 100, 240, 100);
    });
    const handle = container.querySelector<HTMLButtonElement>(
      'button[title="other"]',
    )!;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    await pointer(handle, "pointerdown", 220);
    await pointer(window, "pointermove", 105);
    await pointer(window, "pointerup", 105);
    expect(loadSessionFolders(cwd).map((entry) => entry.id)).toEqual([
      "other",
      "work",
    ]);
    expect(
      loadSessionFolders(cwd).find((entry) => entry.id === "work")?.sessionIds,
    ).toEqual(["a", "b", "c"]);
    expect(loadSessionFolders(cwd).every((entry) => !entry.manualOrder)).toBe(
      true,
    );
  });

  it("still opens a normal click and still supports dragging a card into a pane", async () => {
    await render();
    const source = card("c");
    await click(source);
    expect(props.onSelectSession).toHaveBeenCalledExactlyOnceWith("c");
    await pointer(source, "pointerdown", 200);
    const pane = document.createElement("div");
    pane.dataset.paneId = "destination";
    pane.getBoundingClientRect = () => new DOMRect(0, 0, 400, 400);
    hit = pane;
    await pointer(window, "pointermove", 105);
    await pointer(window, "pointerup", 105);
    expect(props.onPlaceSessionOnPane).toHaveBeenCalledExactlyOnceWith(
      "c",
      "destination",
      "left",
    );
    expect(loadSessionFolders(cwd)[0]?.manualOrder).toBeUndefined();
  });
});
