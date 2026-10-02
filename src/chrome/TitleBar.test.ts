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
  getName: vi.fn().mockResolvedValue("Aven"),
  startDragging: vi.fn().mockResolvedValue(undefined),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/app", () => ({ getName: nativeWindow.getName }));
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
  it("keeps the task name when focus moves between its conversation and file panes", () => {
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
    expect(focusedFile).toEqual(focusedSession);
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

  it.each([
    { files: ["App.tsx"], terminal: false },
    { files: ["Changes"], terminal: false },
    { files: ["npm run dev"], terminal: true },
  ])("keeps $files as the name when there is no task", (details) => {
    const copy = tabCopy(
      tab({
        ...details,
        title: "",
        sessionCount: 0,
        fileFocused: true,
      }),
    );
    expect(copy.headline).toBe(details.files[0]);
    expect(copy.meta).toBe("");
    expect(copy.tooltip).toBe(`agent-terminal · ${details.files[0]}`);
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
    nativeWindow.getName.mockReset().mockResolvedValue("Aven");
    nativeWindow.startDragging.mockReset().mockResolvedValue(undefined);
    nativeWindow.toggleMaximize.mockReset().mockResolvedValue(undefined);
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

  const surfaceTabButton = (id: string) =>
    container.querySelector<HTMLButtonElement>(
      `[data-surface-tab-id="${id}"] [role="tab"]`,
    )!;

  async function keydown(
    node: HTMLElement,
    key: string,
    options: KeyboardEventInit = {},
  ) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      ...options,
    });
    await act(async () => node.dispatchEvent(event));
    return event;
  }

  async function mouseDown(target: Element, button = 0, detail = 1) {
    const event = new MouseEvent("mousedown", {
      button,
      detail,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => target.dispatchEvent(event));
    return event;
  }

  it("uses one browser preview while retaining every page in Recent", async () => {
    const pages = [
      { id: "web-1", title: "First page" },
      { id: "web-2", title: "Second page" },
      { id: "web-3", title: "Third page" },
    ];
    await render({
      browserTabs: pages,
      activeId: "web-3",
      onKeepBrowser: vi.fn(),
    });
    const ids = () =>
      Array.from(container.querySelectorAll("[data-surface-id]")).map((node) =>
        node.getAttribute("data-surface-id"),
      );
    expect(ids()).toEqual(["a", "b", "web-3"]);
    expect(
      container
        .querySelector('[data-surface-id="web-3"]')
        ?.getAttribute("data-preview"),
    ).toBe("true");
    await click('[aria-label="Recent browser tabs"]');
    const first = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]'),
    ).find((node) => node.textContent?.includes("First page"));
    expect(first).toBeDefined();
    await act(async () => first!.click());
    expect(props.onSelectBrowser).toHaveBeenCalledWith("web-1");
    expect(props.onCloseBrowser).not.toHaveBeenCalled();
    await render({ activeId: "web-1" });
    expect(ids()).toEqual(["a", "b", "web-1"]);
    expect(pages).toHaveLength(3);
  });

  it("keeps a preview without resurrecting hidden pages and retains it on the next open", async () => {
    const pages = [
      { id: "web-1", title: "Old page" },
      { id: "web-2", title: "Current page" },
    ];
    await render({
      browserTabs: pages,
      activeId: "web-2",
      onKeepBrowser: vi.fn(),
    });
    await click('[aria-label="Keep browser open"]');
    expect(props.onKeepBrowser).toHaveBeenCalledExactlyOnceWith("web-2");
    const kept = [pages[0], { ...pages[1], kept: true }];
    await render({ browserTabs: kept });
    expect(container.querySelector('[data-surface-id="web-1"]')).toBeNull();
    expect(
      container.querySelector('[aria-label="Keep browser open"]'),
    ).toBeNull();
    await render({
      browserTabs: [...kept, { id: "web-3", title: "Next page" }],
      activeId: "web-3",
    });
    expect(container.querySelector('[data-surface-id="web-2"]')).not.toBeNull();
    expect(
      container
        .querySelector('[data-surface-id="web-3"]')
        ?.getAttribute("data-preview"),
    ).toBe("true");
    expect(props.onCloseBrowser).not.toHaveBeenCalled();
  });

  it("retains the same preview when returning to a conversation", async () => {
    await render({
      browserTabs: [
        { id: "web-1", title: "Earlier page" },
        { id: "web-2", title: "Later page" },
      ],
      activeId: "web-1",
      onKeepBrowser: vi.fn(),
    });
    await render({ activeId: "a" });
    expect(container.querySelector('[data-surface-id="web-1"]')).not.toBeNull();
    expect(container.querySelector('[data-surface-id="web-2"]')).toBeNull();
  });

  it("keeps a browser by double-clicking its preview tab", async () => {
    await render({
      browserTabs: [{ id: "web-1", title: "Page" }],
      activeId: "web-1",
      onKeepBrowser: vi.fn(),
    });
    const item = container.querySelector('[data-surface-id="web-1"]')!;
    await act(async () =>
      item.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    expect(props.onKeepBrowser).toHaveBeenCalledExactlyOnceWith("web-1");
    expect(props.onCloseBrowser).not.toHaveBeenCalled();
  });

  it("does not resurrect a hidden page after Keep and a header remount", async () => {
    const pages = [{ id: "web-1", title: "Older page" }, { id: "web-2", title: "Kept page", kept: true }];
    for (const activeId of ["web-2", "a"]) {
      await act(async () => root.unmount());
      root = createRoot(container);
      await render({ browserTabs: pages, activeId, browserPreviewId: "web-2", onKeepBrowser: vi.fn() });
      expect(container.querySelector('[data-surface-id="web-1"]')).toBeNull();
      expect(container.querySelector('[data-surface-id="web-2"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="Recent browser tabs"]')).not.toBeNull();
    }
  });

  it("restores the selected preview hint while its conversation has focus", async () => {
    await render({ browserTabs: [{ id: "web-1", title: "Earlier page" }, { id: "web-2", title: "Later page" }], activeId: "a", browserPreviewId: "web-1", onKeepBrowser: vi.fn() });
    expect(container.querySelector('[data-surface-id="web-1"]')).not.toBeNull();
    expect(container.querySelector('[data-surface-id="web-2"]')).toBeNull();
  });

  it("ignores a remembered preview belonging to another group", async () => {
    await render({
      browserTabs: [{ id: "web-1", title: "Hidden page" }],
      activeId: "a",
      browserPreviewId: "another-group-page",
      onKeepBrowser: vi.fn(),
    });
    expect(container.querySelector('[data-surface-id="web-1"]')).toBeNull();
    expect(container.querySelector('[aria-label="Recent browser tabs"]')).not.toBeNull();
    await render({ activeId: "web-1" });
    expect(container.querySelector('[data-surface-id="web-1"]')).not.toBeNull();
  });

  it("updates untitled labels and titled model tooltips when the live model catalog arrives", async () => {
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
    expect(second.querySelector(".personal-title-tab-meta")).toBeNull();
    expect(second.querySelector('[role="tab"]')?.getAttribute("title")).toContain(
      "Repair tabs · QA Model 2",
    );
    expect(
      second.querySelector('[role="tab"]')?.getAttribute("aria-label"),
    ).toContain("Repair tabs · QA Model 2");
    await click('[aria-label="Close QA Model 2"]');
    expect(props.onClose).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("keeps a task's visible name and close action stable while its active file changes", async () => {
    const task = tab({
      id: "a",
      title: "Refine sidebar",
      multiPane: true,
      harnesses: ["codex"],
      busyHarnesses: ["codex"],
      models: [{ harness: "codex", model: "working-model" }],
      files: ["SKILL.md", "README.md"],
      dirty: true,
    });
    await render({ paneLocal: true, tabs: [task] });
    const current = () => container.querySelector('[role="tab"]')!;
    const headline = () =>
      current().querySelector(".personal-title-tab-label")?.textContent;
    expect(headline()).toBe("Refine sidebar");

    await render({ tabs: [{ ...task, fileFocused: true }] });
    expect(headline()).toBe("Refine sidebar");
    await render({
      tabs: [{ ...task, fileFocused: true, files: ["README.md", "SKILL.md"] }],
    });
    expect(headline()).toBe("Refine sidebar");
    expect(current().getAttribute("aria-label")).toBe(
      "agent-terminal · Refine sidebar · working-model · README.md, SKILL.md · Unsaved changes",
    );
    expect(current().getAttribute("title")).toBe(
      current().getAttribute("aria-label"),
    );
    expect(
      current().querySelector('[aria-label="Unsaved changes"]'),
    ).not.toBeNull();
    expect(
      current().querySelector('.provider-mark[data-provider="codex"]'),
    ).not.toBeNull();
    await click('[role="tab"]');
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith("a");
    await click('[aria-label="Close Refine sidebar"]');
    expect(props.onClose).toHaveBeenCalledExactlyOnceWith("a");
    expect(props.onSelect).toHaveBeenCalledOnce();
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

  it("preserves Aven Dev identity when project and file titles change", async () => {
    let resolveName!: (name: string) => void;
    nativeWindow.getName.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveName = resolve;
        }),
    );
    document.title = "Aven Dev";
    await render({
      cwd: "/projects/demo",
      tabs: [tab({ id: "a", project: "demo" })],
    });
    expect(nativeWindow.setTitle).not.toHaveBeenCalled();
    expect(document.title).toBe("Aven Dev");

    await act(async () => resolveName("Aven Dev"));
    expect(document.title).toBe("demo — Aven Dev");
    await render({
      tabs: [
        tab({ id: "a", project: "demo", files: ["/projects/demo/App.tsx"] }),
      ],
    });
    expect(nativeWindow.setTitle).toHaveBeenLastCalledWith(
      "App.tsx — demo — Aven Dev",
    );
    expect(nativeWindow.getName).toHaveBeenCalledOnce();
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
    "offers pane combine actions for a %s without selecting or closing it",
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
      const openSplit = async () => {
        await openMenu();
        const page = menuItems().find((item) =>
          item.textContent?.startsWith("Split"),
        );
        expect(page).toBeDefined();
        await act(async () => page!.click());
      };
      await openSplit();
      const labels = menuItems().map((item) => item.textContent);
      expect(labels.filter((label) => label?.startsWith("Combine"))).toEqual([
        "Combine with right pane",
        "Combine all tabs",
      ]);
      expect(labels).not.toContain("Return to single view");
      await pick("Combine with right pane");
      expect(props.onCombineWith).toHaveBeenCalledExactlyOnceWith("other");
      await openSplit();
      await pick("Combine all tabs");
      expect(props.onUnsplit).toHaveBeenCalledOnce();
      expect(labels).not.toContain("Picture in Picture");
      expect(props.onSelect).not.toHaveBeenCalled();
      expect(props.onSelectBrowser).not.toHaveBeenCalled();
      expect(props.onClose).not.toHaveBeenCalled();
      expect(props.onCloseBrowser).not.toHaveBeenCalled();
    },
  );

  it("hides combine actions in a single pane", async () => {
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
  });

  describe("MonoCode-style tabs", () => {
    const aux = (target: Element, button: number) =>
      act(async () => {
        target.dispatchEvent(
          new MouseEvent("auxclick", { button, bubbles: true, cancelable: true }),
        );
      });

    it("closes a session or browser tab with a middle click, but not a lone blank session", async () => {
      await render({
        browserTabs: [{ id: "web-a", title: "Preview" }],
        onCloseBrowser: vi.fn(),
      });
      await aux(container.querySelector('[data-surface-tab-id="b"]')!, 1);
      expect(props.onClose).toHaveBeenCalledExactlyOnceWith("b");
      await aux(container.querySelector('[data-surface-tab-id="web-a"]')!, 1);
      expect(props.onCloseBrowser).toHaveBeenCalledOnce();
      // Other auxiliary buttons do nothing.
      await aux(container.querySelector('[data-surface-tab-id="a"]')!, 2);
      expect(props.onClose).toHaveBeenCalledOnce();

      await render({
        tabs: [tab({ id: "only", blank: true })],
        activeId: "only",
        browserTabs: [],
      });
      await aux(container.querySelector('[data-surface-tab-id="only"]')!, 1);
      expect(props.onClose).toHaveBeenCalledOnce();
    });

    it("keeps active session titles on one line with model details in the tooltip", async () => {
      await render({
        tabs: [
          tab({ id: "a", title: "Busy task", models: [{ harness: "claude", model: "claude-opus-5-5" }] as never }),
          tab({ id: "b", title: "Plain task" }),
        ],
        activeId: "a",
      });
      const root = (id: string) =>
        container.querySelector<HTMLElement>(`[data-surface-tab-id="${id}"]`)!;
      expect(root("a").dataset.active).toBe("true");
      expect(root("a").dataset.hasMeta).toBeUndefined();
      expect(root("b").dataset.hasMeta).toBeUndefined();
      const label = root("a").querySelector(".personal-title-tab-label")!;
      expect(label.textContent).toBe("Busy task");
      // The base title size remains stable when a tab is selected or resized.
      expect(label.className).toContain("text-[13px]");
      expect(label.className).not.toMatch(/@min-/);
      expect(root("a").querySelector(".personal-title-tab-meta")).toBeNull();
      const control = root("a").querySelector('[role="tab"]')!;
      expect(control.getAttribute("title")).toContain("Claude Opus 5.5");
      expect(control.getAttribute("aria-label")).toBe(
        control.getAttribute("title"),
      );
    });
  });

  describe("user tab groups", () => {
    beforeEach(() => {
      const values = new Map<string, string>();
      vi.stubGlobal("localStorage", {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
      });
    });

    const menuItem = (prefix: string) =>
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]',
        ),
      ).find((item) => item.textContent?.startsWith(prefix));
    const choose = async (...path: string[]) => {
      for (const label of path) {
        const item = menuItem(label);
        expect(item, label).toBeDefined();
        await act(async () => item!.click());
      }
    };
    const openTabMenu = (id: string) =>
      act(async () =>
        container
          .querySelector(`[data-surface-tab-id="${id}"] [role="tab"]`)!
          .dispatchEvent(
            new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true }),
          ),
      );
    const label = () =>
      container.querySelector<HTMLButtonElement>(".personal-tab-group-chip");
    const drawn = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          "[data-surface-id], .personal-tab-group-chip",
        ),
      ).map((node) =>
        node.classList.contains("personal-tab-group-chip")
          ? `[${node.textContent}]`
          : node.getAttribute("data-surface-id"),
      );

    async function makeGroup(id: string, name: string) {
      await openTabMenu(id);
      await choose("Add to new group");
      const input = container.querySelector<HTMLInputElement>(
        '[aria-label="Group name"]',
      )!;
      expect(input).not.toBeNull();
      input.value = name;
      await act(async () =>
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
      );
    }

    it("names a new group and shows ungrouped tabs without a label", async () => {
      await render({
        tabs: [tab({ id: "a" }), tab({ id: "b" }), tab({ id: "c" })],
      });
      expect(label()).toBeNull();
      await makeGroup("b", "Research");
      expect(drawn()).toEqual(["a", "[Research]", "b", "c"]);
      expect(
        container.querySelector('[data-surface-tab-id="b"]')!.parentElement!
          .dataset.tabGroup,
      ).toBe("end");
      expect(
        container.querySelector('[data-surface-tab-id="a"]')!.parentElement!
          .dataset.tabGroup,
      ).toBeUndefined();
    });

    it("folds to just the label with a count and moves off a folding tab", async () => {
      await render({
        tabs: [tab({ id: "a" }), tab({ id: "b" }), tab({ id: "c" })],
        browserTabs: [{ id: "web-a", title: "Docs" }],
        surfaceOrder: ["a", "b", "web-a", "c"],
        activeId: "a",
      });
      await makeGroup("b", "Docs");
      await openTabMenu("web-a");
      await choose("Add to group", "Docs");
      expect(drawn()).toEqual(["a", "[Docs]", "b", "web-a", "c"]);
      // One unbroken underline: b bridges to web-a, which ends the group.
      expect(
        container.querySelector<HTMLElement>('[data-surface-tab-id="b"]')!
          .parentElement!.dataset.tabGroup,
      ).toBe("run");
      expect(
        container.querySelector<HTMLElement>('[data-surface-tab-id="web-a"]')!
          .dataset.tabGroup,
      ).toBe("end");
      expect(label()!.getAttribute("aria-expanded")).toBe("true");
      await act(async () => label()!.click());
      expect(drawn()).toEqual(["a", "[Docs2]", "c"]);
      expect(label()!.getAttribute("aria-label")).toBe("Docs, 2 tabs, folded");
      expect(props.onSelect).not.toHaveBeenCalled();

      // Folding the group you are in selects the nearest visible tab.
      await act(async () => label()!.click());
      await render({ activeId: "b" });
      expect(drawn()).toEqual(["a", "[Docs]", "b", "web-a", "c"]);
      await act(async () => label()!.click());
      expect(props.onSelect).toHaveBeenLastCalledWith("c");
      await render({ activeId: "c" });
      expect(drawn()).toEqual(["a", "[Docs2]", "c"]);

      // Opening a folded tab from elsewhere unfolds its group.
      await render({ activeId: "b" });
      expect(drawn()).toEqual(["a", "[Docs]", "b", "web-a", "c"]);
    });

    it("folds from a real press, where pointer capture delivers the click to the label's slot", async () => {
      await render({ tabs: [tab({ id: "a" }), tab({ id: "b" })], activeId: "a" });
      await makeGroup("b", "QA");
      const slot = label()!.closest<HTMLElement>(".personal-tab-group-slot")!;
      slot.setPointerCapture = vi.fn();
      slot.releasePointerCapture = vi.fn();
      const pointer = (target: EventTarget, type: string) =>
        act(async () =>
          target.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerId: 1,
              button: 0,
              clientX: 10,
              clientY: 10,
            }),
          ),
        );
      await pointer(label()!, "pointerdown");
      expect(slot.setPointerCapture).toHaveBeenCalled();
      await pointer(window, "pointerup");
      // The browser targets the capturing slot, not the button inside it.
      await act(async () =>
        slot.dispatchEvent(new MouseEvent("click", { bubbles: true })),
      );
      expect(drawn()).toEqual(["a", "[QA1]"]);
      await act(async () =>
        slot.dispatchEvent(new MouseEvent("click", { bubbles: true })),
      );
      expect(drawn()).toEqual(["a", "[QA]", "b"]);
    });

    it("still folds when every tab in the strip belongs to the group", async () => {
      await render({ tabs: [tab({ id: "a" }), tab({ id: "b" })], activeId: "a" });
      await makeGroup("a", "All");
      await openTabMenu("b");
      await choose("Add to group", "All");
      await act(async () => label()!.click());
      expect(drawn()).toEqual(["[All2]"]);
      expect(props.onSelect).not.toHaveBeenCalled();
    });

    it("preserves group controls and skips folded members during keyboard navigation", async () => {
      await render({
        tabs: [tab({ id: "a" }), tab({ id: "b" }), tab({ id: "c" })],
      });
      await makeGroup("b", "Research");
      label()!.focus();
      expect((await keydown(label()!, "ArrowRight")).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(label());
      await keydown(label()!, "F2");
      const input = container.querySelector<HTMLInputElement>(
        '[aria-label="Group name"]',
      )!;
      expect(document.activeElement).toBe(input);
      expect((await keydown(input, "Home")).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(input);
      await keydown(input, "Escape");
      surfaceTabButton("b").focus();
      await act(async () => label()!.click());
      expect(surfaceTabButton("b")).toBeNull();
      expect(document.activeElement).toBe(surfaceTabButton("a"));
      await keydown(surfaceTabButton("a"), "ArrowRight");
      expect(document.activeElement).toBe(surfaceTabButton("c"));
      expect(props.onSelect).toHaveBeenCalledExactlyOnceWith("c");
    });

    it("recolours, removes a member, and ungroups from the label menu", async () => {
      await render({
        tabs: [tab({ id: "a" }), tab({ id: "b" }), tab({ id: "c" })],
      });
      await makeGroup("a", "Race");
      await openTabMenu("b");
      await choose("Add to group", "Race");
      const openLabelMenu = () =>
        act(async () =>
          label()!.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true }),
          ),
        );
      await openLabelMenu();
      await choose("Colour", "Green");
      expect(
        (label()!.closest(".personal-tab-group-slot") as HTMLElement).style
          .getPropertyValue("--tab-group-color"),
      ).toBe("hsl(142 55% 50%)");
      await openTabMenu("a");
      await choose("Remove from group");
      expect(drawn()).toEqual(["a", "[Race]", "b", "c"]);
      await openLabelMenu();
      await choose("Ungroup");
      expect(label()).toBeNull();
      expect(drawn()).toEqual(["a", "b", "c"]);
    });

    it("moves a group to a window and closes it with a fallback tab", async () => {
      const onMoveTabsToWindow = vi.fn();
      await render({
        tabs: [tab({ id: "a" }), tab({ id: "b" }), tab({ id: "c" })],
        windowTargets: [{ id: "window-2", label: "Work window" }],
        onMoveTabsToWindow,
      });
      await makeGroup("b", "Move me");
      await openTabMenu("c");
      await choose("Add to group", "Move me");
      const openLabelMenu = () =>
        act(async () =>
          label()!.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true }),
          ),
        );
      await openLabelMenu();
      await choose("Move group to", "Work window");
      expect(onMoveTabsToWindow).toHaveBeenCalledExactlyOnceWith(
        ["b", "c"],
        "window-2",
      );
      await openLabelMenu();
      await choose("Close group");
      expect(props.onCloseMany).toHaveBeenCalledExactlyOnceWith(["b", "c"], "a");
      expect(label()).toBeNull();
    });

    it("joins a group when a tab is dropped right after its label", async () => {
      await render({
        tabs: [tab({ id: "a" }), tab({ id: "b" }), tab({ id: "c" })],
        onReorderSurfaces: vi.fn(),
      });
      await makeGroup("b", "G");
      // Strip: a, [G], b, c — drag c between the label and b.
      const nodes = [
        container.querySelector<HTMLElement>('[data-surface-tab-id="a"]')!,
        label()!.closest<HTMLElement>(".personal-tab-group-slot")!,
        container.querySelector<HTMLElement>('[data-surface-tab-id="b"]')!,
        container.querySelector<HTMLElement>('[data-surface-tab-id="c"]')!,
      ];
      for (const [index, node] of nodes.entries()) {
        node.getBoundingClientRect = () => new DOMRect(index * 100, 0, 100, 30);
        node.setPointerCapture = vi.fn();
        node.releasePointerCapture = vi.fn();
      }
      container.querySelector<HTMLElement>(
        '[role="tablist"]',
      )!.getBoundingClientRect = () => new DOMRect(0, 0, 400, 30);
      const handle = nodes[3].querySelector<HTMLElement>('[role="tab"]')!;
      const pointer = (target: EventTarget, type: string, x: number) =>
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
      await pointer(handle, "pointerdown", 350);
      await pointer(window, "pointermove", 220);
      await pointer(window, "pointerup", 220);
      expect(props.onReorderSurfaces).toHaveBeenCalledExactlyOnceWith(
        ["a", "c", "b"],
        "c",
      );
      await render({ surfaceOrder: ["a", "c", "b"] });
      expect(drawn()).toEqual(["a", "[G]", "c", "b"]);
    });
  });

  describe("persistent tab titles", () => {
    beforeEach(() => {
      const values = new Map([["aven.minimizedTabs", "1"]]);
      vi.stubGlobal("localStorage", {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
      });
    });

    it.each([false, true])(
      "ignores the old minimized preference and retains titles and tooltips (pane-local=%s)",
      async (paneLocal) => {
        await render({
          paneLocal,
          browserTabs: [
            { id: "web-a", title: "Preview", url: "http://localhost:5173/" },
          ],
          browserPreviewId: "web-a",
          onKeepBrowser: vi.fn(),
        });
        for (const [id, title] of [
          ["a", "First task"],
          ["b", "Second task"],
          ["web-a", "Preview"],
        ]) {
          const button = surfaceTabButton(id);
          expect(
            button.querySelector(".personal-title-tab-label")?.textContent,
          ).toBe(title);
          expect(button.title).toContain(title);
        }
        expect(container.querySelector("[data-minimized]")).toBeNull();
        expect(
          surfaceTabButton("web-a").getAttribute("aria-description"),
        ).toContain("Preview tab");
      },
    );

    it("omits the removed option from strip, task and browser menus", async () => {
      await render({
        paneLocal: true,
        browserTabs: [{ id: "web-a", title: "Preview" }],
      });
      const targets: Array<[HTMLElement, string]> = [
        [
          container.querySelector<HTMLElement>('[role="tablist"]')!,
          "New session",
        ],
        [surfaceTabButton("a"), "Close tab"],
        [surfaceTabButton("web-a"), "Close browser"],
      ];
      for (const [target, preservedAction] of targets) {
        await keydown(target, "ContextMenu");
        const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
        expect(menu).not.toBeNull();
        expect(menu.textContent).toContain(preservedAction);
        expect(menu.textContent).not.toContain("Minimized tabs");
        await keydown(menu, "Escape");
      }
    });
  });

  it("names a race tab once and opens its overview on request", async () => {
    await render({
      paneLocal: true,
      tabs: [
        tab({
          id: "race",
          title: "Try new tab designs",
          harnesses: ["claude", "codex"],
          race: true,
        }),
      ],
      activeId: "race",
      onOpenRaceOverview: vi.fn(),
    });
    expect(
      container.querySelector(".personal-title-tab-race"),
    ).not.toBeNull();
    await act(async () =>
      container.querySelector('[role="tab"]')!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true }),
      ),
    );
    const overview = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent === "Open race overview")!;
    expect(overview).toBeDefined();
    await act(async () => overview.click());
    expect(props.onOpenRaceOverview).toHaveBeenCalledExactlyOnceWith("race");
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
    const item = (prefix: string) =>
      Array.from(
        document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ).find((entry) => entry.textContent?.startsWith(prefix))!;
    await act(async () => item("Close others").click());
    await act(async () => item("Close tabs to the right").click());
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

  it("roves across mixed tabs in visual order and limits close and menu tab stops", async () => {
    const select = (id?: string) => {
      props = { ...props, activeId: id! };
      root.render(createElement(TitleBar, props));
    };
    await render({
      browserTabs: [{ id: "web-a", title: "Docs" }],
      surfaceOrder: ["a", "web-a", "b"],
      onSelect: vi.fn(select),
      onSelectBrowser: vi.fn(select),
    });
    const buttons = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(buttons().map((node) => node.tabIndex)).toEqual([0, -1, -1]);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Close First task"]',
      )!.tabIndex,
    ).toBe(0);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Close Second task"]',
      )!.tabIndex,
    ).toBe(-1);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Close browser: Docs"]',
      )!.tabIndex,
    ).toBe(-1);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Browser layout: Docs"]',
      )!.tabIndex,
    ).toBe(-1);

    surfaceTabButton("a").focus();
    expect(
      (await keydown(surfaceTabButton("a"), "ArrowRight")).defaultPrevented,
    ).toBe(true);
    expect(document.activeElement).toBe(surfaceTabButton("web-a"));
    expect(props.onSelectBrowser).toHaveBeenCalledExactlyOnceWith("web-a");
    expect(buttons().map((node) => node.tabIndex)).toEqual([-1, 0, -1]);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Close browser: Docs"]',
      )!.tabIndex,
    ).toBe(0);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Browser layout: Docs"]',
      )!.tabIndex,
    ).toBe(0);
    await keydown(surfaceTabButton("web-a"), "End");
    expect(document.activeElement).toBe(surfaceTabButton("b"));
    await keydown(surfaceTabButton("b"), "ArrowRight");
    expect(document.activeElement).toBe(surfaceTabButton("a"));
    await keydown(surfaceTabButton("a"), "ArrowLeft");
    expect(document.activeElement).toBe(surfaceTabButton("b"));
    await keydown(surfaceTabButton("b"), "Home");
    expect(document.activeElement).toBe(surfaceTabButton("a"));
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it("preserves modified shortcuts and arrow keys on close and layout controls", async () => {
    await render({ browserTabs: [{ id: "web-a", title: "Docs" }] });
    for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) {
      expect(
        (await keydown(surfaceTabButton("a"), "End", { [modifier]: true }))
          .defaultPrevented,
      ).toBe(false);
    }
    for (const label of [
      "Close First task",
      "Close browser: Docs",
      "Browser layout: Docs",
    ]) {
      const control = container.querySelector<HTMLButtonElement>(
        `[aria-label="${label}"]`,
      )!;
      control.focus();
      expect((await keydown(control, "ArrowLeft")).defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(control);
    }
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onSelectBrowser).not.toHaveBeenCalled();
  });

  it("restores focus when a closed task or browser removes its focused control", async () => {
    await render({ browserTabs: [{ id: "web-a", title: "Docs" }] });
    const close = container.querySelector<HTMLButtonElement>(
      '[aria-label="Close First task"]',
    )!;
    close.focus();
    await click('[aria-label="Close First task"]');
    expect(props.onClose).toHaveBeenCalledExactlyOnceWith("a");
    // The close callback may defer or decline removal.
    await render();
    expect(document.activeElement).toBe(close);
    await render({
      tabs: [tab({ id: "b", title: "Second task" })],
      activeId: "web-a",
    });
    expect(document.activeElement).toBe(surfaceTabButton("web-a"));
    container
      .querySelector<HTMLButtonElement>('[aria-label="Close browser: Docs"]')!
      .focus();
    await click('[aria-label="Close browser: Docs"]');
    await render({ browserTabs: [], activeId: "b" });
    expect(document.activeElement).toBe(surfaceTabButton("b"));
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onSelectBrowser).not.toHaveBeenCalled();
  });

  it("restores focus when a preview is replaced without touching hidden recent pages", async () => {
    await render({
      browserTabs: [
        { id: "web-a", title: "Docs" },
        { id: "web-b", title: "Preview" },
      ],
      activeId: "web-a",
      onKeepBrowser: vi.fn(),
    });
    surfaceTabButton("web-a").focus();
    await render({ activeId: "web-b" });
    expect(surfaceTabButton("web-a")).toBeNull();
    expect(document.activeElement).toBe(surfaceTabButton("web-b"));
    expect(props.onCloseBrowser).not.toHaveBeenCalled();
    expect(props.onKeepBrowser).not.toHaveBeenCalled();
  });

  it("does not reclaim focus from an editor or after an intentional blur", async () => {
    await render();
    const input = document.createElement("input");
    document.body.append(input);
    try {
      surfaceTabButton("a").focus();
      input.focus();
      await render({ tabs: [tab({ id: "b" })], activeId: "b" });
      expect(document.activeElement).toBe(input);
      surfaceTabButton("b").focus();
      surfaceTabButton("b").blur();
      await render({ tabs: [], activeId: "" });
      expect(document.activeElement).toBe(document.body);
    } finally {
      input.remove();
    }
  });

  it("keeps a fallback tab reachable and focuses the strip when the final tab closes", async () => {
    await render({ activeId: "missing" });
    expect(surfaceTabButton("a").tabIndex).toBe(0);
    expect(surfaceTabButton("b").tabIndex).toBe(-1);
    surfaceTabButton("a").focus();
    await render({ tabs: [], activeId: "" });
    const strip = container.querySelector<HTMLElement>('[role="tablist"]')!;
    expect(document.activeElement).toBe(strip);
    expect(strip.tabIndex).toBe(0);
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
      ).find((item) => item.textContent?.startsWith(label))!;
      expect(button).not.toBeUndefined();
      await act(async () => button.click());
    };
    await openMenu();
    expect(props.onSelectBrowser).not.toHaveBeenCalled();
    await menuAction("Split");
    await menuAction("Split right of current tab");
    expect(props.onSplitTab).toHaveBeenCalledExactlyOnceWith(
      "web-a",
      "right",
      "a",
    );
    await openMenu();
    await menuAction("Split");
    await menuAction("Return to single view");
    expect(props.onUnsplit).toHaveBeenCalledOnce();
    expect(props.onSelectBrowser).not.toHaveBeenCalled();
  });

  it.each([false, true])("reorders an inactive browser without selecting it or consuming the split target (pane-local=%s)", async (paneLocal) => {
    await render({
      paneLocal,
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
    await mouseDown(browser);
    expect(props.onSelectBrowser).not.toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
    await pointer(window, "pointermove", 10);
    await pointer(window, "pointerup", 10);
    await keydown(
      items[0].querySelector<HTMLButtonElement>('[role="tab"]')!,
      "End",
    );
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith("b");
    await act(async () => browser.click());
    expect(props.onReorderSurfaces).toHaveBeenCalledExactlyOnceWith(
      ["web-a", "a", "b"],
      "web-a",
    );
    expect(props.onSelectBrowser).not.toHaveBeenCalled();
    expect(props.onReorder).not.toHaveBeenCalled();
    expect(nativeWindow.startDragging).not.toHaveBeenCalled();
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
    // Without a group drag there is nothing for the grip to do, so it takes
    // no width; moving the group to a window stays in the tab menu.
    expect(container.querySelector(".personal-tab-group-handle")).toBeNull();
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

  it("offers precise tab and pane window destinations, returns, and history callbacks", async () => {
    await render({
      groupId: "group-owner",
      windowTargets: [{ id: "window-2", label: "Work window" }],
      onMoveTabToWindow: vi.fn(),
      onMoveGroupToWindow: vi.fn(),
      onReturnTabToWindow: vi.fn(),
      onReturnGroupToWindow: vi.fn(),
      onReopenClosedTab: vi.fn(),
      onUndoLayout: vi.fn(),
    });
    const choose = async (label: string) => {
      const item = [
        ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ].find((item) => item.textContent?.startsWith(label));
      expect(item).toBeDefined();
      await act(async () => item!.click());
    };
    const open = (selector: string) =>
      act(async () =>
        container
          .querySelector(selector)!
          .dispatchEvent(
            new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true }),
          ),
      );
    const pickTab = async (...path: string[]) => {
      await open('[role="tab"]');
      for (const label of path) await choose(label);
    };
    const pickBar = async (label: string) => {
      await open('[role="tablist"]');
      await choose(label);
    };
    await pickTab("Move to", "Move tab to new window");
    expect(props.onMoveTabToWindow).toHaveBeenLastCalledWith("a");
    await pickTab("Move to", "Move tab to Work window");
    expect(props.onMoveTabToWindow).toHaveBeenLastCalledWith("a", "window-2");
    await pickTab("Move to", "Return tab to original window");
    expect(props.onReturnTabToWindow).toHaveBeenCalledWith("a");
    await pickBar("Move all tabs to new window");
    expect(props.onMoveGroupToWindow).toHaveBeenLastCalledWith("group-owner");
    await pickBar("Move all tabs to Work window");
    expect(props.onMoveGroupToWindow).toHaveBeenLastCalledWith(
      "group-owner",
      "window-2",
    );
    await pickBar("Return all tabs to original window");
    expect(props.onReturnGroupToWindow).toHaveBeenCalledWith("group-owner");
    await pickTab("Reopen closed tab");
    expect(props.onReopenClosedTab).toHaveBeenCalledOnce();
    await pickBar("Undo layout change");
    expect(props.onUndoLayout).toHaveBeenCalledOnce();
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
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
