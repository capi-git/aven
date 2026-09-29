// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedWorkspace } from "./DetachedWorkspace";
import { nativeWorkspaceWindow } from "../lib/detachedWorkspaces";
import { leaf, newTab } from "../lib/layout";
import { installInAppLinks } from "../lib/inAppLinks";

vi.mock("./BrowserPane", () => ({
  BrowserPane: ({ id, visible }: { id: string; visible: boolean }) =>
    createElement("div", {
      "data-test-browser": id,
      "data-presented": String(visible),
    }),
}));
vi.mock("./SessionPane", () => ({ SessionPane: () => null }));
vi.mock("./FilePane", () => ({ FilePane: () => null }));
vi.mock("../chrome/WindowControls", () => ({ WindowControls: () => null }));
vi.mock("../lib/inAppLinks", () => ({
  installInAppLinks: vi.fn(() => () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: async () => () => {},
    isFocused: async () => true,
  }),
}));

let root: Root;
let host: HTMLDivElement;
let listeners: Map<string, (value: any) => void>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  listeners = new Map();
  vi.spyOn(nativeWorkspaceWindow, "listen").mockImplementation(
    async (name, callback) => {
      listeners.set(name, callback);
      return () => {
        listeners.delete(name);
      };
    },
  );
  vi.spyOn(nativeWorkspaceWindow, "getState").mockResolvedValue({
    id: "workspace-test",
    pinned: false,
    state: {
      cwd: "/project",
      title: "Group",
      tabs: [],
      sessions: [],
      transferToken: "test-transfer",
      browsers: [
        {
          id: "selected",
          tabId: "selected",
          title: "Old preview",
          url: "https://old.test",
        },
        {
          id: "history",
          tabId: "history",
          title: "Hidden history",
          url: "https://history.test",
        },
      ],
      view: {
        layout: leaf("selected"),
        focusedId: "selected",
        order: ["selected", "history"],
        groups: { selected: ["selected", "history"] },
      },
    },
  });
  for (const name of ["ready", "checkpoint", "ack", "visibility"] as const)
    vi.spyOn(nativeWorkspaceWindow, name).mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tabIds = () =>
  [...host.querySelectorAll<HTMLElement>("[data-surface-tab-id]")].map(
    (tab) => tab.dataset.surfaceTabId!,
  );

it.each(["button", "link", "agent"] as const)(
  "keeps distinct adjacent browser tabs through the %s entrypoint",
  async (route) => {
    await act(async () => root.render(createElement(DetachedWorkspace)));
    expect(tabIds()).toEqual(["selected"]);
    const open = async (index: number) =>
      act(async () => {
        if (route === "button") {
          host
            .querySelector<HTMLButtonElement>('[title="New browser tab"]')!
            .click();
        } else if (route === "link") {
          const links = vi.mocked(installInAppLinks).mock.calls.at(-1)![0];
          await links.openUrl(`https://page-${index}.test`);
        } else {
          listeners.get("workspace-window-focus")!({
            sessionId: "task",
            browser: {
              id: `agent-${index}`,
              tabId: `agent-${index}`,
              url: `https://page-${index}.test`,
            },
          });
        }
      });
    await open(1);
    const first = tabIds();
    expect(first).toHaveLength(2);
    expect(first[0]).toBe("selected");
    await open(2);
    const second = tabIds();
    expect(second).toHaveLength(3);
    expect(second.slice(0, 2)).toEqual(first);
    expect(new Set(second).size).toBe(3);
    expect(second).not.toContain("history");
    expect(
      host.querySelectorAll('[data-test-browser][data-presented="true"]'),
    ).toHaveLength(1);

    // Selecting an older tab retains every label and shows only that native pane.
    await act(async () =>
      host
        .querySelector<HTMLElement>('[data-surface-tab-id="selected"]')!
        .click(),
    );
    expect(tabIds()).toEqual(second);
    expect(
      host
        .querySelector('[data-test-browser="selected"]')
        ?.getAttribute("data-presented"),
    ).toBe("true");
    expect(
      host.querySelectorAll('[data-test-browser][data-presented="true"]'),
    ).toHaveLength(1);

    await act(async () => vi.advanceTimersByTime(150));
    const saved = vi
      .mocked(nativeWorkspaceWindow.checkpoint)
      .mock.calls.at(-1)![0];
    expect(
      saved.browsers
        .filter((browser) => browser.kept)
        .map((browser) => browser.id),
    ).toEqual(second);
    expect(
      saved.browsers.find((browser) => browser.id === "history")?.kept,
    ).toBeUndefined();
    expect(Object.keys(saved.view.groups)).toHaveLength(1);

    // URL opens still focus an existing tab; a second blank-button open creates one.
    if (route !== "button") {
      await open(1);
      expect(tabIds()).toEqual(second);
      expect(
        host.querySelectorAll('[data-test-browser][data-presented="true"]'),
      ).toHaveLength(1);
    }
  },
);

it("preserves the pane's previous browser preview when its conversation has focus", async () => {
  const initial = await nativeWorkspaceWindow.getState();
  const task = newTab("task");
  initial.state.tabs = [task];
  initial.state.view.order.push(task.id);
  initial.state.view.groups.selected.push(task.id);
  await act(async () => root.render(createElement(DetachedWorkspace)));
  await act(async () =>
    host
      .querySelector<HTMLElement>(`[data-surface-tab-id="${task.id}"] button`)!
      .click(),
  );
  expect(tabIds()).toContain("selected");
  await act(async () =>
    listeners.get("workspace-window-focus")!({
      sessionId: "task",
      browser: { id: "agent-new", tabId: "new", url: "https://new.test" },
    }),
  );
  expect(tabIds()).toEqual(["selected", task.id, "agent-new"]);
  expect(tabIds()).not.toContain("history");
  await act(async () => vi.advanceTimersByTime(150));
  const saved = vi
    .mocked(nativeWorkspaceWindow.checkpoint)
    .mock.calls.at(-1)![0];
  expect(
    saved.browsers.find((browser) => browser.id === "selected")?.kept,
  ).toBe(true);
});
