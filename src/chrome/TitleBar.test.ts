// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetHarnessModelOverlays, setHarnessModels } from "../lib/models";
import { saveTabGroupLabel } from "../lib/tabGroups";
import { projectKey } from "../lib/paths";
import {
  TitleBar,
  tabCopy,
  tabStripOverflow,
  titleTabContextCloseIds,
  titleTabClosable,
  titleSurfaceOrder,
  type Tab,
} from "./TitleBar";

const nativeWindow = vi.hoisted(() => ({
  setTitle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => nativeWindow,
}));
vi.mock("./WindowControls", () => ({ WindowControls: () => null }));
afterEach(resetHarnessModelOverlays);

function tab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: "t1",
    project: "agent-terminal",
    title: "",
    more: [],
    sessionCount: 1,
    harnesses: [],
    busyHarnesses: [],
    files: [],
    ...overrides,
  };
}

describe("tabCopy", () => {
  it("layers conversation and file when split across panes", () => {
    const focusedSession = tabCopy(
      tab({
        multiPane: true,
        title: "Add custom project logos",
        files: ["opencodeAdapter.ts"],
      }),
    );
    expect(focusedSession).toEqual({
      headline: "Add custom project logos",
      meta: "opencodeAdapter.ts",
      tooltip: "agent-terminal · Add custom project logos · opencodeAdapter.ts",
    });

    const focusedFile = tabCopy(
      tab({
        multiPane: true,
        fileFocused: true,
        title: "Add custom project logos",
        files: ["opencodeAdapter.ts"],
      }),
    );
    expect(focusedFile).toEqual({
      headline: "opencodeAdapter.ts",
      meta: "Add custom project logos",
      tooltip: "agent-terminal · Add custom project logos · opencodeAdapter.ts",
    });
  });

  it("layers two conversations in split panes", () => {
    const copy = tabCopy(
      tab({
        multiPane: true,
        title: "First chat",
        more: ["Second chat"],
        sessionCount: 2,
      }),
    );
    expect(copy.headline).toBe("First chat");
    expect(copy.meta).toBe("Second chat");
  });

  it("keeps a single-line title for one pane with only a conversation", () => {
    const copy = tabCopy(
      tab({
        title: "Only chat",
        project: "agent-terminal",
      }),
    );
    expect(copy.headline).toBe("Only chat");
    expect(copy.meta).toBe("");
  });

  it("labels an empty tab New session", () => {
    const copy = tabCopy(tab({ project: "agent-terminal" }));
    expect(copy.headline).toBe("New session");
    expect(copy.meta).toBe("");
  });

  it("names an untitled session after its real model without duplicating the projectless tooltip", () => {
    setHarnessModels("codex", [
      { id: "codex:qa-model", harness: "codex", name: "QA Model" },
    ]);
    const copy = tabCopy(
      tab({ models: [{ harness: "codex", model: "codex:qa-model" }] }),
      true,
    );
    expect(copy).toEqual({
      headline: "QA Model",
      meta: "",
      tooltip: "QA Model",
    });
  });

  it("preserves task titles and exposes every distinct grouped model while keeping the visible summary short", () => {
    const copy = tabCopy(
      tab({
        title: "Fix browser",
        multiPane: true,
        sessionCount: 4,
        models: [
          { harness: "codex", model: "focused-model" },
          { harness: "claude", model: "second-model" },
          { harness: "codex", model: "focused-model" },
          { harness: "cursor", model: "third-model" },
        ],
      }),
    );
    expect(copy.headline).toBe("Fix browser");
    expect(copy.meta).toBe("focused-model +2 models · 4 sessions");
    expect(copy.tooltip).toBe(
      "agent-terminal · Fix browser · focused-model · second-model · third-model",
    );
  });

  it("keeps file-focused split names while displaying their session models as context", () => {
    const copy = tabCopy(
      tab({
        fileFocused: true,
        multiPane: true,
        files: ["browser.ts"],
        models: [{ harness: "codex", model: "working-model" }],
      }),
    );
    expect(copy.headline).toBe("browser.ts");
    expect(copy.meta).toBe("working-model");
  });
});

describe("tabStripOverflow", () => {
  it("hides both chevrons when the strip fits", () => {
    expect(tabStripOverflow(0, 400, 400)).toEqual({
      left: false,
      right: false,
    });
  });

  it("shows only the right chevron at the start", () => {
    expect(tabStripOverflow(0, 400, 800)).toEqual({ left: false, right: true });
  });

  it("shows both chevrons in the middle", () => {
    expect(tabStripOverflow(200, 400, 800)).toEqual({
      left: true,
      right: true,
    });
  });

  it("shows only the left chevron at the end", () => {
    expect(tabStripOverflow(400, 400, 800)).toEqual({
      left: true,
      right: false,
    });
  });
});

describe("titleTabClosable", () => {
  it("hides close on a sole blank tab", () => {
    expect(titleTabClosable(tab({ blank: true }), 1)).toBe(false);
  });

  it("shows close on a sole tab once it has a conversation", () => {
    expect(titleTabClosable(tab({ blank: false }), 1)).toBe(true);
  });

  it("allows a blank tab to be removed when another tab remains", () => {
    expect(titleTabClosable(tab({ blank: true }), 2)).toBe(true);
  });
});

describe("titleSurfaceOrder", () => {
  it("retains mixed visual order while removing stale and duplicate ids and appending new tabs", () => {
    expect(
      titleSurfaceOrder(
        ["a", "b"],
        ["web-a", "web-b"],
        ["web-b", "a", "removed", "a"],
      ),
    ).toEqual(["web-b", "a", "b", "web-a"]);
  });
});

describe("titleTabContextCloseIds", () => {
  const tabs = [
    tab({ id: "a" }),
    tab({ id: "b" }),
    tab({ id: "c" }),
    tab({ id: "d" }),
  ];

  it("finds every tab except the context tab", () => {
    expect(titleTabContextCloseIds(tabs, "b", "others")).toEqual([
      "a",
      "c",
      "d",
    ]);
  });

  it("finds tabs on either side in visual order", () => {
    expect(titleTabContextCloseIds(tabs, "c", "left")).toEqual(["a", "b"]);
    expect(titleTabContextCloseIds(tabs, "b", "right")).toEqual(["c", "d"]);
  });

  it("returns no ids for an edge or missing tab", () => {
    expect(titleTabContextCloseIds(tabs, "a", "left")).toEqual([]);
    expect(titleTabContextCloseIds(tabs, "d", "right")).toEqual([]);
    expect(titleTabContextCloseIds(tabs, "missing", "others")).toEqual([]);
  });
});

describe("browser tab integration", () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: ComponentProps<typeof TitleBar>;

  beforeEach(() => {
    nativeWindow.setTitle.mockClear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    props = {
      tabs: [
        tab({ id: "a", title: "First task" }),
        tab({ id: "b", title: "Second task" }),
      ],
      activeId: "a",
      cwd: "/projects/demo",
      onToggleSidebar: vi.fn(),
      onSelect: vi.fn(),
      onNew: vi.fn(),
      onClose: vi.fn(),
      onCloseMany: vi.fn(),
      onReorder: vi.fn(),
      onSelectBrowser: vi.fn(),
      onCloseBrowser: vi.fn(),
      onBrowserModeChange: vi.fn(),
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render(overrides: Partial<typeof props> = {}) {
    props = { ...props, ...overrides };
    await act(async () => root.render(createElement(TitleBar, props)));
  }

  async function click(selector: string) {
    const button = document.querySelector<HTMLButtonElement>(selector)!;
    expect(button).not.toBeNull();
    await act(async () => button.click());
  }

  it("updates both untitled labels and titled model metadata when the live model catalog arrives", async () => {
    const models = [{ harness: "codex" as const, model: "codex:qa-model" }];
    await render({
      paneLocal: true,
      tabs: [
        tab({ id: "a", models }),
        tab({ id: "b", title: "Repair tabs", models }),
      ],
    });
    const first = container.querySelector('[data-surface-tab-id="a"]')!;
    const second = container.querySelector('[data-surface-tab-id="b"]')!;
    expect(first.querySelector(".personal-title-tab-label")?.textContent).toBe(
      "qa-model",
    );
    expect(second.querySelector(".personal-title-tab-label")?.textContent).toBe(
      "Repair tabs",
    );
    await act(async () =>
      setHarnessModels("codex", [
        { id: "codex:qa-model", harness: "codex", name: "QA Model 2" },
      ]),
    );
    expect(first.querySelector(".personal-title-tab-label")?.textContent).toBe(
      "QA Model 2",
    );
    expect(second.querySelector(".personal-title-tab-meta")?.textContent).toBe(
      "QA Model 2",
    );
    expect(
      second.querySelector('[role="tab"]')?.getAttribute("aria-label"),
    ).toContain("Repair tabs · QA Model 2");
    await click('[aria-label="Close QA Model 2"]');
    expect(props.onClose).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("renders a compact pane-local strip with both new actions and no repeated global controls", async () => {
    await render({
      paneLocal: true,
      paneFocused: false,
      sidebarOpen: false,
      browserTabs: [{ id: "web-a", title: "Preview" }],
      onNewBrowser: vi.fn(),
      onOpenSettings: vi.fn(),
      onToggleInspector: vi.fn(),
      onNewTerminal: vi.fn(),
    });
    expect(container.querySelector("header")?.dataset.paneLocal).toBe("true");
    expect(container.querySelector("header")?.dataset.paneFocused).toBe(
      "false",
    );
    expect(
      container.querySelector('[aria-label^="Toggle Sidebar"]'),
    ).toBeNull();
    expect(container.querySelector('[aria-label^="Settings"]')).toBeNull();
    expect(container.querySelector("[data-inspector-toggle]")).toBeNull();
    expect(container.querySelector('[aria-label^="New Terminal"]')).toBeNull();
    expect(container.querySelectorAll("[data-surface-tab-id]")).toHaveLength(3);
    expect(
      container
        .querySelector('[data-surface-tab-id="a"] [role="tab"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    await click('[aria-label="New session"]');
    await click('[aria-label="New browser"]');
    expect(props.onNew).toHaveBeenCalledOnce();
    expect(props.onNewBrowser).toHaveBeenCalledOnce();
  });

  it("only lets the focused local pane write the native window title", async () => {
    document.title = "Focused view title";
    await render({ paneLocal: true, paneFocused: false });
    expect(nativeWindow.setTitle).not.toHaveBeenCalled();
    expect(document.title).toBe("Focused view title");
    await render({ paneFocused: true });
    expect(nativeWindow.setTitle).toHaveBeenCalledOnce();
    await render({ paneFocused: false, cwd: "/projects/other" });
    expect(nativeWindow.setTitle).toHaveBeenCalledOnce();
  });

  it("updates custom project labels in tab metadata and the native title without changing tab identity", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const path = "/projects/old-folder-name";
    const original = tab({
      id: "a",
      project: "old-folder-name",
      projectPath: path,
      title: "Keep this conversation title",
    });
    saveTabGroupLabel(projectKey(path), "My workspace");
    try {
      await render({ cwd: path, tabs: [original] });
      expect(document.title).toBe("My workspace — Aven");
      expect(
        container.querySelector('[role="tab"]')?.getAttribute("title"),
      ).toBe("My workspace · Keep this conversation title");
      await act(async () =>
        saveTabGroupLabel(projectKey(path), "Updated label"),
      );
      expect(nativeWindow.setTitle).toHaveBeenLastCalledWith(
        "Updated label — Aven",
      );
      expect(
        container.querySelector('[role="tab"]')?.getAttribute("title"),
      ).toBe("Updated label · Keep this conversation title");
      await click('[role="tab"]');
      expect(props.onSelect).toHaveBeenCalledWith("a");
      expect(original.project).toBe("old-folder-name");
      expect(original.projectPath).toBe(path);
      expect(original.title).toBe("Keep this conversation title");
      await act(async () => saveTabGroupLabel(projectKey(path), ""));
      expect(document.title).toBe("old-folder-name — Aven");
    } finally {
      await act(async () => saveTabGroupLabel(projectKey(path), ""));
    }
  });

  it("offers Split right for the active tab and keeps a blank local session closable when another pane has sessions", async () => {
    await render({
      paneLocal: true,
      tabs: [tab({ id: "a", blank: true })],
      totalSessionTabs: 2,
      onNewView: vi.fn(),
    });
    expect(
      container.querySelector('[aria-label="Close New session"]'),
    ).not.toBeNull();
    await act(async () =>
      container
        .querySelector('[role="tab"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true }),
        ),
    );
    const newView = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent === "Split right")!;
    expect(newView.disabled).toBe(false);
    await act(async () => newView.click());
    expect(props.onNewView).toHaveBeenCalledExactlyOnceWith("a");
    expect(props.onSelect).not.toHaveBeenCalled();
    await click('[aria-label="Close New session"]');
    expect(props.onClose).toHaveBeenCalledExactlyOnceWith("a");
  });

  it.each(["session", "browser"])(
    "offers pane combine and Picture in Picture actions for a %s without selecting or closing it",
    async (kind) => {
      const browser = kind === "browser";
      const id = browser ? "web-a" : "a";
      await render({
        paneLocal: true,
        tabs: browser ? [] : [tab({ id, title: "Current task" })],
        browserTabs: browser ? [{ id, title: "Preview" }] : [],
        activeId: id,
        visibleIds: [id, "other"],
        combineTargets: [
          { id, label: "this pane" },
          { id: "other", label: "right pane" },
          { id: "missing", label: "missing pane" },
        ],
        onCombineWith: vi.fn(),
        onUnsplit: vi.fn(),
        onPictureInPicture: vi.fn(),
        onGroupPictureInPicture: vi.fn(),
      });
      const openMenu = async () =>
        act(async () =>
          container.querySelector('[role="tab"]')!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "ContextMenu",
              bubbles: true,
            }),
          ),
        );
      const menuItems = () =>
        Array.from(
          document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
        );
      const pick = async (label: string) => {
        const button = menuItems().find((item) => item.textContent === label);
        expect(button).toBeDefined();
        await act(async () => button!.click());
      };
      await openMenu();
      const labels = menuItems().map((item) => item.textContent);
      expect(labels.filter((label) => label?.startsWith("Combine"))).toEqual([
        "Combine with right pane",
        "Combine all tabs",
      ]);
      expect(labels).not.toContain("Return to single view");
      await pick("Combine with right pane");
      expect(props.onCombineWith).toHaveBeenCalledExactlyOnceWith("other");
      await openMenu();
      await pick("Combine all tabs");
      expect(props.onUnsplit).toHaveBeenCalledOnce();
      await openMenu();
      await pick("Picture in Picture");
      expect(props.onPictureInPicture).toHaveBeenCalledExactlyOnceWith(id);
      await openMenu();
      await pick("Group Picture in Picture");
      expect(props.onGroupPictureInPicture).toHaveBeenCalledOnce();
      expect(props.onSelect).not.toHaveBeenCalled();
      expect(props.onSelectBrowser).not.toHaveBeenCalled();
      expect(props.onClose).not.toHaveBeenCalled();
      expect(props.onCloseBrowser).not.toHaveBeenCalled();
    },
  );

  it("hides combine actions in a single pane and omits unavailable Picture in Picture", async () => {
    await render({
      paneLocal: true,
      visibleIds: ["a"],
      combineTargets: [{ id: "b", label: "right pane" }],
      onCombineWith: vi.fn(),
      onUnsplit: vi.fn(),
    });
    await act(async () =>
      container
        .querySelector('[role="tab"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true }),
        ),
    );
    const labels = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    ).map((item) => item.textContent);
    expect(labels.some((label) => label?.startsWith("Combine"))).toBe(false);
    expect(labels).not.toContain("Picture in Picture");
  });

  it.each(["session", "browser"])(
    "allows a lone %s tab to leave its pane without scrolling back on drag end",
    async (kind) => {
      const browser = kind === "browser";
      const id = browser ? "web-a" : "a";
      const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
      await render({
        paneLocal: true,
        tabs: browser ? [] : [tab({ id })],
        browserTabs: browser ? [{ id, title: "Preview" }] : [],
        activeId: id,
        onSurfaceDragEnd: vi.fn().mockReturnValue(true),
      });
      scroll.mockClear();
      const item = container.querySelector<HTMLElement>(
        `[data-surface-tab-id="${id}"]`,
      )!;
      item.setPointerCapture = vi.fn();
      item.releasePointerCapture = vi.fn();
      item.getBoundingClientRect = () => new DOMRect(0, 0, 160, 32);
      await act(async () =>
        item.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            pointerId: 1,
            button: 0,
            clientX: 20,
            clientY: 16,
          }),
        ),
      );
      await act(async () =>
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            pointerId: 1,
            button: 0,
            clientX: 200,
            clientY: 120,
          }),
        ),
      );
      await act(async () =>
        window.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            pointerId: 1,
            button: 0,
            clientX: 200,
            clientY: 120,
          }),
        ),
      );
      expect(props.onSurfaceDragEnd).toHaveBeenCalledExactlyOnceWith(
        id,
        200,
        120,
        false,
        { screenX: 0, screenY: 0 },
      );
      expect(scroll).not.toHaveBeenCalled();
    },
  );

  it("does not remeasure overflow for new arrays with unchanged tab content, but scrolls a newly selected tab", async () => {
    await render();
    const strip = container.querySelector<HTMLElement>('[role="tablist"]')!;
    const width = vi.spyOn(strip, "scrollWidth", "get");
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    await render({
      tabs: props.tabs.map((item) => ({ ...item, files: [...item.files] })),
      surfaceOrder: ["a", "b"],
    });
    expect(width).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
    await render({ activeId: "b" });
    expect(scroll).toHaveBeenCalledOnce();
    expect(width).toHaveBeenCalled();
  });

  it("opens the browser from the action immediately after task tabs", async () => {
    await render();
    const strip = container.querySelector('[role="tablist"]')!;
    expect(strip.lastElementChild?.getAttribute("aria-label")).toBe(
      "Open browser",
    );
    expect(
      container.querySelector('[aria-label="Toggle browser preview"]'),
    ).toBeNull();
    await click('[aria-label="Open browser"]');
    expect(props.onSelectBrowser).toHaveBeenCalledOnce();
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it("labels a blank standalone tab New session without exposing its workspace folder name", async () => {
    const cwd =
      "/Users/test/Library/Application Support/com.capi.monocode.personal/projectless-workspaces/work";
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "monocode.projectlessWorkspaces.v1"
          ? JSON.stringify({ work: cwd })
          : null,
    });
    await render({
      cwd,
      tabs: [tab({ id: "a", project: "work", blank: true })],
    });
    const button = container.querySelector('[role="tab"]')!;
    expect(button.getAttribute("aria-label")).toBe("New session");
    expect(button.getAttribute("title")).toBe("New session");
  });

  it("marks only the browser selected and restores task selection when it loses focus", async () => {
    await render({
      browserOpen: true,
      browserActive: true,
      browserTitle: "Local preview",
    });
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs.map((button) => button.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
    ]);
    expect(tabs.at(-1)?.textContent).toBe("Local preview");
    await click('[aria-label="Browser: Local preview"]');
    expect(props.onSelectBrowser).toHaveBeenCalledOnce();
    await render({ browserActive: false });
    expect(tabs.map((button) => button.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
    ]);
  });

  it("keeps browser close separate from task selection, close, and reorder", async () => {
    await render({ browserOpen: true });
    await click('[aria-label="Close browser"]');
    expect(props.onCloseBrowser).toHaveBeenCalledOnce();
    expect(props.onSelectBrowser).not.toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it("switches browser layout without invoking task actions", async () => {
    await render({ browserOpen: true, browserMode: "tab" });
    await click('button[aria-label="Browser layout"]');
    const menu = document.querySelector(
      '[role="menu"][aria-label="Browser layout"]',
    )!;
    const items = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'),
    );
    expect(
      items.map((item) => [
        item.textContent,
        item.getAttribute("aria-checked"),
      ]),
    ).toEqual([
      ["Show beside session", "false"],
      ["Show as tab", "true"],
    ]);
    await act(async () => items[0].click());
    expect(props.onBrowserModeChange).toHaveBeenCalledExactlyOnceWith("split");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onSelectBrowser).not.toHaveBeenCalled();
    await render({ browserMode: "split" });
    await click('button[aria-label="Browser layout"]');
    const tabOption = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'),
    ).find((item) => item.textContent === "Show as tab")!;
    await act(async () => tabOption.click());
    expect(props.onBrowserModeChange).toHaveBeenLastCalledWith("tab");
  });

  it("leaves browser out of task close-to-the-right actions", async () => {
    await render({ browserOpen: true });
    await act(async () => {
      container.querySelector(".personal-title-tab")!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    const right = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent === "Close Tabs to the Right")!;
    await act(async () => right.click());
    expect(props.onCloseMany).toHaveBeenCalledExactlyOnceWith(["b"], "a");
    expect(props.onCloseBrowser).not.toHaveBeenCalled();
  });

  it("includes the browser in keyboard navigation without starting task dragging", async () => {
    await render({ browserOpen: true });
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    await act(async () => {
      tabs[1].focus();
      tabs[1].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(tabs[2]);
    expect(props.onSelectBrowser).toHaveBeenCalledOnce();
    expect(props.onReorder).not.toHaveBeenCalled();
  });
  it("uses one saved order and distinguishes focused from visible split tabs", async () => {
    await render({
      browserTabs: [
        { id: "web-a", title: "Preview" },
        { id: "web-b", title: "Docs" },
      ],
      surfaceOrder: ["web-b", "a", "web-a", "b"],
      activeId: "web-a",
      visibleIds: ["a", "web-a"],
      onNewBrowser: vi.fn(),
    });
    expect(
      Array.from(container.querySelectorAll("[data-surface-id]")).map((item) =>
        item.getAttribute("data-surface-id"),
      ),
    ).toEqual(["web-b", "a", "web-a", "b"]);
    const selected = container.querySelectorAll(
      '[role="tab"][aria-selected="true"]',
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("aria-label")).toBe("Browser: Preview");
    expect(
      container
        .querySelector('[data-surface-id="a"] [role="tab"]')
        ?.getAttribute("aria-description"),
    ).toBe("Visible in split");
    expect(
      container
        .querySelector('[data-surface-id="web-b"] [role="tab"]')
        ?.hasAttribute("aria-description"),
    ).toBe(false);
    await click('[aria-label="New browser tab"]');
    expect(props.onNewBrowser).toHaveBeenCalledOnce();
    await click('[aria-label="Close browser: Docs"]');
    expect(props.onCloseBrowser).toHaveBeenCalledExactlyOnceWith("web-b");
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onSelectBrowser).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("offers keyboard-accessible split and focus actions without selecting the dragged candidate", async () => {
    await render({
      browserTabs: [{ id: "web-a", title: "Preview" }],
      activeId: "a",
      visibleIds: ["a", "b"],
      onSplitTab: vi.fn(),
      onUnsplit: vi.fn(),
    });
    const browser = container.querySelector('[aria-label="Browser: Preview"]')!;
    const openMenu = async () =>
      act(async () =>
        browser.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "F10",
            shiftKey: true,
            bubbles: true,
          }),
        ),
      );
    const menuAction = async (label: string) => {
      const button = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ).find((item) => item.textContent === label)!;
      expect(button).not.toBeUndefined();
      await act(async () => button.click());
    };
    await openMenu();
    expect(props.onSelectBrowser).not.toHaveBeenCalled();
    await menuAction("Split right of current tab");
    expect(props.onSplitTab).toHaveBeenCalledExactlyOnceWith(
      "web-a",
      "right",
      "a",
    );
    await openMenu();
    await menuAction("Focus this tab");
    expect(props.onSelectBrowser).toHaveBeenCalledExactlyOnceWith("web-a");
    await openMenu();
    await menuAction("Return to single view");
    expect(props.onUnsplit).toHaveBeenCalledOnce();
  });

  it("reorders an inactive browser among sessions without first selecting it or consuming the split target", async () => {
    await render({
      browserTabs: [{ id: "web-a", title: "Preview" }],
      surfaceOrder: ["a", "web-a", "b"],
      onReorderSurfaces: vi.fn(),
    });
    const items = Array.from(
      container.querySelectorAll<HTMLElement>("[data-surface-id]"),
    );
    for (const [index, item] of items.entries()) {
      item.getBoundingClientRect = () => new DOMRect(index * 100, 0, 100, 30);
      item.setPointerCapture = vi.fn();
      item.releasePointerCapture = vi.fn();
    }
    container.querySelector<HTMLElement>(
      '[role="tablist"]',
    )!.getBoundingClientRect = () => new DOMRect(0, 0, 300, 30);
    const browser = items[1].querySelector<HTMLButtonElement>('[role="tab"]')!;
    const pointer = async (target: EventTarget, type: string, x: number) =>
      act(async () =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            button: 0,
            clientX: x,
            clientY: 15,
          }),
        ),
      );
    await pointer(browser, "pointerdown", 150);
    expect(props.onSelectBrowser).not.toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
    await pointer(window, "pointermove", 10);
    await pointer(window, "pointerup", 10);
    await act(async () => browser.click());
    expect(props.onReorderSurfaces).toHaveBeenCalledExactlyOnceWith(
      ["web-a", "a", "b"],
      "web-a",
    );
    expect(props.onSelectBrowser).not.toHaveBeenCalled();
    expect(props.onReorder).not.toHaveBeenCalled();
  });
  it("selects the tab after an ordinary captured click lands on its wrapper", async () => {
    await render({ browserTabs: [{ id: "web-a", title: "Preview" }] });
    for (const id of ["b", "web-a"]) {
      const item = container.querySelector<HTMLElement>(
        `[data-surface-id="${id}"]`,
      )!;
      item.setPointerCapture = vi.fn();
      item.releasePointerCapture = vi.fn();
      await act(async () => {
        item.querySelector('[role="tab"]')!.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            pointerId: 1,
            button: 0,
            clientX: 100,
            clientY: 15,
          }),
        );
        item.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            pointerId: 1,
            button: 0,
            clientX: 100,
            clientY: 15,
          }),
        );
        item.click();
      });
    }
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith("b");
    expect(props.onSelectBrowser).toHaveBeenCalledExactlyOnceWith("web-a");
    expect(props.onReorder).not.toHaveBeenCalled();
  });
  it("keeps each tab's provider separate from a mixed-provider group", async () => {
    await render({
      paneLocal: true,
      groupId: "team",
      groupLabel: "Team",
      onMoveGroupToWindow: vi.fn(),
      tabs: [
        tab({ id: "a", harnesses: ["codex"], busyHarnesses: ["codex"] }),
        tab({ id: "b", harnesses: ["claude"] }),
      ],
      activeId: "b",
    });
    const marks = (selector: string) => Array.from(
      container.querySelectorAll(`${selector} .provider-mark`),
      (node) => node.getAttribute("data-provider"),
    );
    expect(marks('[data-surface-tab-id="b"]')).toEqual(["claude"]);
    expect(container.querySelector('[data-surface-tab-id="b"] [data-working="true"]')).toBeNull();
    expect(marks(".personal-tab-group-handle")).toEqual(["codex", "claude"]);
    expect(marks('[data-surface-tab-id="a"]')).toEqual(["codex"]);
    await render({ activeId: "a" });
    expect(marks('[data-surface-tab-id="a"]')).toEqual(["codex"]);
    expect(marks('[data-surface-tab-id="b"]')).toEqual(["claude"]);
  });

  it("retains combined providers for two agent panes inside one tab", async () => {
    await render({
      tabs: [tab({ id: "a", sessionCount: 2, multiPane: true, harnesses: ["claude", "codex"] })],
      activeId: "a",
    });
    expect(Array.from(container.querySelectorAll('[role="tab"] .provider-mark'),
      (node) => node.getAttribute("data-provider"))).toEqual(["claude", "codex"]);
  });

  it("offers precise tab/group window destinations, returns, and history callbacks", async () => {
    await render({
      groupId: "group-owner",
      groupLabel: "Research",
      windowTargets: [{ id: "window-2", label: "Work window" }],
      onMoveTabToWindow: vi.fn(),
      onMoveGroupToWindow: vi.fn(),
      onReturnTabToWindow: vi.fn(),
      onReturnGroupToWindow: vi.fn(),
      onReopenClosedTab: vi.fn(),
      onUndoLayout: vi.fn(),
    });
    const pick = async (label: string) => {
      await act(async () =>
        container
          .querySelector('[role="tab"]')!
          .dispatchEvent(
            new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true }),
          ),
      );
      const item = [
        ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ].find((item) => item.textContent?.startsWith(label));
      expect(item).toBeDefined();
      await act(async () => item!.click());
    };
    await pick("Move tab to new window");
    expect(props.onMoveTabToWindow).toHaveBeenLastCalledWith("a");
    await pick("Move tab to Work window");
    expect(props.onMoveTabToWindow).toHaveBeenLastCalledWith("a", "window-2");
    await pick("Move group to new window");
    expect(props.onMoveGroupToWindow).toHaveBeenLastCalledWith("group-owner");
    await pick("Move group to Work window");
    expect(props.onMoveGroupToWindow).toHaveBeenLastCalledWith(
      "group-owner",
      "window-2",
    );
    await pick("Return tab to original window");
    expect(props.onReturnTabToWindow).toHaveBeenCalledWith("a");
    await pick("Return group to original window");
    expect(props.onReturnGroupToWindow).toHaveBeenCalledWith("group-owner");
    await pick("Reopen closed tab");
    expect(props.onReopenClosedTab).toHaveBeenCalledOnce();
    await pick("Undo layout change");
    expect(props.onUndoLayout).toHaveBeenCalledOnce();
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("moves the group owner from its labeled handle without emitting a single-tab drag", async () => {
    await render({
      groupId: "group-owner",
      groupLabel: "Research",
      onGroupDragMove: vi.fn(),
      onGroupDragEnd: vi.fn(() => true),
      onSurfaceDragEnd: vi.fn(),
    });
    const handle = container.querySelector<HTMLButtonElement>(
      '[aria-label="Move group: Research (2 tabs)"]',
    )!;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    const pointer = (target: EventTarget, type: string, x: number) =>
      act(async () =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            button: 0,
            clientX: x,
            clientY: 15,
            screenX: x + 1000,
            screenY: 220,
          }),
        ),
      );
    await pointer(handle, "pointerdown", 20);
    await pointer(window, "pointermove", 200);
    await pointer(window, "pointerup", 900);
    expect(props.onGroupDragEnd).toHaveBeenCalledExactlyOnceWith(
      "group-owner",
      900,
      15,
      false,
      { screenX: 1900, screenY: 220 },
    );
    expect(props.onSurfaceDragEnd).not.toHaveBeenCalled();
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it("keeps reopen and layout undo discoverable on an empty tab strip", async () => {
    await render({
      tabs: [],
      browserTabs: [],
      activeId: "",
      onReopenClosedTab: vi.fn(),
      onUndoLayout: vi.fn(),
      canUndoLayout: false,
    });
    await act(async () =>
      container.querySelector("header")!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 50,
          clientY: 10,
        }),
      ),
    );
    const items = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ];
    expect(
      items.find((item) => item.textContent?.includes("Undo layout change"))
        ?.disabled,
    ).toBe(true);
    await act(async () =>
      items
        .find((item) => item.textContent?.includes("Reopen closed tab"))!
        .click(),
    );
    expect(props.onReopenClosedTab).toHaveBeenCalledOnce();
  });
});
