// @vitest-environment happy-dom
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../lib/session";
import { getActivitySnapshot, recordActivity } from "../lib/activity";
import {
  WorkspaceStatusBar,
  WorkspaceNavigation,
  workspaceQueueSummary,
  type WorkspaceStatusBarProps,
} from "./WorkspaceStatusBar";

const platform = vi.hoisted(() => ({ isMac: true }));
vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  get IS_MAC() {
    return platform.isMac;
  },
}));

vi.mock("../lib/usagePanel", () => ({
  useUsagePanelTheme: () => ({ mode: "dark", accent: "#5ed9d0" }),
}));
const nativeWindow = vi.hoisted(() => ({
  startDragging: vi.fn().mockResolvedValue(undefined),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
  isMaximized: vi.fn().mockResolvedValue(false),
  onResized: vi.fn().mockResolvedValue(() => {}),
  minimize: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => nativeWindow,
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
  platform.isMac = true;
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
    onSelectSession: vi.fn().mockResolvedValue(true),
  };
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
  it.each(["home", "workspace", "settings"] as const)(
    "keeps Windows caption controls available in the %s toolbar",
    async (view) => {
      platform.isMac = false;
      await render(
        view === "settings"
          ? { settingsView: { section: "appearance", onClose: vi.fn() } }
          : view === "workspace"
            ? { session: task() }
            : {},
      );
      await click("Minimize window");
      await click("Maximize window");
      await click("Close window");
      expect(nativeWindow.minimize).toHaveBeenCalledOnce();
      expect(nativeWindow.toggleMaximize).toHaveBeenCalledOnce();
      expect(nativeWindow.close).toHaveBeenCalledOnce();
      expect(nativeWindow.startDragging).not.toHaveBeenCalled();
    },
  );

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

  it("keeps Activity beside navigation on the left, with or without Settings", async () => {
    recordActivity({
      id: "left-activity",
      sessionId: "task-1",
      title: "First task",
      outcome: "completed",
      summary: "Ready for review",
      cwd: "/project",
      harness: "codex",
      model: "model",
    });
    await render({ session: task(), onToggleSidebar: vi.fn() });
    const bar = container.querySelector<HTMLElement>(".workspace-status-bar")!;
    const children = () => [...bar.children];
    const trigger = button("Activity: Queue is clear · 1 unread");
    const navigation = bar.querySelector(".workspace-navigation")!;
    const controls = bar.querySelector(".workspace-status-controls")!;
    expect(bar.querySelector(".workspace-status-tabs")).toBeNull();
    expect(children().indexOf(trigger)).toBe(children().indexOf(navigation) + 1);
    expect(children().indexOf(trigger)).toBeLessThan(children().indexOf(controls));
    expect(
      trigger.querySelector(".workspace-status-context")?.textContent,
    ).toBe("model");
    expect(trigger.querySelector(".workspace-status-unread")?.textContent).toBe(
      "1",
    );

    await render({
      settingsView: { section: "appearance", onClose: vi.fn() },
    });
    expect(button("Activity: Queue is clear · 1 unread")).toBe(trigger);
    expect(children().indexOf(trigger)).toBe(children().indexOf(navigation) + 1);
    expect(
      children().indexOf(bar.querySelector(".workspace-status-settings")!),
    ).toBeGreaterThan(children().indexOf(trigger));
    expect(trigger.querySelector(".workspace-status-context")).toBeNull();
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

  it("keeps usage, access, external-open and settings controls out of the header", async () => {
    await render({ session: task({ context: { used: 101_000 } }) });
    const labels = [...container.querySelectorAll("button")].map((node) =>
      node.getAttribute("aria-label"),
    );
    expect(labels).not.toContain("Context and provider usage");
    expect(labels).not.toContain("Task cost and usage");
    expect(labels).not.toContain("Open workspace externally");
    // Settings opens from the sidebar, the menu bar and ⌘, instead.
    expect(labels).not.toContain("Settings");
    expect(container.textContent).not.toContain("101K");
  });
});
