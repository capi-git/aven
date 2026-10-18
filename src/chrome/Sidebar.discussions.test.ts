// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SidebarDiscussion } from "../lib/discussions";
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

const cwd = "/tmp/sidebar-discussions";
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

/** Layout for happy-dom: each talking row's top, and the link layer's. */
const ROW_TOP: Record<string, number> = {
  a: 100,
  b: 160,
  c: 220,
  loose: 20,
};
const LAYER_TOP = 40;
const ROW_HEIGHT = 30;

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 200,
    width: 200,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
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
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const element = this as HTMLElement;
      if (element.classList.contains("discussion-links"))
        return rect(LAYER_TOP, 0);
      const row = element.dataset.discussionRow;
      return row ? rect(ROW_TOP[row] ?? 0, ROW_HEIGHT) : rect(0, 0);
    },
  );
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
    this: Element,
  ) {
    return [rect(0, 1)] as unknown as DOMRectList;
  });
  props = {
    cwd,
    open: true,
    sessions: [summary("a", 3), summary("b", 2), summary("c", 1)],
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(discussions: SidebarDiscussion[]) {
  await act(async () =>
    root.render(createElement(Sidebar, { ...props, discussions })),
  );
}
const talking = (
  a: string,
  b: string,
  speaking: "a" | "b",
  paused = false,
): SidebarDiscussion => ({
  id: `${a}-${b}`,
  a: { sessionId: a, title: `Chat ${a}` },
  b: { sessionId: b, title: b === "elsewhere" ? "Elsewhere" : `Chat ${b}` },
  speaking,
  paused,
});
const link = () => container.querySelector<HTMLElement>(".discussion-link");
const marks = () => [
  ...container.querySelectorAll<HTMLElement>(".discussion-talk-mark"),
];

describe("Sidebar discussions", () => {
  it("links two visible rows with a pulse toward the one answering", async () => {
    await render([talking("a", "b", "b")]);
    const connector = link()!;
    expect(connector).not.toBeNull();
    // Row centres 115 and 175, measured from the layer at 40.
    expect(connector.style.top).toBe("75px");
    expect(connector.style.height).toBe("60px");
    expect(connector.dataset.toward).toBe("down");
    expect(connector.querySelector(".discussion-link-pulse")).not.toBeNull();
    expect(marks()).toHaveLength(2);
    expect(marks().every((mark) => mark.dataset.talking === "true")).toBe(true);
    expect(
      marks().filter((mark) => mark.dataset.speaking === "true"),
    ).toHaveLength(1);
    expect(container.querySelector(".discussion-talk-badge")).toBeNull();
  });

  it("sends the pulse up when the upper chat answers", async () => {
    await render([talking("a", "c", "a")]);
    expect(link()!.dataset.toward).toBe("up");
    expect(link()!.style.height).toBe("120px");
  });

  it("shows a badge instead when the partner row is not on screen", async () => {
    await render([talking("a", "elsewhere", "b")]);
    expect(link()).toBeNull();
    const badge = container.querySelector(".discussion-talk-badge");
    expect(badge?.textContent).toBe("Discussing with “Elsewhere”");
    expect(
      badge
        ?.closest("[data-discussion-row]")
        ?.getAttribute("data-discussion-row"),
    ).toBe("a");
  });

  it("keeps a still, dashed link while paused", async () => {
    await render([talking("a", "b", "a", true)]);
    expect(link()!.dataset.paused).toBe("true");
    expect(link()!.querySelector(".discussion-link-pulse")).toBeNull();
    expect(marks().some((mark) => mark.dataset.talking)).toBe(false);
  });

  it("links a plain row in the Sessions group to a project row", async () => {
    props.onOpenStandalone = vi.fn();
    props.standaloneSessions = [
      { ...summary("loose", 4), cwd: "/tmp/aven-sessions" },
    ];
    await render([talking("loose", "b", "a")]);
    const row = container.querySelector<HTMLElement>(
      '.personal-other-task[data-discussion-row="loose"]',
    );
    expect(row?.querySelector(".discussion-talk-mark")).not.toBeNull();
    expect(row?.querySelector(".personal-task-indent")).toBeNull();
    expect(link()!.dataset.toward).toBe("up");
    expect(link()!.style.top).toBe("-5px");
  });

  it("opens the discussion's page when its connector is pressed", async () => {
    // Without a handler the connector is only a picture.
    await render([talking("a", "b", "b")]);
    expect(link()!.tagName).toBe("SPAN");
    expect(
      container.querySelector(".discussion-links")?.getAttribute("aria-hidden"),
    ).toBe("true");
    props.onOpenDiscussion = vi.fn();
    await render([talking("a", "b", "b")]);
    const connector = link()!;
    expect(connector.tagName).toBe("BUTTON");
    expect(connector.getAttribute("aria-label")).toBe(
      "Open the discussion between “Chat a” and “Chat b”",
    );
    expect(
      container.querySelector(".discussion-links")?.hasAttribute("aria-hidden"),
    ).toBe(false);
    await act(async () => connector.click());
    expect(props.onOpenDiscussion).toHaveBeenCalledExactlyOnceWith("a-b");
  });

  it("draws nothing without a discussion", async () => {
    await render([]);
    expect(container.querySelector(".discussion-links")).toBeNull();
    expect(container.querySelector("[data-discussion-row]")).toBeNull();
  });
});
