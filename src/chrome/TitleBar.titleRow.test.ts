// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetHarnessModelOverlays } from "../lib/models";
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
  container.querySelector<HTMLElement>('[aria-label="Workspace tabs"]')!;
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

describe("a pane's title row", () => {
  it("shows the tab in front, with the tabs behind it as a deck", async () => {
    await render({ variant: "title", activeId: "b" });
    expect(tabIds()).toEqual(["b"]);
    const deck = container.querySelector<HTMLButtonElement>(
      "button.aven-tab-deck",
    )!;
    expect(deck.getAttribute("aria-label")).toBe("3 tabs in this pane");
    expect(deck.dataset.behind).toBe("2");
    await act(async () => deck.click());
    expect(menuItems()).toEqual([
      "First task",
      "Second task",
      "Third",
      "Move to a pane of its own",
    ]);
    await act(async () => menuItem("Third").click());
    expect(props.onSelect).toHaveBeenCalledWith("c");
  });

  it("splits the front tab out of its stack", async () => {
    await render({ variant: "title", activeId: "b" });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("button.aven-tab-deck")!
        .click(),
    );
    await act(async () => menuItem("Move to a pane of its own").click());
    expect(props.onSplitTab).toHaveBeenCalledWith("b", "right", "a");
  });

  it("draws no deck to open while the window's strip lists the tabs", async () => {
    await render({ variant: "title", stackOnStrip: true });
    expect(container.querySelector("button.aven-tab-deck")).toBeNull();
    expect(container.querySelector(".aven-tab-deck")).not.toBeNull();
  });

  it("offers More, Move, Expand and Close, with their shortcuts", async () => {
    const onToggle = vi.fn();
    const onMove = vi.fn();
    await render({
      variant: "title",
      paneTools: {
        zoom: { zoomed: false, onToggle },
        moves: ["right"],
        onMove,
      },
    });
    const labels = [
      ...container.querySelectorAll<HTMLButtonElement>(".aven-pane-tool"),
    ].map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual([
      "More actions",
      "Move right",
      "Expand",
      "Close tab",
    ]);
    expect(tool("Expand")!.title).toMatch(/^Expand \((⌃⌥|Ctrl\+Alt\+)Z\)$/);
    expect(tool("Close tab")!.title).toMatch(/^Close tab \((⌘|Ctrl\+)W\)$/);
    await act(async () => tool("Move right")!.click());
    expect(onMove).toHaveBeenCalledWith("right");
    await act(async () => tool("Expand")!.click());
    expect(onToggle).toHaveBeenCalled();
    await act(async () => tool("Close tab")!.click());
    expect(props.onClose).toHaveBeenCalledWith("a");
  });

  it("reads Restore while expanded and lists several moves in a menu", async () => {
    const onMove = vi.fn();
    await render({
      variant: "title",
      paneTools: {
        zoom: { zoomed: true, onToggle: vi.fn() },
        moves: ["left", "down"],
        onMove,
      },
    });
    expect(tool("Restore")!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => tool("Move")!.click());
    expect(menuItems()).toEqual(["Move left", "Move down"]);
    await act(async () => menuItem("Move down").click());
    expect(onMove).toHaveBeenCalledWith("down");
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
    // The title sits on the lit chip only on the focused pane.
    expect(css).toMatch(
      /\.personal-titlebar\[data-variant="title"\]\[data-pane-focused="true"\]\s*\.aven-tab\[data-active="true"\]\s*> \.aven-tab-motion \{\s*background: var\(--aven-tab-selected\);/,
    );
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
