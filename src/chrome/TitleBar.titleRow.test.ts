// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetHarnessModelOverlays } from "../lib/models";
import {
  changeSurfaceGroup,
  createSurfaceGroup,
  ungroupSurfaceGroup,
} from "../lib/surfaceGroups";
import { layoutLeaves } from "../lib/layout";
import { selectWorkspaceView, type WorkspaceView } from "../lib/workspaceViews";
import { TitleBar, returnFocusToPane, type Tab } from "./TitleBar";

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setFocus: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/app", () => ({
  getName: vi.fn().mockResolvedValue("Aven"),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setTitle: vi.fn().mockResolvedValue(undefined),
    startDragging: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("./WindowControls", () => ({ WindowControls: () => null }));

function tab(id: string, title: string): Tab {
  return {
    id,
    project: "demo",
    title,
    more: [],
    sessionCount: 1,
    harnesses: ["claude"],
    busyHarnesses: [],
    files: [],
  };
}

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof TitleBar>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    tabs: [tab("a", "First task"), tab("b", "Second task"), tab("c", "Third")],
    activeId: "a",
    cwd: "/projects/demo",
    paneLocal: true,
    onToggleSidebar: vi.fn(),
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onClose: vi.fn(),
    onCloseMany: vi.fn(),
    onReorder: vi.fn(),
    onSplitTab: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetHarnessModelOverlays();
});

async function render(overrides: Partial<typeof props> = {}) {
  props = { ...props, ...overrides };
  await act(async () => root.render(createElement(TitleBar, props)));
}

const strip = () =>
  container.querySelector<HTMLElement>(
    '[aria-label="Workspace tabs"], [aria-label="Pane"], [aria-label="Tabs in this pane"]',
  )!;
const tabIds = () =>
  [...container.querySelectorAll<HTMLElement>("[data-surface-tab-id]")].map(
    (node) => node.dataset.surfaceTabId,
  );
const tool = (label: string) =>
  container.querySelector<HTMLButtonElement>(
    `.aven-pane-tool[aria-label="${label}"]`,
  );
const menuNodes = () => [
  ...document.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
];
const menuItems = () => menuNodes().map((item) => item.textContent?.trim());
const menuItem = (text: string) =>
  menuNodes().find((item) => item.textContent?.trim().startsWith(text))!;

describe("a strip on a track", () => {
  it("puts two tabs or more on a track with one highlight", async () => {
    await render();
    expect(strip().dataset.tabTrack).toBe("true");
    expect(strip().querySelectorAll(".aven-tab-highlight")).toHaveLength(1);
    // The highlight is drawn first, under every tab.
    expect(strip().firstElementChild?.className).toBe("aven-tab-highlight");
  });

  it("parts resting tabs with a line, but not beside the front tab", async () => {
    await render({
      tabs: [tab("a", "A"), tab("b", "B"), tab("c", "C"), tab("d", "D")],
      activeId: "b",
    });
    const parted = [
      ...strip().querySelectorAll<HTMLElement>("[data-tab-separator]"),
    ].map((node) => node.dataset.tabTrackId);
    expect(parted).toEqual(["d"]);
  });

  it("shows no lone tab on the window's strip, but keeps its buttons", async () => {
    await render({
      tabs: [tab("a", "Only")],
      hideLoneTab: true,
      onNewBrowser: vi.fn(),
    });
    expect(tabIds()).toEqual([]);
    expect(strip().dataset.tabTrack).toBeUndefined();
    expect(container.querySelector('[aria-label="New chat"]')).not.toBeNull();
    expect(
      container.querySelector('[aria-label="New browser"]'),
    ).not.toBeNull();
  });

  it("keeps a lone tab as a chip elsewhere", async () => {
    await render({ tabs: [tab("a", "Only")] });
    expect(tabIds()).toEqual(["a"]);
    expect(strip().dataset.tabTrack).toBeUndefined();
    expect(strip().querySelector(".aven-tab-highlight")).toBeNull();
  });

  it("shares the strip equally down to 120px and slides 150ms", () => {
    const css = readFileSync("src/chrome/TitleBar.css", "utf8");
    expect(css).toMatch(
      /\.aven-tab-strip\[data-tab-track\] \.aven-tab-slot \{\s*flex: 1 1 0;\s*width: auto;\s*min-width: 120px;\s*max-width: none;/,
    );
    expect(css).toMatch(
      /\.aven-tab-strip\[data-tab-track\] \.aven-tab-button \{\s*justify-content: center;/,
    );
    // The highlight takes the front tab's neutral fill, 26px with 6px corners.
    expect(css).toMatch(
      /\.aven-tab-highlight \{[^}]*height: 26px;[^}]*border-radius: var\(--aven-radius-sm\);[^}]*background: var\(--aven-tab-selected\);/,
    );
    // Separators: 1px, 5px in from the 26px tab's top and bottom.
    expect(css).toMatch(
      /\[data-tab-separator\]::before \{[^}]*top: 8px;[^}]*bottom: 8px;[^}]*width: 1px;/,
    );
  });
});

/** Lays the strips out `width` CSS pixels wide (happy-dom lays out nothing). */
function stripWidth(width: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("aven-tab-strip") ? width : 0;
    },
  });
}

const tabButton = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (button) => button.textContent?.includes(label),
  )!;

describe("a pane's title row with several tabs", () => {
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)
      .clientWidth;
  });

  it("lays them side by side as tabs, each one click away", async () => {
    await render({ variant: "title", activeId: "b" });
    const header = container.querySelector<HTMLElement>(".personal-titlebar")!;
    expect(header.dataset.titleLayout).toBe("tabs");
    expect(strip().getAttribute("role")).toBe("tablist");
    expect(strip().getAttribute("aria-label")).toBe("Tabs in this pane");
    expect(strip().getAttribute("aria-orientation")).toBe("horizontal");
    expect(tabIds()).toEqual(["a", "b", "c"]);
    const tabs = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ];
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    // Only the tab in front is a Tab stop; arrows move between the rest.
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    // The window strip's tabs: on a track, one highlight, no deck, no "+N".
    expect(strip().dataset.tabTrack).toBe("true");
    expect(strip().querySelectorAll(".aven-tab-highlight")).toHaveLength(1);
    expect(container.querySelector(".aven-tab-deck")).toBeNull();
    expect(container.querySelector("[data-title-overflow]")).toBeNull();
    await act(async () => tabButton("Third").click());
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith("c");
  });

  it("keeps what a strip tab does: close, middle-click, arrows and its menu", async () => {
    await render({ variant: "title", activeId: "b" });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Close Third"]')!
        .click(),
    );
    expect(props.onClose).toHaveBeenCalledWith("c");
    const first = container.querySelector<HTMLElement>(
      '[data-surface-tab-id="a"]',
    )!;
    await act(async () =>
      first.dispatchEvent(
        new MouseEvent("auxclick", { button: 1, bubbles: true }),
      ),
    );
    expect(props.onClose).toHaveBeenCalledWith("a");
    const second = tabButton("Second task");
    second.focus();
    await act(async () =>
      second.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    expect(props.onSelect).toHaveBeenCalledWith("c");
    await act(async () =>
      tabButton("Third").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true }),
      ),
    );
    expect(menuItem("Close tab")).toBeDefined();
    await act(async () => menuItem("Close tab").click());
    expect(props.onClose).toHaveBeenLastCalledWith("c");
  });

  it("keeps Move to a pane of its own in a tab's menu", async () => {
    await render({ variant: "title", activeId: "b" });
    await act(async () =>
      tabButton("Third").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true }),
      ),
    );
    await act(async () => menuItem("Move to a pane of its own").click());
    // Beside its own pane, whose tab in front stays where it is.
    expect(props.onSplitTab).toHaveBeenCalledWith("c", "right", "b");
    // The tab in front leaves beside another of its pane's tabs, also from
    // the pane's More actions.
    await act(async () => tool("More actions")!.click());
    await act(async () => menuItem("Move to a pane of its own").click());
    expect(props.onSplitTab).toHaveBeenLastCalledWith("b", "right", "a");
  });

  it("fronts a tab picked in a pane that does not have focus", async () => {
    let view: WorkspaceView = {
      focusedId: "left",
      layout: {
        type: "split",
        id: "root",
        dir: "right",
        children: [
          { type: "leaf", id: "left" },
          { type: "leaf", id: "a" },
        ],
        sizes: [50, 50],
      },
      groups: { left: ["left"], a: ["a", "b", "c"] },
      order: ["left", "a", "b", "c"],
    };
    await render({
      variant: "title",
      activeId: "a",
      paneFocused: false,
      onSelect: vi.fn((id: string) => {
        view = selectWorkspaceView(view, id);
      }),
    });
    expect(tabIds()).toEqual(["a", "b", "c"]);
    await act(async () => tabButton("Third").click());
    expect(view.focusedId).toBe("c");
    expect(view.groups.c).toEqual(["a", "b", "c"]);
    expect(layoutLeaves(view.layout!).map((entry) => entry.id)).toEqual([
      "left",
      "c",
    ]);
  });

  it("folds the tabs that do not fit into a +N that lists only them", async () => {
    stripWidth(400);
    await render({
      variant: "title",
      tabs: ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) =>
        tab(id, `Task ${id.toUpperCase()}`),
      ),
      activeId: "f",
    });
    // 400px holds three 96px tabs beside the +N; the tab in front stays.
    expect(tabIds()).toEqual(["a", "b", "f"]);
    const more = container.querySelector<HTMLButtonElement>(
      "[data-title-overflow]",
    )!;
    expect(more.textContent).toBe("+5");
    expect(more.getAttribute("aria-label")).toBe("5 more tabs in this pane");
    await act(async () => more.click());
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(menuItems()).toEqual([
      "Task C",
      "Task D",
      "Task E",
      "Task G",
      "Task H",
    ]);
    await act(async () => menuItem("Task G").click());
    expect(props.onSelect).toHaveBeenCalledWith("g");
  });

  it("shows every tab while they all fit at 96px, and folds one past that", async () => {
    stripWidth(300);
    await render({ variant: "title", activeId: "b" });
    // Three 96px tabs, two 2px gaps and the 8px padding: exactly 300px.
    expect(tabIds()).toEqual(["a", "b", "c"]);
    expect(container.querySelector("[data-title-overflow]")).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    stripWidth(299);
    await render({ variant: "title", activeId: "b" });
    expect(tabIds()).toEqual(["a", "b"]);
    expect(container.querySelector("[data-title-overflow]")?.textContent).toBe(
      "+1",
    );
  });

  it("keeps a folded group's tabs in the +N", async () => {
    const group = createSurfaceGroup(["b", "c"], 0);
    changeSurfaceGroup(group, { collapsed: true });
    try {
      await render({ variant: "title", activeId: "a" });
      expect(tabIds()).toEqual(["a"]);
      expect(
        container.querySelector("[data-title-overflow]")?.textContent,
      ).toBe("+2");
    } finally {
      ungroupSurfaceGroup(group);
    }
  });
});

describe("a pane's title row with one tab", () => {
  it("names that tab on its own, with no tabs, deck menu or +N", async () => {
    await render({ variant: "title", tabs: [tab("a", "Only")] });
    const header = container.querySelector<HTMLElement>(".personal-titlebar")!;
    expect(header.dataset.titleLayout).toBe("lone");
    expect(tabIds()).toEqual(["a"]);
    expect(strip().getAttribute("role")).toBe("group");
    expect(strip().getAttribute("aria-label")).toBe("Pane");
    expect(strip().hasAttribute("aria-orientation")).toBe(false);
    expect(strip().dataset.tabTrack).toBeUndefined();
    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector(".aven-tab-highlight")).toBeNull();
    expect(container.querySelector("[data-title-overflow]")).toBeNull();
    // Its icon on a tile, which is not a control.
    expect(container.querySelector(".aven-tab-deck")).not.toBeNull();
    expect(container.querySelector("button.aven-tab-deck")).toBeNull();
    expect(container.textContent).toContain("Only");
  });

  it("names only the tab in front while the window's strip lists the tabs", async () => {
    await render({ variant: "title", activeId: "b", stackOnStrip: true });
    expect(tabIds()).toEqual(["b"]);
    expect(strip().getAttribute("role")).toBe("group");
    expect(container.querySelector("[data-title-overflow]")).toBeNull();
    expect(container.querySelector("button.aven-tab-deck")).toBeNull();
  });
});

describe("a pane's title row", () => {
  it("leaves Esc to a tab drag in progress", async () => {
    await render({ variant: "title" });
    const stage = document.createElement("div");
    stage.dataset.workspaceStage = "";
    stage.innerHTML = `<div data-workspace-surface="a" data-focused="true"><textarea id="box"></textarea></div>`;
    document.body.append(stage);
    document.documentElement.classList.add("is-reordering");
    try {
      const more = tool("More actions")!;
      more.focus();
      more.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      expect(document.activeElement).toBe(more);
    } finally {
      document.documentElement.classList.remove("is-reordering");
      stage.remove();
    }
  });

  it("offers More, Expand and a lone tab's Close at rest, each once, with their shortcuts", async () => {
    const onToggle = vi.fn();
    const onMove = vi.fn();
    await render({
      variant: "title",
      tabs: [tab("a", "First task")],
      paneZoom: "expand",
      onTogglePaneZoom: onToggle,
      paneMoves: ["right"],
      onMovePane: onMove,
    });
    const labels = [
      ...container.querySelectorAll<HTMLButtonElement>(".aven-pane-tool"),
    ].map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual(["More actions", "Expand", "Close tab"]);
    // Expand and Close once in the pane: the lone title draws no × of its own.
    expect(
      container.querySelectorAll(
        '[aria-label="Expand"], [aria-label="Restore"]',
      ),
    ).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label^="Close"]')).toHaveLength(1);
    expect(tool("Expand")!.title).toMatch(/^Expand \((⌃⌥|Ctrl\+Alt\+)Z\)$/);
    expect(tool("Close tab")!.title).toMatch(/^Close tab \((⌘|Ctrl\+)W\)$/);
    await act(async () => tool("Expand")!.click());
    expect(onToggle).toHaveBeenCalled();
    await act(async () => tool("Close tab")!.click());
    expect(props.onClose).toHaveBeenCalledWith("a");
    // Moving the pane is in its "…".
    await act(async () => tool("More actions")!.click());
    await act(async () => menuItem("Move right").click());
    expect(onMove).toHaveBeenCalledWith("right");
  });

  it("leaves Close to each tab in a row of tabs, so the pane has one per tab", async () => {
    await render({
      variant: "title",
      activeId: "b",
      paneZoom: "expand",
      onTogglePaneZoom: vi.fn(),
    });
    const labels = [
      ...container.querySelectorAll<HTMLButtonElement>(".aven-pane-tool"),
    ].map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual(["More actions", "Expand"]);
    for (const name of ["First task", "Second task", "Third"])
      expect(
        container.querySelectorAll(`[aria-label="Close ${name}"]`),
      ).toHaveLength(1);
  });

  it("reads Restore while expanded and lists several moves on a page of its \u2026", async () => {
    const onMove = vi.fn();
    await render({
      variant: "title",
      paneZoom: "restore",
      onTogglePaneZoom: vi.fn(),
      paneMoves: ["left", "down"],
      onMovePane: onMove,
    });
    // Its name says what it does; it is not also a toggle.
    expect(tool("Restore")!.hasAttribute("aria-pressed")).toBe(false);
    expect(tool("Move")).toBeNull();
    await act(async () => tool("More actions")!.click());
    await act(async () => menuItem("Move").click());
    expect(menuItems()).toEqual([
      "‹ Back",
      "Move left",
      "Move down",
      "Move to a pane of its own",
    ]);
    await act(async () => menuItem("Move down").click());
    expect(onMove).toHaveBeenCalledWith("down");
  });

  it("hides the pane, opens the iPhone and lists Recent pages from its \u2026", async () => {
    const onHide = vi.fn();
    const onIphone = vi.fn();
    const onSelectBrowser = vi.fn();
    await render({
      variant: "title",
      tabs: [tab("a", "First task")],
      browserTabs: [{ id: "page", title: "Docs", url: "https://docs.example" }],
      surfaceOrder: ["a"],
      onKeepBrowser: vi.fn(),
      onSelectBrowser,
      paneHides: [{ key: "root:0:before", label: "Hide left pane" }],
      onHidePane: onHide,
      onOpenIphone: onIphone,
    });
    // None of them is a button at rest.
    expect(container.querySelector('[aria-label="iPhone"]')).toBeNull();
    expect(
      container.querySelector('[aria-label="Recent browser tabs"]'),
    ).toBeNull();
    await act(async () => tool("More actions")!.click());
    expect(menuItems()).toContain("Hide left pane");
    expect(menuItems()).toContain("iPhone");
    await act(async () => menuItem("Hide left pane").click());
    expect(onHide).toHaveBeenCalledWith("root:0:before");
    await act(async () => tool("More actions")!.click());
    await act(async () => menuItem("iPhone").click());
    expect(onIphone).toHaveBeenCalled();
    await act(async () => tool("More actions")!.click());
    await act(async () => menuItem("Recent pages").click());
    await act(async () => menuItem("Docs").click());
    expect(onSelectBrowser).toHaveBeenCalledWith("page");
  });

  it("has no Expand while the pane is alone, and More opens the tab's menu", async () => {
    await render({ variant: "title" });
    expect(tool("Expand")).toBeNull();
    expect(tool("Restore")).toBeNull();
    await act(async () => tool("More actions")!.click());
    expect(menuItem("Close tab")).toBeDefined();
  });

  it("shows its tools on the focused pane, and elsewhere while pointed at", async () => {
    await render({ variant: "title", paneFocused: false });
    const header = container.querySelector<HTMLElement>(".personal-titlebar")!;
    expect(header.dataset.variant).toBe("title");
    expect(header.dataset.paneFocused).toBe("false");
    const css = readFileSync("src/chrome/TitleBar.css", "utf8");
    expect(css).toMatch(/\.aven-pane-tools \{[^}]*opacity: 0;/);
    expect(css).toMatch(
      /\.personal-titlebar\[data-variant="title"\]:hover \.aven-pane-tools,\s*\.personal-titlebar\[data-variant="title"\]\[data-pane-focused="true"\]\s*\.aven-pane-tools,\s*\.aven-pane-tools:focus-within,\s*\.aven-pane-tools\[data-open\] \{\s*opacity: 1;/,
    );
    // A lone title sits on the lit chip only on the focused pane.
    expect(css).toMatch(
      /\.personal-titlebar\[data-title-layout="lone"\]\[data-pane-focused="true"\]\s*\.personal-tab-strip\s*\.aven-tab\[data-active="true"\]\s*> \.aven-tab-motion \{\s*background: var\(--aven-tab-selected\);/,
    );
    // A row of tabs lights its highlight on the focused pane; elsewhere the
    // tab in front keeps the quieter fill, as on any strip.
    expect(css).toMatch(
      /\[data-pane-focused="false"\] \.aven-tab-highlight \{\s*background: var\(--aven-fill-quaternary\);/,
    );
    // Its tabs go down to 96px in a pane before they fold into the +N.
    expect(css).toMatch(
      /\.personal-titlebar\[data-title-layout="tabs"\]\s*\.personal-tab-strip\s*\.aven-tab-slot \{\s*min-width: 96px;/,
    );
  });
});

describe("a title row over a tab split into panes", () => {
  it("names nothing when its panes name themselves, and keeps its tools", async () => {
    const onMove = vi.fn();
    await render({
      variant: "title",
      tabs: [tab("a", "First task")],
      frontNamedBelow: true,
      paneZoom: "expand",
      onTogglePaneZoom: vi.fn(),
      paneMoves: ["right"],
      onMovePane: onMove,
    });
    // No chip: the chat's own strip below names it once.
    expect(tabIds()).toEqual([]);
    expect(container.textContent).not.toContain("First task");
    const labels = [
      ...container.querySelectorAll<HTMLButtonElement>(".aven-pane-tool"),
    ].map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual(["More actions", "Expand", "Close tab"]);
    await act(async () => tool("More actions")!.click());
    expect(menuItem("Close tab")).toBeDefined();
    await act(async () => menuItem("Move right").click());
    expect(onMove).toHaveBeenCalledWith("right");
  });

  it("lays out the tabs when others share its pane", async () => {
    await render({ variant: "title", activeId: "b", frontNamedBelow: true });
    expect(tabIds()).toEqual(["a", "b", "c"]);
    expect(strip().getAttribute("role")).toBe("tablist");
  });
});

describe("Esc on a title row", () => {
  it("gives the keyboard back to that pane, or the focused pane from the window's strip", () => {
    const stage = document.createElement("div");
    stage.dataset.workspaceStage = "";
    stage.innerHTML = `
      <div data-workspace-surface="left" data-focused="false"><textarea id="left-box"></textarea></div>
      <div data-workspace-surface="right" data-focused="true"><textarea id="right-box"></textarea></div>
      <div data-workspace-header="left"><button id="left-tool">More</button></div>`;
    const strip = document.createElement("button");
    document.body.append(stage, strip);
    try {
      expect(returnFocusToPane(stage.querySelector("#left-tool")!)).toBe(true);
      expect(document.activeElement?.id).toBe("left-box");
      expect(returnFocusToPane(strip)).toBe(true);
      expect(document.activeElement?.id).toBe("right-box");
    } finally {
      stage.remove();
      strip.remove();
    }
  });

  it("is what Esc does on a title row's controls", async () => {
    await render({ variant: "title" });
    const stage = document.createElement("div");
    stage.dataset.workspaceStage = "";
    stage.innerHTML = `<div data-workspace-surface="a" data-focused="true"><textarea id="box"></textarea></div>`;
    document.body.append(stage);
    try {
      const more = tool("More actions")!;
      more.focus();
      more.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      expect(document.activeElement?.id).toBe("box");
    } finally {
      stage.remove();
    }
  });
});
