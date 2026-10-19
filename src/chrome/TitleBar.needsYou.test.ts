// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TitleBar, tabCopy, type Tab } from "./TitleBar";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setFocus: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("@tauri-apps/api/app", () => ({
  getName: vi.fn().mockResolvedValue("Aven"),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setTitle: vi.fn().mockResolvedValue(undefined),
    startDragging: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("./WindowControls", () => ({ WindowControls: () => null }));

function stubStorage() {
  // Some Node versions give tests a working localStorage and some do not.
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
}

function tab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: "t1",
    project: "agent-terminal",
    title: "Fix login",
    more: [],
    sessionCount: 1,
    harnesses: ["claude"],
    busyHarnesses: [],
    files: [],
    ...overrides,
  };
}

describe("a tab that waits on you", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    stubStorage();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(tabs: Tab[]) {
    const props: ComponentProps<typeof TitleBar> = {
      tabs,
      activeId: tabs[0].id,
      cwd: "/projects/demo",
      onToggleSidebar: vi.fn(),
      onSelect: vi.fn(),
      onNew: vi.fn(),
      onClose: vi.fn(),
      onCloseMany: vi.fn(),
      onReorder: vi.fn(),
    };
    await act(async () => root.render(createElement(TitleBar, props)));
  }

  const dot = (id: string) =>
    container.querySelector(
      `[data-surface-tab-id="${id}"] [data-tab-needs-you]`,
    );

  it("marks the tab amber and says so in its tooltip", async () => {
    await render([
      tab({ id: "asks", needsInput: true }),
      tab({ id: "works", title: "Refactor", busyHarnesses: ["claude"] }),
    ]);
    expect(dot("asks")).not.toBeNull();
    expect(dot("works")).toBeNull();
    expect(
      container
        .querySelector('[data-surface-tab-id="asks"] [role="tab"]')
        ?.getAttribute("aria-label"),
    ).toContain("Needs you");
  });

  it("names what holds a working tab up in its tooltip, after Needs you", () => {
    expect(
      tabCopy(tab({ waitingOn: "Waiting on 3 helper agents" })).tooltip,
    ).toBe("agent-terminal · Fix login · Waiting on 3 helper agents");
    expect(
      tabCopy(
        tab({ needsInput: true, waitingOn: "Waiting on 3 helper agents" }),
      ).tooltip,
    ).toBe("agent-terminal · Fix login · Needs you");
  });
});
