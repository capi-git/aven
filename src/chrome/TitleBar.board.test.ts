// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TitleBar, tabCopy, type Tab } from "./TitleBar";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setFocus: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/app", () => ({
  getName: vi.fn().mockResolvedValue("Aven"),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setFocus: vi.fn().mockResolvedValue(undefined),
    setTitle: vi.fn().mockResolvedValue(undefined),
    startDragging: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("./WindowControls", () => ({ WindowControls: () => null }));

const board: Tab = {
  id: "board",
  project: "site",
  projectPath: "/work/site",
  title: "",
  more: [],
  sessionCount: 0,
  harnesses: [],
  busyHarnesses: [],
  files: ["Board"],
  board: true,
};

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof TitleBar>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    tabs: [
      {
        ...board,
        id: "chat",
        title: "Fix sign-in",
        sessionCount: 1,
        harnesses: ["claude"],
        files: [],
        board: false,
      },
      board,
    ],
    activeId: "board",
    cwd: "/work/site",
    paneLocal: true,
    onToggleSidebar: vi.fn(),
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onClose: vi.fn(),
    onCloseMany: vi.fn(),
    onReorder: vi.fn(),
    onNewBrowser: vi.fn(),
    onOpenBoard: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("the title bar's board", () => {
  it("offers Open board beside the new browser tab globe", async () => {
    await act(async () => root.render(createElement(TitleBar, props)));
    const globe = container.querySelector(".personal-title-browser-new");
    const open = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open board"]',
    )!;
    expect(globe?.nextElementSibling).toBe(open);
    await act(async () => open.click());
    expect(props.onOpenBoard).toHaveBeenCalledOnce();
  });

  it("leaves the button out where no board can open", async () => {
    await act(async () =>
      root.render(
        createElement(TitleBar, { ...props, onOpenBoard: undefined }),
      ),
    );
    expect(
      container.querySelector('button[aria-label="Open board"]'),
    ).toBeNull();
  });

  it("names a board tab Board with the board's mark", async () => {
    expect(tabCopy(board).headline).toBe("Board");
    await act(async () => root.render(createElement(TitleBar, props)));
    const tab = container.querySelector('[data-surface-tab-id="board"]')!;
    expect(tab.querySelector(".personal-title-tab-board")).not.toBeNull();
    expect(tab.textContent).toContain("Board");
  });
});
