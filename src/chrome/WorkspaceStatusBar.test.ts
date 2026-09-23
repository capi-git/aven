// @vitest-environment happy-dom
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../lib/session";
import { getActivitySnapshot, recordActivity } from "../lib/activity";
import type { ProviderRateLimits } from "../lib/rateLimits";
import {
  WorkspaceStatusBar,
  WorkspaceNavigation,
  reportedCostLabel,
  workspaceQueueSummary,
  type WorkspaceStatusBarProps,
} from "./WorkspaceStatusBar";

vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  IS_MAC: true,
}));

const nativeMenu = vi.hoisted(() => ({
  supported: vi.fn(() => false),
  show: vi.fn(),
}));
vi.mock("../lib/workspaceNativeMenu", () => ({
  supportsWorkspaceNativeMenu: nativeMenu.supported,
  showWorkspaceNativeMenu: nativeMenu.show,
}));
const nativePanel = vi.hoisted(() => ({
  open: vi.fn(),
  update: vi.fn(),
  close: vi.fn(),
  callbacks: new Map<string, (value: unknown) => void>(),
}));
vi.mock("../lib/usagePanel", () => ({
  useUsagePanelTheme: () => ({ mode: "dark", accent: "#5ed9d0" }),
  nativeUsagePanel: {
    open: nativePanel.open,
    update: nativePanel.update,
    close: nativePanel.close,
    listen: vi.fn(async (name: string, callback: (value: unknown) => void) => {
      nativePanel.callbacks.set(name, callback);
      return () => {
        if (nativePanel.callbacks.get(name) === callback)
          nativePanel.callbacks.delete(name);
      };
    }),
  },
}));
const openPanel = vi.hoisted(() => ({
  open: vi.fn(),
  update: vi.fn(),
  close: vi.fn(),
  callbacks: new Map<string, (value: unknown) => void>(),
}));
vi.mock("../lib/workspaceMenuPanel", () => ({
  nativeWorkspaceMenuPanel: {
    ...openPanel,
    listen: vi.fn(async (name: string, callback: (value: unknown) => void) => {
      openPanel.callbacks.set(name, callback);
      return () => {
        if (openPanel.callbacks.get(name) === callback)
          openPanel.callbacks.delete(name);
      };
    }),
  },
}));
const api = vi.hoisted(() => ({ claude: vi.fn(), codex: vi.fn() }));
const nativeWindow = vi.hoisted(() => ({
  startDragging: vi.fn().mockResolvedValue(undefined),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => nativeWindow,
}));
vi.mock("../lib/rateLimitsFetch", () => ({
  fetchClaudeRateLimits: api.claude,
  fetchCodexRateLimits: api.codex,
}));
vi.mock("./Popover", () => ({
  Popover: ({
    children,
    role,
    onKeyDown,
    tabIndex,
    ...props
  }: ComponentProps<"div"> & Record<string, unknown>) =>
    createElement(
      "div",
      { role, onKeyDown, tabIndex, "aria-label": props["aria-label"] },
      children,
    ),
}));

const task = (patch: Partial<Session> = {}): Session => ({
  id: "task-1",
  harness: "codex",
  model: "model",
  modelSettings: {},
  runtimeMode: "supervised",
  title: "First task",
  cwd: "/project",
  blocks: [],
  ...patch,
});
let root: Root;
let container: HTMLDivElement;
let props: WorkspaceStatusBarProps;
beforeEach(() => {
  vi.clearAllMocks();
  nativeMenu.supported.mockReturnValue(false);
  nativeMenu.show.mockResolvedValue(null);
  nativePanel.open.mockResolvedValue("usage-panel-test");
  nativePanel.update.mockResolvedValue(undefined);
  nativePanel.close.mockResolvedValue(undefined);
  nativePanel.callbacks.clear();
  openPanel.open.mockResolvedValue({
    label: "workspace-menu-panel-test",
    presentation: "open-1",
  });
  openPanel.update.mockResolvedValue({
    label: "workspace-menu-panel-test",
    presentation: "open-1",
  });
  openPanel.close.mockResolvedValue(undefined);
  openPanel.callbacks.clear();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  getActivitySnapshot();
  nativeWindow.startDragging.mockResolvedValue(undefined);
  nativeWindow.toggleMaximize.mockResolvedValue(undefined);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  props = {
    sessions: [],
    accessMode: "supervised",
    onAccessModeChange: vi.fn(),
    onSelectSession: vi.fn().mockResolvedValue(true),
  };
  api.codex.mockImplementation(async (): Promise<ProviderRateLimits> => ({
    provider: "codex",
    session: { usedPercent: 23, windowMinutes: 300, resetsAt: null },
    weekly: null,
    updatedAt: Date.now(),
    error: null,
    status: "ok",
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(patch: Partial<WorkspaceStatusBarProps> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(createElement(WorkspaceStatusBar, props)));
}
function button(label: string) {
  const result = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (node) =>
      node.getAttribute("aria-label") === label || node.textContent === label,
  );
  if (!result) throw new Error(`Button missing: ${label}`);
  return result;
}
async function click(label: string) {
  await act(async () => button(label).click());
}

describe("workspace status data and actions", () => {
  it("toggles the file sidebar on click without opening on hover or focus", async () => {
    vi.useFakeTimers();
    function ClickInspector() {
      const [open, setOpen] = useState(false);
      return createElement(
        "div",
        null,
        createElement(WorkspaceStatusBar, {
          ...props,
          inspectorOpen: open,
          onToggleInspector: () => setOpen((value) => !value),
        }),
        createElement(
          "aside",
          { hidden: !open },
          createElement("button", null, "File action"),
        ),
      );
    }
    await act(async () => root.render(createElement(ClickInspector)));
    const trigger = button("Toggle file sidebar");
    const panel = container.querySelector("aside")!;
    const move = async (from: HTMLElement, to: HTMLElement, ms: number) => {
      await act(async () => {
        from.dispatchEvent(
          new PointerEvent("pointerout", {
            bubbles: true,
            pointerType: "mouse",
            relatedTarget: to,
          }),
        );
        to.dispatchEvent(
          new PointerEvent("pointerover", {
            bubbles: true,
            pointerType: "mouse",
            relatedTarget: from,
          }),
        );
        await vi.advanceTimersByTimeAsync(ms);
      });
    };
    expect(trigger.title).toBe("Show file sidebar");
    await move(document.body, trigger, 500);
    expect(panel.hidden).toBe(true);
    expect(trigger.getAttribute("aria-pressed")).toBe("false");
    await act(async () => trigger.focus());
    expect(panel.hidden).toBe(true);
    await click("Toggle file sidebar");
    expect(panel.hidden).toBe(false);
    expect(trigger.title).toBe("Hide file sidebar");
    expect(trigger.getAttribute("aria-pressed")).toBe("true");
    await move(trigger, panel, 200);
    await act(async () => {
      button("File action").dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      button("File action").focus();
    });
    await move(panel, document.body, 100);
    expect(panel.hidden).toBe(false);
    await click("Toggle file sidebar");
    expect(trigger.getAttribute("aria-pressed")).toBe("false");
    await move(document.body, trigger, 500);
    // Returning focus after a close action must not reopen the sidebar.
    await act(async () => trigger.focus());
    expect(panel.hidden).toBe(true);
  });

  it("uses the same active-turn identity for the model label and logo", async () => {
    const current = task({
      harness: "claude",
      model: "claude:next-model",
      busy: true,
      blocks: [
        {
          id: "turn",
          role: "user",
          text: "Work",
          startedAt: 1,
          turnModel: { harness: "codex", model: "codex:running-model" },
        },
      ],
    });
    await render({
      session: current,
      sessions: [current, task({ id: "other", harness: "claude" })],
    });
    const context = () => container.querySelector(".workspace-status-context")!;
    expect(context().textContent).toContain("running-model");
    expect(context().querySelectorAll(".provider-mark")).toHaveLength(1);
    expect(
      context().querySelector(".provider-mark")?.getAttribute("data-provider"),
    ).toBe("codex");
    expect(
      context().querySelector(".provider-mark")?.getAttribute("data-working"),
    ).toBe("true");
    await render({ session: { ...current, busy: false } });
    expect(context().textContent).toContain("next-model");
    expect(
      context().querySelector(".provider-mark")?.getAttribute("data-provider"),
    ).toBe("claude");
    expect(
      context().querySelector(".provider-mark")?.getAttribute("data-working"),
    ).toBe("false");
    await render({ session: undefined });
    expect(context().querySelector(".provider-mark")).toBeNull();
  });

  it("opens Activity from the model name and provider mark without dragging", async () => {
    await render({ session: task() });
    const trigger = button("Activity: Queue is clear");
    const title = trigger.querySelector<HTMLSpanElement>(
      ".workspace-status-context > span:last-child",
    )!;
    const mark = trigger.querySelector<HTMLSpanElement>(".provider-marks")!;
    expect(title.textContent).toBe("model");
    for (const target of [title, mark]) {
      await act(async () => {
        target.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, button: 0 }),
        );
        target.click();
      });
      expect(
        container.querySelector('[role="dialog"][aria-label="Activity"]'),
      ).not.toBeNull();
      await click("Activity: Queue is clear");
    }
    expect(nativeWindow.startDragging).not.toHaveBeenCalled();
  });

  it("hosts workspace tabs between navigation and compact Activity without losing unread status", async () => {
    recordActivity({
      id: "tab-slot-result",
      sessionId: "task-1",
      title: "First task",
      outcome: "completed",
      summary: "Ready for review",
      cwd: "/project",
      harness: "codex",
      model: "model",
    });
    const selectTab = vi.fn();
    await render({
      session: task(),
      onToggleSidebar: vi.fn(),
      workspaceTabs: createElement(
        "div",
        { role: "tablist", "aria-label": "Workspace tabs" },
        createElement(
          "button",
          { type: "button", role: "tab", onClick: selectTab },
          "Current task",
        ),
      ),
    });
    const bar = container.querySelector<HTMLElement>(".workspace-status-bar")!;
    const slot = bar.querySelector(".workspace-status-tabs")!;
    const trigger = button("Activity: Queue is clear · 1 unread");
    const navigation = bar.querySelector(".workspace-navigation")!;
    const children = [...bar.children];
    expect(bar.dataset.hasWorkspaceTabs).toBe("true");
    expect(slot.querySelector('[role="tablist"]')).not.toBeNull();
    expect(children.indexOf(navigation)).toBeLessThan(children.indexOf(slot));
    expect(slot.nextElementSibling).toBe(trigger);
    expect(
      trigger.nextElementSibling?.classList.contains(
        "workspace-status-controls",
      ),
    ).toBe(true);
    expect(trigger.querySelector(".workspace-status-context")).toBeNull();
    expect(trigger.querySelector(".workspace-status-unread")?.textContent).toBe(
      "1",
    );
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(
      bar.querySelector(
        '.workspace-status-development [title="Development build"]',
      ),
    ).not.toBeNull();

    await act(async () => {
      const tab = button("Current task");
      tab.dispatchEvent(
        new MouseEvent("mousedown", { button: 0, bubbles: true }),
      );
      tab.click();
      trigger.dispatchEvent(
        new MouseEvent("mousedown", { button: 0, bubbles: true }),
      );
      trigger.click();
    });
    expect(selectTab).toHaveBeenCalledOnce();
    expect(nativeWindow.startDragging).not.toHaveBeenCalled();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(
      container.querySelector('[role="dialog"][aria-label="Activity"]'),
    ).not.toBeNull();
  });

  it("keeps Activity mounted when a tab slot appears and restores the model label when it leaves", async () => {
    await render({ session: task() });
    const trigger = button("Activity: Queue is clear");
    expect(
      trigger.querySelector(".workspace-status-context")?.textContent,
    ).toBe("model");
    expect(
      container.querySelector<HTMLElement>(".workspace-status-bar")?.dataset
        .hasWorkspaceTabs,
    ).toBe("false");
    await click("Activity: Queue is clear");
    const activity = container.querySelector(
      '[role="dialog"][aria-label="Activity"]',
    );
    await render({
      workspaceTabs: createElement("div", null, "Workspace tabs"),
    });
    expect(button("Activity: Queue is clear")).toBe(trigger);
    expect(trigger.querySelector(".workspace-status-context")).toBeNull();
    expect(
      container.querySelector('[role="dialog"][aria-label="Activity"]'),
    ).toBe(activity);

    await render({ workspaceTabs: null });
    expect(container.querySelector(".workspace-status-tabs")).toBeNull();
    expect(
      trigger.querySelector(".workspace-status-context")?.textContent,
    ).toBe("model");
    expect(trigger.querySelectorAll(".provider-mark")).toHaveLength(1);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await click("Activity: Queue is clear");
    expect(
      container.querySelector('[role="dialog"][aria-label="Activity"]'),
    ).toBeNull();
  });

  it("replaces the task label with the current settings section and keeps exit controls out of window dragging", async () => {
    const closeSettings = vi.fn();
    await render({
      session: task({ model: "current-task-model" }),
      settingsView: { section: "appearance", onClose: closeSettings },
    });
    const settingsTitle = () =>
      container.querySelector(".workspace-status-settings")!;
    expect(settingsTitle().textContent).toContain("Settings");
    expect(settingsTitle().textContent).toContain("Appearance");
    expect(container.textContent).not.toContain("current-task-model");
    expect(
      container.querySelectorAll('button[aria-label="Close settings"]'),
    ).toHaveLength(1);

    await render({
      settingsView: { section: "providers", onClose: closeSettings },
    });
    expect(settingsTitle().textContent).toContain("Providers");
    expect(settingsTitle().textContent).not.toContain("Appearance");
    for (const label of ["Back to workspace", "Close settings"]) {
      const control = button(label);
      for (const target of [control, control.querySelector("svg")!]) {
        await act(async () =>
          target.dispatchEvent(
            new MouseEvent("mousedown", { button: 0, bubbles: true }),
          ),
        );
      }
      await click(label);
    }
    expect(closeSettings).toHaveBeenCalledTimes(2);
    expect(nativeWindow.startDragging).not.toHaveBeenCalled();
    expect(nativeWindow.toggleMaximize).not.toHaveBeenCalled();
  });

  it("keeps Activity available in settings and dismisses it when entering or leaving settings", async () => {
    const activity = () =>
      container.querySelector('[role="dialog"][aria-label="Activity"]');
    await render({ session: task() });
    await click("Activity: Queue is clear");
    expect(activity()).not.toBeNull();

    await render({
      settingsView: { section: "appearance", onClose: vi.fn() },
    });
    expect(activity()).toBeNull();
    expect(
      button("Activity: Queue is clear").getAttribute("aria-expanded"),
    ).toBe("false");
    await click("Activity: Queue is clear");
    expect(activity()).not.toBeNull();

    await render({ settingsView: undefined });
    expect(activity()).toBeNull();
    expect(
      container.querySelector(".workspace-status-context")?.textContent,
    ).toContain("model");
    await click("Activity: Queue is clear");
    expect(activity()).not.toBeNull();
  });

  it("drags the blank strip and toggles maximize on its double click only", async () => {
    await render();
    const strip = container.querySelector(".workspace-status-bar")!;
    const press = async (button: number, detail: number) => {
      const event = new MouseEvent("mousedown", {
        button,
        detail,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => strip.dispatchEvent(event));
      return event;
    };
    expect((await press(0, 1)).defaultPrevented).toBe(true);
    expect(nativeWindow.startDragging).toHaveBeenCalledOnce();
    expect(nativeWindow.toggleMaximize).not.toHaveBeenCalled();
    await press(0, 2);
    expect(nativeWindow.toggleMaximize).toHaveBeenCalledOnce();
    expect(nativeWindow.startDragging).toHaveBeenCalledOnce();
    expect((await press(2, 1)).defaultPrevented).toBe(false);
    expect(nativeWindow.startDragging).toHaveBeenCalledOnce();
  });

  it("keeps queue and navigation controls clickable without starting a window gesture", async () => {
    const search = vi.fn();
    await render({
      onSearch: search,
    });
    const queue = button("Activity: Queue is clear");
    const targets = [
      queue,
      queue.querySelector("span")!,
      button("Search workspace").querySelector("svg")!,
      container.querySelector(".workspace-status-controls")!,
    ];
    for (const target of targets) {
      const event = new MouseEvent("mousedown", {
        button: 0,
        detail: 1,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => target.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    await click("Activity: Queue is clear");
    expect(
      container.querySelector('[role="dialog"][aria-label="Activity"]'),
    ).not.toBeNull();
    await click("Search workspace");
    expect(search).toHaveBeenCalledOnce();
    expect(nativeWindow.startDragging).not.toHaveBeenCalled();
    expect(nativeWindow.toggleMaximize).not.toHaveBeenCalled();
  });

  it("counts real pending messages, running tasks and undecided approvals", async () => {
    const active = task({
      busy: true,
      queueStatus: "paused",
      queuedMessages: [{ id: "q", text: "Next", attachments: [] }],
      blocks: [
        {
          id: "a",
          role: "approval",
          text: "Approve?",
          approval: { requestId: 1 },
        },
        {
          id: "b",
          role: "approval",
          text: "Done",
          approval: { requestId: 2, decided: "allow" },
        },
      ],
    });
    expect(workspaceQueueSummary([active, task({ id: "idle" })])).toMatchObject(
      {
        queued: 1,
        running: 1,
        approvals: 1,
        label: "1 queued · 1 running · 1 approval",
      },
    );
    recordActivity({
      id: "approval",
      sessionId: active.id,
      title: active.title,
      outcome: "approval",
      summary: "Approve?",
      cwd: active.cwd,
      harness: active.harness,
      model: active.model,
    });
    await render({ sessions: [active] });
    await click("Activity: 1 queued · 1 running · 1 approval · 1 unread");
    expect(
      container.querySelector('[aria-label="Needs you"]')?.textContent,
    ).toContain("Needs approval");
    await click("Open First task: Needs approval");
    expect(props.onSelectSession).toHaveBeenCalledExactlyOnceWith("task-1");
    expect(
      container.querySelector('[role="dialog"][aria-label="Activity"]'),
    ).toBeNull();
    expect(getActivitySnapshot()[0].readAt).not.toBeNull();
  });

  it("keeps Activity open and unread until routing succeeds, including an async restore", async () => {
    recordActivity({
      id: "result",
      sessionId: "closed-task",
      title: "Closed task",
      outcome: "completed",
      summary: "Ready for review",
      cwd: "/project",
      harness: "codex",
      model: "test",
    });
    let finish!: (success: boolean) => void;
    const select = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    await render({ onSelectSession: select });
    await click("Activity: Queue is clear · 1 unread");
    await click("Open Closed task: Finished");
    expect(select).toHaveBeenCalledExactlyOnceWith("closed-task");
    expect(getActivitySnapshot()[0].readAt).toBeNull();
    expect(
      container.querySelector('[role="dialog"][aria-label="Activity"]'),
    ).not.toBeNull();
    await act(async () => finish(false));
    expect(getActivitySnapshot()[0].readAt).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "could not be opened",
    );
    await click("Open Closed task: Finished");
    await act(async () => finish(true));
    expect(getActivitySnapshot()[0].readAt).not.toBeNull();
    expect(
      container.querySelector('[role="dialog"][aria-label="Activity"]'),
    ).toBeNull();
    expect(
      button("Activity: Queue is clear").getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("exposes Home and disables Back/Forward until their destinations exist", async () => {
    const home = vi.fn();
    const back = vi.fn();
    const forward = vi.fn();
    await render({
      onHome: home,
      homeOpen: true,
      onGoBack: back,
      onGoForward: forward,
      canGoBack: false,
      canGoForward: false,
    });
    expect(button("Workspace Home").getAttribute("aria-pressed")).toBe("true");
    expect(button("Back").disabled).toBe(true);
    expect(button("Forward").disabled).toBe(true);
    await click("Back");
    await click("Forward");
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
    await click("Workspace Home");
    expect(home).toHaveBeenCalledOnce();
    await render({ homeOpen: false, canGoBack: true, canGoForward: true });
    expect(button("Workspace Home").getAttribute("aria-pressed")).toBe("false");
    await click("Back");
    await click("Forward");
    expect(back).toHaveBeenCalledOnce();
    expect(forward).toHaveBeenCalledOnce();
    expect(nativeWindow.startDragging).not.toHaveBeenCalled();
  });

  it("leaves navigation to the visible sidebar and brings it back when hidden", async () => {
    const toggle = vi.fn();
    await render({ onToggleSidebar: toggle, navigationInSidebar: true });
    expect(
      container.querySelector('[aria-label="Workspace navigation"]'),
    ).toBeNull();
    expect(container.querySelector('[aria-label^="Activity:"]')).not.toBeNull();
    await render({ navigationInSidebar: false });
    await click("Toggle workspace sidebar");
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("keeps every compact navigation action available without enabling missing history", async () => {
    const home = vi.fn();
    const back = vi.fn();
    const forward = vi.fn();
    const search = vi.fn();
    const browser = vi.fn();
    await act(async () =>
      root.render(
        createElement(WorkspaceNavigation, {
          compact: true,
          sidebarOpen: true,
          onToggleSidebar: vi.fn(),
          onSearch: search,
          onNewBrowser: browser,
          onHome: home,
          onGoBack: back,
          onGoForward: forward,
          canGoBack: false,
          canGoForward: true,
        }),
      ),
    );
    await click("More navigation");
    const menu = container.querySelector<HTMLElement>(
      '[role="menu"][aria-label="More navigation"]',
    )!;
    const items = [
      ...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ];
    expect(items.map((item) => item.textContent)).toEqual([
      "Search workspace",
      "New browser tab",
      "Workspace Home",
      "Back",
      "Forward",
    ]);
    expect(items[3].disabled).toBe(true);
    expect(items[4].disabled).toBe(false);
    await act(async () => items[3].click());
    expect(back).not.toHaveBeenCalled();
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    await act(async () => items[4].click());
    expect(forward).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button("More navigation"));
    for (const [label, callback] of [
      ["Search workspace", search],
      ["New browser tab", browser],
      ["Workspace Home", home],
    ] as const) {
      await click("More navigation");
      const item = [
        ...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ].find((node) => node.textContent === label)!;
      await act(async () => item.click());
      expect(callback).toHaveBeenCalledOnce();
    }
    expect(nativeWindow.startDragging).not.toHaveBeenCalled();
  });

  it("navigates overflow actions by keyboard and skips unavailable history", async () => {
    await act(async () =>
      root.render(
        createElement(WorkspaceNavigation, {
          compact: true,
          onSearch: vi.fn(),
          onHome: vi.fn(),
          onGoBack: vi.fn(),
          onGoForward: vi.fn(),
          canGoBack: false,
          canGoForward: true,
        }),
      ),
    );
    await click("More navigation");
    const menu = container.querySelector<HTMLElement>('[role="menu"]')!;
    const key = async (value: string) =>
      act(async () => {
        menu.dispatchEvent(
          new KeyboardEvent("keydown", { key: value, bubbles: true }),
        );
      });
    menu.focus();
    await key("ArrowUp");
    expect(document.activeElement?.textContent).toBe("Forward");
    await key("ArrowUp");
    expect(document.activeElement?.textContent).toBe("Workspace Home");
    await key("Home");
    expect(document.activeElement?.textContent).toBe("Search workspace");
    await key("End");
    expect(document.activeElement?.textContent).toBe("Forward");
    await key("Tab");
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it("omits unknown metrics and displays only reported cost and context", async () => {
    expect([undefined, null, NaN, Infinity, -1].map(reportedCostLabel)).toEqual(
      [null, null, null, null, null],
    );
    expect(reportedCostLabel(0)).toBe("$0.00");
    expect(reportedCostLabel(0.004)).toBe("<$0.01");
    await render();
    expect(
      container.querySelector('[aria-label="Task cost and usage"]'),
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="Context and provider usage"]'),
    ).toBeNull();
    await render({
      session: task({ context: { used: 50_000, window: 100_000 } }),
      costUsd: 1.25,
    });
    expect(button("Context and provider usage").textContent).toBe("50%");
    expect(button("Task cost and usage").textContent).toBe("$1.25");
  });

  it("keeps reported tokens useful when a provider omits the model window", async () => {
    await render({ session: task({ context: { used: 50_000 } }) });
    expect(button("Context and provider usage").textContent).toBe("50K");
    await click("Context and provider usage");
    expect(container.textContent).toContain("50K tokens");
    expect(api.codex).not.toHaveBeenCalled();
    expect(api.claude).not.toHaveBeenCalled();
    await render({
      session: task({ context: { used: 50_000, window: Infinity } }),
    });
    expect(button("Context and provider usage").textContent).toBe("50K");
  });

  it("does not carry a previous task's metrics into an unreported task", async () => {
    await render({
      session: task({ context: { used: 50_000, window: 100_000 } }),
      costUsd: 1.25,
    });
    await click("Task cost and usage");
    await render({ session: task({ id: "task-2" }), costUsd: undefined });
    expect(
      container.querySelector('[aria-label="Task cost and usage"]'),
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="Context and provider usage"]'),
    ).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await render({ usageProviders: ["codex"] });
    expect(button("Context and provider usage").textContent).toBe("Usage");
    expect(button("Context and provider usage").title).toBe(
      "View Codex account usage",
    );
  });

  it("opens only the external action clicked and omits Run controls", async () => {
    const reveal = vi.fn();
    await render({
      openActions: [
        { id: "reveal", label: "Reveal in Finder", onSelect: reveal },
        { id: "preview", label: "Open preview", disabled: true },
      ],
    });
    expect(container.querySelector('[aria-label="Run actions"]')).toBeNull();
    expect(container.textContent).not.toContain("Add run script");
    expect(reveal).not.toHaveBeenCalled();
    await click("Open workspace externally");
    expect(button("Open preview").disabled).toBe(true);
    await click("Reveal in Finder");
    expect(reveal).toHaveBeenCalledOnce();
  });

  it("disables unavailable external actions", async () => {
    const reveal = vi.fn();
    await render({
      openActions: [
        {
          id: "finder",
          label: "Reveal project in Finder",
          onSelect: reveal,
          disabled: true,
        },
      ],
    });
    expect(button("Open workspace externally").disabled).toBe(true);
    await click("Open workspace externally");
    expect(reveal).not.toHaveBeenCalled();
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it("uses the existing access picker and only changes access after selection", async () => {
    await render();
    const trigger = container.querySelector<HTMLButtonElement>(
      "[data-access-trigger]",
    )!;
    await act(async () => trigger.click());
    expect(props.onAccessModeChange).not.toHaveBeenCalled();
    const options = container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitemradio"]',
    );
    await act(async () => options[3]!.click());
    expect(props.onAccessModeChange).toHaveBeenCalledExactlyOnceWith(
      "full-access",
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the exact access mode and next-turn qualifier in compact controls", async () => {
    await render({
      accessMode: "full-access",
      session: task({ busy: true, runtimeMode: "full-access" }),
    });
    const trigger = button("Full access · next turn");
    expect(trigger.title).toContain(
      "The current turn keeps its starting access",
    );
    const visibleLabels = [...trigger.querySelectorAll("span")].filter(
      (node) => !node.classList.contains("sr-only"),
    );
    expect(visibleLabels.map((node) => node.textContent)).toEqual([
      "next turn",
    ]);
    await act(async () => trigger.click());
    const selected = container.querySelector(
      '[role="menuitemradio"][aria-checked="true"]',
    );
    expect(selected?.textContent).toContain("Full access");
    expect(props.onAccessModeChange).not.toHaveBeenCalled();
  });
});

describe("on-demand provider usage", () => {
  it("keeps both workspace providers visible when focus moves between agents", async () => {
    api.claude.mockResolvedValue({
      provider: "claude",
      session: { usedPercent: 14, windowMinutes: 300, resetsAt: null },
      weekly: { usedPercent: 1, windowMinutes: 10_080, resetsAt: null },
      updatedAt: Date.now(),
      error: null,
      status: "ok",
    });
    await render({ session: task(), usageProviders: ["codex", "claude"] });
    await click("Context and provider usage");
    expect(container.textContent).toContain("Claude Code");
    expect(container.textContent).toContain("5-hour86% left");
    expect(container.textContent).toContain("Weekly99% left");
    expect(container.textContent).toContain("5-hour77% left");
    await render({ session: task({ id: "claude-task", harness: "claude" }) });
    expect(container.textContent).toContain("5-hour86% left");
    expect(container.textContent).toContain("5-hour77% left");
    expect(api.claude).toHaveBeenCalledOnce();
    expect(api.codex).toHaveBeenCalledOnce();
  });
  it("keeps Claude visible when its usage request fails", async () => {
    api.claude.mockRejectedValueOnce(new Error("Claude usage unavailable"));
    await render({ session: task(), usageProviders: ["codex", "claude"] });
    await click("Context and provider usage");
    expect(
      container.querySelector('[aria-label="Claude Code usage"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Claude usage unavailable");
    expect(container.textContent).toContain("5-hour77% left");
  });

  it("does not probe providers or schedule polling while the strip is idle", async () => {
    vi.useFakeTimers();
    await render({ usageProviders: ["codex", "claude"] });
    await act(async () => {
      vi.advanceTimersByTime(30 * 60_000);
    });
    expect(api.codex).not.toHaveBeenCalled();
    expect(api.claude).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("loads on open, reuses a fresh snapshot, and refreshes only on demand", async () => {
    await render({ usageProviders: ["codex", "codex"], costUsd: 1.25 });
    await click("Context and provider usage");
    expect(api.codex).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("5-hour77% left");
    await click("Context and provider usage");
    await click("Task cost and usage");
    expect(api.codex).toHaveBeenCalledTimes(1);
    expect(button("Task cost and usage").getAttribute("aria-expanded")).toBe(
      "true",
    );
    await click("Context and provider usage");
    expect(button("Task cost and usage").getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(
      button("Context and provider usage").getAttribute("aria-expanded"),
    ).toBe("true");
    await click("Refresh provider usage");
    expect(api.codex).toHaveBeenCalledTimes(2);
  });

  it("preserves an open usage panel and its fetched snapshot while toolbar tabs change", async () => {
    await render({ usageProviders: ["codex"] });
    const trigger = button("Context and provider usage");
    await click("Context and provider usage");
    const panel = container.querySelector(
      '[aria-label="Task and provider usage"]',
    );
    expect(api.codex).toHaveBeenCalledOnce();
    expect(panel?.textContent).toContain("5-hour77% left");

    for (const workspaceTabs of [
      createElement("div", null, "Tabs"),
      undefined,
    ]) {
      await render({ workspaceTabs });
      expect(button("Context and provider usage")).toBe(trigger);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(
        container.querySelector('[aria-label="Task and provider usage"]'),
      ).toBe(panel);
      expect(panel?.textContent).toContain("5-hour77% left");
      expect(api.codex).toHaveBeenCalledOnce();
    }
  });

  it("does not start a provider process when the document is hidden", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await render({ usageProviders: ["codex"] });
    await click("Context and provider usage");
    expect(api.codex).not.toHaveBeenCalled();
    await click("Refresh provider usage");
    expect(api.codex).not.toHaveBeenCalled();
  });
});

describe("native workspace toolbar menus", () => {
  it("opens a graphical owned panel and pushes automatically loaded limits without an HTML overlay", async () => {
    nativeMenu.supported.mockReturnValue(true);
    let finish!: (value: ProviderRateLimits) => void;
    api.codex.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render({
      session: task({ context: { used: 31, window: 100 } }),
      usageProviders: ["codex"],
    });
    await click("Context and provider usage");
    expect(nativeMenu.show).not.toHaveBeenCalled();
    expect(nativePanel.open).toHaveBeenCalledOnce();
    expect(api.codex).toHaveBeenCalledOnce();
    expect(
      container.querySelector('[aria-label="Task and provider usage"]'),
    ).toBeNull();
    expect(document.querySelector("[data-popover-side]")).toBeNull();
    expect(nativePanel.open.mock.calls[0]![1].providers[0].status).toBe(
      "fetching",
    );
    await act(async () => {
      nativePanel.callbacks.get("usage-panel-action")?.({
        label: "usage-panel-test",
        action: "refresh",
      });
    });
    expect(api.codex).toHaveBeenCalledOnce();
    await act(async () => {
      finish({
        provider: "codex",
        status: "ok",
        session: { usedPercent: 23, windowMinutes: 300, resetsAt: null },
        weekly: null,
        updatedAt: Date.now(),
        error: null,
      });
    });
    expect(nativePanel.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providers: [
          expect.objectContaining({
            status: "ok",
            session: expect.objectContaining({ usedPercent: 23 }),
          }),
        ],
      }),
      "usage-panel-test",
    );
    await act(async () => {
      nativePanel.callbacks.get("usage-panel-closed")?.({
        label: "usage-panel-test",
      });
    });
    expect(
      button("Context and provider usage").getAttribute("aria-expanded"),
    ).toBe("false");
    expect(props.onAccessModeChange).not.toHaveBeenCalled();
  });
  it("ignores Usage events from a previous opening of the retained panel", async () => {
    nativeMenu.supported.mockReturnValue(true);
    nativePanel.open
      .mockResolvedValueOnce("usage-first")
      .mockResolvedValueOnce("usage-second");
    await render({ usageProviders: ["codex"] });
    await click("Context and provider usage");
    await act(async () =>
      nativePanel.callbacks.get("usage-panel-closed")?.({
        label: "usage-first",
      }),
    );
    await click("Context and provider usage");
    const calls = api.codex.mock.calls.length;
    await act(async () => {
      nativePanel.callbacks.get("usage-panel-action")?.({
        label: "usage-first",
        action: "refresh",
      });
      nativePanel.callbacks.get("usage-panel-closed")?.({
        label: "usage-first",
      });
    });
    expect(api.codex).toHaveBeenCalledTimes(calls);
    expect(
      button("Context and provider usage").getAttribute("aria-expanded"),
    ).toBe("true");
    await act(async () =>
      nativePanel.callbacks.get("usage-panel-closed")?.({
        label: "usage-second",
      }),
    );
    expect(
      button("Context and provider usage").getAttribute("aria-expanded"),
    ).toBe("false");
  });
  it("allows a requested native panel to load while its parent loses visibility", async () => {
    nativeMenu.supported.mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await render({ usageProviders: ["codex"] });
    expect(api.codex).not.toHaveBeenCalled();
    await click("Context and provider usage");
    expect(api.codex).toHaveBeenCalledOnce();
  });
  it("routes native external choices without an HTML menu", async () => {
    nativeMenu.supported.mockReturnValue(true);

    const selected = vi.fn();
    await render({
      openActions: [{ id: "editor", label: "Open editor", onSelect: selected }],
    });
    await click("Open workspace externally");
    expect(openPanel.open).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        title: "Open workspace",
        items: [expect.objectContaining({ id: "editor", disabled: false })],
        theme: expect.objectContaining({ mode: "dark" }),
      }),
    );
    expect(selected).not.toHaveBeenCalled();
    await act(async () =>
      openPanel.callbacks.get("workspace-menu-panel-action")?.({
        label: "workspace-menu-panel-test",
        presentation: "open-1",
        action: "editor",
      }),
    );
    expect(selected).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-label="Open workspace"]')).toBeNull();
  });
  it("ignores stale, unknown and disabled native choices", async () => {
    nativeMenu.supported.mockReturnValue(true);
    const selected = vi.fn();
    await render({
      openActions: [
        { id: "editor", label: "Open editor", onSelect: selected },
        { id: "blocked", label: "Blocked", onSelect: selected, disabled: true },
      ],
    });
    await click("Open workspace externally");
    const receive = openPanel.callbacks.get("workspace-menu-panel-action")!;
    await act(async () => {
      receive({ presentation: "open-1", label: "old-panel", action: "editor" });
      receive({
        presentation: "previous-open",
        label: "workspace-menu-panel-test",
        action: "editor",
      });
      receive({
        presentation: "open-1",
        label: "workspace-menu-panel-test",
        action: "blocked",
      });
      receive({
        presentation: "open-1",
        label: "workspace-menu-panel-test",
        action: "unknown",
      });
    });
    expect(selected).not.toHaveBeenCalled();
    expect(
      button("Open workspace externally").getAttribute("aria-expanded"),
    ).toBe("true");
    await act(async () =>
      receive({
        presentation: "open-1",
        label: "workspace-menu-panel-test",
        action: "editor",
      }),
    );
    expect(selected).toHaveBeenCalledOnce();
  });
  it("reports native menu failures without mounting a flashing HTML fallback", async () => {
    nativeMenu.supported.mockReturnValue(true);
    openPanel.open.mockRejectedValue(new Error("Native menu unavailable"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await render({
      openActions: [{ id: "editor", label: "Open editor", onSelect: vi.fn() }],
    });
    await click("Open workspace externally");
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Could not open menu",
    );
    expect(container.querySelector('[role="menu"]')).toBeNull();
    warning.mockRestore();
  });
});
