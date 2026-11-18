// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { HOVER_CARD_OPEN_MS } from "./HoverCard";

const mocks = vi.hoisted(() => ({
  prStatus: vi.fn(),
  worktrees: vi.fn(),
  index: vi.fn(),
}));
vi.mock("../lib/fs", () => ({
  gitPrStatus: mocks.prStatus,
  gitWorktrees: mocks.worktrees,
  gitDiffIndex: mocks.index,
  notifyGitChanged: vi.fn(),
}));
vi.mock("../lib/prChecks", async (actual) => ({
  ...(await actual<typeof import("../lib/prChecks")>()),
  gitPrChecks: vi.fn(async () => ({ checks: [] })),
}));
vi.mock("./AgentMark", () => ({ AgentMark: () => null }));
// The real card is a positioned Popover; the content is what matters here.
vi.mock("./HoverCard", async (actual) => ({
  ...(await actual<typeof import("./HoverCard")>()),
  HoverCard: ({
    state,
    children,
  }: {
    state: { open: boolean };
    children: unknown;
  }) =>
    state.open
      ? createElement("div", { "data-card": "" }, children as never)
      : null,
}));

import { SidebarChatPeek, type ChatPeekRow } from "./HoverPeeks";

const row: ChatPeekRow = {
  id: "c1",
  title: "Rate card for new clients",
  harness: "claude",
  cwd: "/p",
  branch: "feat/rate-card",
  updatedAt: Date.now() - 3 * 3_600_000,
};

describe("the sidebar's chat card", () => {
  let root: Root;
  let host: HTMLDivElement;
  const list = createRef<HTMLDivElement>();

  const render = (disabled = false) =>
    act(() =>
      root.render(
        createElement(
          "div",
          { ref: list },
          createElement(
            "button",
            { "data-chat-peek": "c1" },
            createElement("span", { className: "inner" }, "Rate card"),
          ),
          createElement("button", { "data-chat-peek": "c2" }, "Other"),
          createElement(SidebarChatPeek, {
            container: list,
            disabled,
            find: (id: string) => (id === "c1" ? row : undefined),
            busy: new Set<string>(),
            needsYou: () => false,
          }),
        ),
      ),
    );
  const point = (target: Element, type: string, buttons = 0) =>
    act(() => {
      const event = new Event(type, { bubbles: true }) as PointerEvent;
      Object.assign(event, { pointerType: "mouse", buttons });
      target.dispatchEvent(event);
    });

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    mocks.worktrees.mockResolvedValue([
      { path: "/copies/rate", branch: "feat/rate-card" },
    ]);
    mocks.index.mockResolvedValue({
      branch: "feat/rate-card",
      defaultBranch: "main",
    });
    mocks.prStatus.mockResolvedValue({
      number: 212,
      title: "",
      url: "",
      state: "open",
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("opens after resting on a row and reads the pull request only then", async () => {
    render();
    expect(mocks.prStatus).not.toHaveBeenCalled();
    point(host.querySelector(".inner")!, "pointerover");
    act(() => vi.advanceTimersByTime(HOVER_CARD_OPEN_MS));
    const card = host.querySelector("[data-card]");
    expect(card?.textContent).toContain("Rate card for new clients");
    expect(card?.textContent).toContain("feat/rate-card");
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mocks.prStatus).toHaveBeenCalledWith("/copies/rate");
    expect(host.querySelector("[data-card]")?.textContent).toContain("#212");
    expect(host.querySelector("[data-card]")?.textContent).toContain(
      "Ready to merge",
    );
  });

  it("steps aside when the row is pressed", () => {
    render();
    const button = host.querySelector('[data-chat-peek="c1"]')!;
    point(button, "pointerover");
    act(() => vi.advanceTimersByTime(HOVER_CARD_OPEN_MS));
    expect(host.querySelector("[data-card]")).not.toBeNull();
    point(button, "pointerdown", 1);
    expect(host.querySelector("[data-card]")).toBeNull();
  });

  it("does not open during a drag or while disabled", () => {
    render();
    point(host.querySelector('[data-chat-peek="c1"]')!, "pointerover", 1);
    act(() => vi.advanceTimersByTime(HOVER_CARD_OPEN_MS * 2));
    expect(host.querySelector("[data-card]")).toBeNull();
    render(true);
    point(host.querySelector('[data-chat-peek="c2"]')!, "pointerover");
    act(() => vi.advanceTimersByTime(HOVER_CARD_OPEN_MS * 2));
    expect(host.querySelector("[data-card]")).toBeNull();
  });
});

describe("where the cards are wired", () => {
  const source = (path: string) =>
    readFileSync(new URL(path, import.meta.url), "utf8");

  it("marks every chat row renderer in the sidebar", () => {
    const sidebar = source("./Sidebar.tsx");
    expect(sidebar.match(/data-chat-peek=\{session\.id\}/g)).toHaveLength(4);
    expect(sidebar).toMatch(
      /<SidebarChatPeek[\s\S]*?disabled=\{floating \|\| !sidebarVisible \|\| settingsOpen\}/,
    );
  });

  it("keeps Activity's click and peeks only while its panel is shut", () => {
    const bar = source("./WorkspaceStatusBar.tsx");
    expect(bar).toContain("useHoverCard({ disabled: menu !== null })");
    expect(bar).toContain(
      'onClick={() => setMenu(menu === "queue" ? null : "queue")}',
    );
  });
});
