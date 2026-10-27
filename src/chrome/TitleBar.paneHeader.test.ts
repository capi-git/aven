// @vitest-environment happy-dom
import { act, createElement, Fragment, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetHarnessModelOverlays } from "../lib/models";
import { resetPaneHeaders } from "../lib/paneHeader";
import {
  usePaneHeaderMenuHosted,
  usePaneHeaderSlot,
  useProvidePaneHeaderMenu,
} from "../hooks/usePaneHeader";
import { TitleBar, type Tab } from "./TitleBar";

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

const pick = vi.fn();

/**
 * A tab's content with a toolbar of its own, as a page is: it draws the
 * toolbar where its pane's title row lends it the row, else above itself,
 * and lists its secondary actions in the pane's "…" while one hosts them.
 */
function Content({ id }: { id: string }) {
  const slot = usePaneHeaderSlot(id);
  const hosted = usePaneHeaderMenuHosted(id);
  useProvidePaneHeaderMenu(
    id,
    () => [
      { kind: "item", id: "comment", label: "Comment on page" },
      { kind: "item", id: "page:zoom", label: "Zoom", shortcut: "›" },
    ],
    pick,
    () => ({ zoom: [{ kind: "item", id: "zoom-in", label: "Zoom in" }] }),
  );
  const toolbar = createElement(
    "form",
    { "aria-label": "Toolbar", "data-names": slot?.names ? "" : undefined },
    createElement("input", { "aria-label": "Preview address" }),
    hosted
      ? null
      : createElement("button", { type: "button" }, "Comment on page"),
  );
  return createElement(
    "section",
    { "aria-label": "Content" },
    slot ? createPortal(toolbar, slot.element) : toolbar,
  );
}

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof TitleBar>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  pick.mockClear();
  props = {
    variant: "title",
    tabs: [tab("a", "Linking coaching: three ideas")],
    activeId: "a",
    cwd: "/projects/demo",
    paneLocal: true,
    frontOwnHeader: true,
    paneZoom: "expand",
    onTogglePaneZoom: vi.fn(),
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
  resetPaneHeaders();
});

async function render(overrides: Partial<typeof props> = {}) {
  props = { ...props, ...overrides };
  await act(async () =>
    root.render(
      createElement(
        Fragment,
        null,
        createElement(TitleBar, props),
        createElement(Content, { id: props.activeId }),
      ),
    ),
  );
}

const header = () =>
  container.querySelector<HTMLElement>(".personal-titlebar")!;
const tool = (label: string) =>
  container.querySelector<HTMLButtonElement>(
    `.aven-pane-tool[aria-label="${label}"]`,
  );
const menuItems = () =>
  [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].map(
    (item) => item.textContent?.trim(),
  );
const menuItem = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(
    (item) => item.textContent?.trim().startsWith(text),
  )!;

describe("one header per pane", () => {
  it("gives a single-tab pane exactly one header row: the tab's own toolbar", async () => {
    await render();
    const forms = container.querySelectorAll('form[aria-label="Toolbar"]');
    expect(forms).toHaveLength(1);
    // In the title row, in place of the tab's name, before the pane's tools.
    expect(header().contains(forms[0])).toBe(true);
    expect(
      container.querySelector('section[aria-label="Content"] form'),
    ).toBeNull();
    expect(header().querySelector(".aven-tab")).toBeNull();
    expect(header().textContent).not.toContain("Linking coaching");
    // Nothing else names it, so its toolbar may.
    expect(forms[0].hasAttribute("data-names")).toBe(true);
  });

  it("offers Expand and Close once, and the content's actions only in the pane's …", async () => {
    await render();
    expect(container.querySelectorAll('[aria-label="Expand"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label^="Close"]')).toHaveLength(1);
    // The content's own button for it went to the pane's "…".
    expect(container.textContent).not.toContain("Comment on page");
    await act(async () => tool("More actions")!.click());
    expect(menuItems()[0]).toBe("Comment on page");
    await act(async () => menuItem("Comment on page").click());
    expect(pick).toHaveBeenCalledWith("comment");
    await act(async () => tool("More actions")!.click());
    await act(async () => menuItem("Zoom").click());
    await act(async () => menuItem("Zoom in").click());
    expect(pick).toHaveBeenCalledWith("zoom-in");
  });

  it("does not name the tab again where the window's strip already does", async () => {
    await render({
      tabs: [tab("a", "Page"), tab("b", "Chat")],
      stackOnStrip: true,
    });
    const form = container.querySelector('form[aria-label="Toolbar"]')!;
    expect(header().contains(form)).toBe(true);
    expect(form.hasAttribute("data-names")).toBe(false);
    expect(header().querySelector(".aven-tab")).toBeNull();
  });

  it("does not name the tab where a strip of entries names it, whatever the pane holds", async () => {
    // A single tab among spaces on the window's strip: one tab in the pane,
    // yet the strip names it.
    await render({ stackOnStrip: true, frontNamed: true });
    const form = container.querySelector('form[aria-label="Toolbar"]')!;
    expect(header().contains(form)).toBe(true);
    expect(form.hasAttribute("data-names")).toBe(false);
  });

  it("names a tab without a toolbar of its own, as today", async () => {
    await render({ frontOwnHeader: false });
    expect(header().querySelector("[data-pane-header-slot]")).toBeNull();
    expect(header().textContent).toContain("Linking coaching");
    // Its content draws its toolbar above itself, with its own actions.
    expect(
      container.querySelector('section[aria-label="Content"] form'),
    ).not.toBeNull();
  });

  it("puts the tab's toolbar under a row of tabs, with one line under both", async () => {
    await render({
      tabs: [tab("a", "Page"), tab("b", "Chat")],
      activeId: "a",
    });
    expect(header().dataset.titleLayout).toBe("tabs");
    expect(header().dataset.headerContinues).toBe("true");
    expect(
      container.querySelector('section[aria-label="Content"] form'),
    ).not.toBeNull();
    // Its actions are still in the pane's one "…".
    expect(
      container.querySelector('section[aria-label="Content"] button'),
    ).toBeNull();
  });
});
