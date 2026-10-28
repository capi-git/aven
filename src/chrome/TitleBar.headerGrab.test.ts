// @vitest-environment happy-dom
import {
  act,
  createElement,
  Fragment,
  type ComponentProps,
  type ReactNode,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetHarnessModelOverlays } from "../lib/models";
import { resetPaneHeaders } from "../lib/paneHeader";
import { usePaneHeaderSlot } from "../hooks/usePaneHeader";
import {
  workspaceSurfaceDropAt,
  type WorkspaceSurfaceDropTarget,
} from "../surfaces/WorkspaceStage";
import type { FilePaneTab } from "../lib/layout";
import { SurfaceTabs } from "./SurfaceTabs";
import { TitleBar, type StripSplit, type Tab } from "./TitleBar";

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

function tab(id: string, title: string, extra: Partial<Tab> = {}): Tab {
  return {
    id,
    project: "demo",
    title,
    more: [],
    sessionCount: 1,
    harnesses: ["claude"],
    busyHarnesses: [],
    files: [],
    ...extra,
  };
}

const SPLIT = "aven-space:s1";
const split: StripSplit = {
  id: SPLIT,
  segments: [
    { id: "chat", tab: tab("chat", "Add sign-up flow") },
    { id: "page", page: { title: "Pricing — WorkOS" } },
  ],
  focusedId: "page",
};

/** What a page's content does with a click on its title, as BrowserPane. */
const edit = vi.fn();
/** What the toolbar's own controls do. */
const back = vi.fn();

/**
 * A page's toolbar, as BrowserPane draws it in its pane's header: the
 * arrows, its project's mark, the address naming the page (a handle for the
 * tab) until it is focused to edit, and space.
 */
function PageToolbar({ id }: { id: string }) {
  const slot = usePaneHeaderSlot(id);
  const [editing, setEditing] = useState(false);
  if (!slot) return null;
  return createPortal(
    createElement(
      "form",
      { "aria-label": "Toolbar", "data-toolbar": "" },
      createElement(
        "button",
        { type: "button", "aria-label": "Go back", onClick: back },
        "←",
      ),
      createElement("span", {
        role: "img",
        "aria-label": "Project demo",
        "data-mark": "",
        "data-pane-grab": "",
      }),
      createElement("input", {
        "aria-label": "Preview address",
        defaultValue: "Pricing — WorkOS",
        "data-pane-grab": slot.names && !editing ? "face" : undefined,
        onClick: edit,
        onFocus: () => setEditing(true),
        onBlur: () => setEditing(false),
      }),
      createElement("span", { "data-empty": "" }),
    ),
    slot.element,
  );
}

/** An iPhone's header row: pickers, space, Run. */
function IphoneToolbar({ id }: { id: string }) {
  const slot = usePaneHeaderSlot(id);
  if (!slot) return null;
  return createPortal(
    createElement(
      "div",
      { "data-toolbar": "" },
      createElement("button", { type: "button" }, "iPhone 17"),
      createElement("span", { "data-empty": "" }),
      createElement("button", { type: "button" }, "Run"),
    ),
    slot.element,
  );
}

const readme: FilePaneTab = {
  id: "readme",
  path: "/projects/demo/README.md",
  cwd: "/projects/demo",
};
const notes: FilePaneTab = {
  id: "notes",
  path: "/projects/demo/NOTES.md",
  cwd: "/projects/demo",
};
const closeFile = vi.fn();
const reorderFiles = vi.fn();

/** A tab of files, as FilePane lends it its pane's header. */
function FileToolbar({
  id,
  files,
}: {
  id: string;
  files: readonly FilePaneTab[];
}) {
  const slot = usePaneHeaderSlot(id);
  if (!slot) return null;
  return createPortal(
    createElement(SurfaceTabs, {
      files: [...files],
      activeFileId: files[0].id,
      dirtyFileIds: new Set<string>(),
      fileErrorCounts: new Map<string, number>(),
      onSelectFile: vi.fn(),
      onCloseFile: closeFile,
      onReorder: reorderFiles,
    }),
    slot.element,
  );
}

function rect(left: number, top: number, width: number, height: number) {
  return new DOMRect(left, top, width, height);
}

/**
 * The window: its strip along the top (y 0-30) holding one split of a chat
 * and a page, and below it the stage's two panes, the chat on the left
 * (x 0-500) and the page on the right (x 500-1000), each a 32px header
 * over its body.
 */
function layout(element: HTMLElement): DOMRect {
  if (element.classList.contains("aven-header-grab"))
    return rect(
      parseFloat(element.style.left) || 0,
      parseFloat(element.style.top) || 0,
      parseFloat(element.style.width) || 0,
      parseFloat(element.style.height) || 0,
    );
  if (element.matches('[aria-label="Workspace tabs"]'))
    return rect(0, 0, 1000, 30);
  if (element.matches("[data-motion-slot]")) return rect(4, 2, 300, 26);
  if (element.matches('[data-split-segment="chat"]'))
    return rect(6, 2, 148, 26);
  if (element.matches('[data-split-segment="page"]'))
    return rect(154, 2, 148, 26);
  if (element.matches('[data-workspace-header="chat"]'))
    return rect(0, 40, 500, 32);
  if (element.matches('[data-workspace-header="page"]'))
    return rect(500, 40, 500, 32);
  if (
    element.matches('[data-workspace-surface="chat"] > [data-workspace-body]')
  )
    return rect(0, 72, 500, 568);
  if (
    element.matches('[data-workspace-surface="page"] > [data-workspace-body]')
  )
    return rect(500, 72, 500, 568);
  if (element.matches("[data-pane-header-slot]")) return rect(504, 40, 440, 32);
  if (element.matches('[aria-label="Go back"]')) return rect(506, 43, 26, 26);
  if (element.matches("[data-mark]")) return rect(536, 43, 20, 26);
  if (element.matches('[aria-label="Preview address"]'))
    return rect(560, 43, 300, 26);
  if (element.matches("[data-empty]")) return rect(864, 40, 80, 32);
  // A tab of files: README.md, then NOTES.md, each 160px with its ×.
  if (element.matches('[aria-label="Open files"]'))
    return rect(504, 40, 440, 32);
  const file = element.closest<HTMLElement>("[data-tab-track-id]");
  if (file?.closest("[data-pane-header-slot]")) {
    const left = file.dataset.tabTrackId === "readme" ? 510 : 670;
    if (element.matches(".aven-tab-close")) return rect(left + 136, 46, 20, 20);
    return rect(left, 43, 160, 26);
  }
  return rect(0, 0, 0, 0);
}

let stage: HTMLDivElement;
let stripHost: HTMLDivElement;
let roots: Root[];
let titleRoot: Root;
let stripRoot: Root;
let row: ComponentProps<typeof TitleBar>;
let windowStrip: ComponentProps<typeof TitleBar>;
let drops: Array<WorkspaceSurfaceDropTarget | null>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return layout(this);
    },
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  edit.mockClear();
  back.mockClear();
  drops = [];
  // The stage: the chat's pane (its lone title row) and the page's.
  stage = document.createElement("div");
  stage.setAttribute("data-workspace-stage", "");
  for (const id of ["chat", "page"]) {
    const header = document.createElement("div");
    header.dataset.workspaceHeader = id;
    if (id === "chat") {
      const title = document.createElement("header");
      title.dataset.variant = "title";
      title.dataset.titleLayout = "lone";
      header.append(title);
    }
    const surface = document.createElement("div");
    surface.dataset.workspaceSurface = id;
    const body = document.createElement("div");
    body.setAttribute("data-workspace-body", "");
    surface.append(body);
    stage.append(header, surface);
  }
  stripHost = document.createElement("div");
  document.body.append(stripHost, stage);
  stripRoot = createRoot(stripHost);
  titleRoot = createRoot(
    stage.querySelector<HTMLElement>('[data-workspace-header="page"]')!,
  );
  roots = [stripRoot, titleRoot];
  const common = {
    paneLocal: true,
    cwd: "/projects/demo",
    onToggleSidebar: vi.fn(),
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onClose: vi.fn(),
    onCloseMany: vi.fn(),
    onReorder: vi.fn(),
    onSelectBrowser: vi.fn(),
    onCloseBrowser: vi.fn(),
  };
  // The page's pane: a lone page whose toolbar is the row, as in a split.
  row = {
    ...common,
    variant: "title",
    frontOwnHeader: true,
    frontNamed: false,
    tabs: [],
    browserTabs: [{ id: "page", title: "Pricing — WorkOS" }],
    surfaceOrder: ["page"],
    activeId: "page",
    paneZoom: "expand",
    onTogglePaneZoom: vi.fn(),
    onSurfaceDragMove: vi.fn(),
    // The stage's own drop geometry, as App's onSurfaceDragEnd.
    onSurfaceDragEnd: vi.fn((id: string, x: number, y: number, cancelled) => {
      const target = cancelled ? null : workspaceSurfaceDropAt(stage, x, y, id);
      drops.push(target);
      return Boolean(target);
    }),
    onDropOnStrip: vi.fn(),
  };
  // The window's strip, holding only the split.
  windowStrip = {
    ...common,
    variant: "strip",
    hideLoneTab: true,
    acceptsPaneDrops: true,
    windowTitle: false,
    tabs: [tab("chat", "Add sign-up flow")],
    browserTabs: [{ id: "page", title: "Pricing — WorkOS" }],
    splits: [split],
    surfaceOrder: [SPLIT],
    activeId: SPLIT,
    visibleIds: [SPLIT],
    onSelectSplitTab: vi.fn(),
    onSurfaceDragMove: vi.fn(),
    onSurfaceDragEnd: vi.fn(() => false),
  };
});

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount());
  stage.remove();
  stripHost.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetHarnessModelOverlays();
  resetPaneHeaders();
});

async function render(
  overrides: Partial<typeof row> = {},
  content: (id: string) => ReactNode = (id) =>
    createElement(PageToolbar, { id }),
) {
  row = { ...row, ...overrides };
  await act(async () => stripRoot.render(createElement(TitleBar, windowStrip)));
  await act(async () =>
    titleRoot.render(
      createElement(
        Fragment,
        null,
        createElement(TitleBar, row),
        content(row.activeId),
      ),
    ),
  );
}

const address = () =>
  document.querySelector<HTMLInputElement>('[aria-label="Preview address"]')!;
const mark = () => document.querySelector<HTMLElement>("[data-mark]")!;
const empty = () => document.querySelector<HTMLElement>("[data-empty]")!;
const standIn = () => document.querySelector<HTMLElement>("[data-header-grab]");
const chip = () =>
  document.querySelector<HTMLElement>("[data-sortable-preview]");
const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
/** Let the drag's frame run. */
const frame = () => wait(40);
const pointer = (target: EventTarget, type: string, x: number, y = 56) =>
  act(async () => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        clientX: x,
        clientY: y,
      }),
    );
  });
/** A press, as WebKit sends it: the pointer's, then the mouse's. */
async function press(target: Element, x: number, y = 56) {
  await pointer(target, "pointerdown", x, y);
  let focusable = true;
  await act(async () => {
    focusable = target.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: x,
        clientY: y,
      }),
    );
  });
  return { focusable };
}
/** Press `target`, carry it to (x, y) and let go there. */
async function drag(target: Element, from: number, x: number, y: number) {
  await press(target, from);
  await pointer(window, "pointermove", from + 20, 60);
  await frame();
  await pointer(window, "pointermove", x, y);
  await frame();
  await pointer(window, "pointerup", x, y);
}

describe("a lone page's header moves its tab", () => {
  it("lifts the tab's chip from its title and moves it into the other pane", async () => {
    await render();
    // Nothing extra is drawn at rest: the row names the page once.
    expect(standIn()).toBeNull();
    const { focusable } = await press(address(), 700);
    // The press never takes focus from where it is.
    expect(focusable).toBe(false);
    expect(document.activeElement).not.toBe(address());
    // The stand-in for the tab's chip covers the title it lifts from.
    expect(standIn()?.style.left).toBe("560px");
    expect(standIn()?.style.width).toBe("300px");
    await pointer(window, "pointermove", 720, 60);
    await frame();
    // Past the threshold: the chip lifts, the title it stands for hides.
    expect(chip()).not.toBeNull();
    expect(address().style.opacity).toBe("0");
    await pointer(window, "pointermove", 250, 350);
    await frame();
    expect(row.onSurfaceDragMove).toHaveBeenLastCalledWith(
      "page",
      250,
      350,
      expect.anything(),
    );
    await pointer(window, "pointerup", 250, 350);
    expect(drops).toEqual([{ id: "chat", edge: "tab" }]);
    // Let go, the click that follows clicks nothing.
    await act(async () => {
      address().click();
    });
    expect(edit).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(address());
  });

  it("splits the other pane at an edge, from the title or the site icon", async () => {
    await render();
    await drag(address(), 700, 20, 350);
    expect(drops.at(-1)).toEqual({ id: "chat", edge: "left" });
    await wait(600);
    await drag(mark(), 546, 250, 625);
    expect(drops.at(-1)).toEqual({ id: "chat", edge: "down" });
  });

  it("goes back to the window's strip, showing where it will stand", async () => {
    await render();
    await press(address(), 700);
    await pointer(window, "pointermove", 720, 60);
    await frame();
    await pointer(window, "pointermove", 400, 15);
    await frame();
    // The strip marks the place, after the split.
    expect(stripHost.querySelector("[data-tear-insertion]")).not.toBeNull();
    await pointer(window, "pointerup", 400, 15);
    expect(row.onDropOnStrip).toHaveBeenCalledExactlyOnceWith("page", null);
    // The stage only cleared its hints.
    expect(row.onSurfaceDragEnd).toHaveBeenLastCalledWith(
      "page",
      400,
      15,
      true,
      expect.anything(),
    );
    expect(stripHost.querySelector("[data-tear-insertion]")).toBeNull();

    // Before the split, on its left half.
    await wait(600);
    await press(address(), 700);
    await pointer(window, "pointermove", 720, 60);
    await frame();
    await pointer(window, "pointermove", 60, 15);
    await frame();
    await pointer(window, "pointerup", 60, 15);
    expect(row.onDropOnStrip).toHaveBeenLastCalledWith("page", SPLIT);
  });

  it("edits the address on a click that never moved", async () => {
    await render();
    await press(address(), 700);
    await pointer(window, "pointermove", 702, 57);
    await pointer(window, "pointerup", 702, 57);
    await act(async () => {
      address().click();
    });
    expect(edit).toHaveBeenCalledOnce();
    expect(row.onSurfaceDragEnd).not.toHaveBeenCalled();
    expect(chip()).toBeNull();
    // The stand-in is gone with the press.
    expect(standIn()).toBeNull();
  });

  it("flies home on Escape, and its title shows again once it lands", async () => {
    await render();
    await press(address(), 700);
    await pointer(window, "pointermove", 720, 60);
    await frame();
    await pointer(window, "pointermove", 250, 350);
    await frame();
    expect(address().style.opacity).toBe("0");
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
      );
    });
    expect(row.onSurfaceDragEnd).toHaveBeenLastCalledWith(
      "page",
      250,
      350,
      true,
      expect.anything(),
    );
    expect(drops.at(-1)).toBeNull();
    await wait(1500);
    expect(address().style.opacity).not.toBe("0");
    expect(standIn()).toBeNull();
    expect(chip()).toBeNull();
  });

  it("leaves the toolbar's controls, and an address being edited, alone", async () => {
    await render();
    await press(document.querySelector('[aria-label="Go back"]')!, 519);
    await pointer(window, "pointermove", 300, 300);
    await frame();
    await pointer(window, "pointerup", 300, 300);
    expect(standIn()).toBeNull();
    expect(row.onSurfaceDragMove).not.toHaveBeenCalled();

    // Named elsewhere (the strip shows it), the field is its address: a
    // field to edit, not a handle.
    await render({ frontNamed: true });
    expect(address().hasAttribute("data-pane-grab")).toBe(false);
    const { focusable } = await press(address(), 700);
    expect(focusable).toBe(true);
    await pointer(window, "pointermove", 300, 300);
    await frame();
    await pointer(window, "pointerup", 300, 300);
    expect(row.onSurfaceDragMove).not.toHaveBeenCalled();
  });

  it("drags by the row's empty space, with the chip at the pointer", async () => {
    await render({}, (id) => createElement(IphoneToolbar, { id }));
    await press(empty(), 900);
    // Nothing names the tab in this row: the stand-in starts at the pointer.
    expect(parseFloat(standIn()!.style.left)).toBeLessThanOrEqual(900);
    await pointer(window, "pointermove", 880, 60);
    await frame();
    expect(chip()).not.toBeNull();
    await pointer(window, "pointermove", 480, 350);
    await frame();
    await pointer(window, "pointerup", 480, 350);
    expect(drops.at(-1)).toEqual({ id: "chat", edge: "right" });
    // Its pickers are still pickers.
    await wait(600);
    const picker = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "iPhone 17",
    )!;
    await press(picker, 520);
    expect(standIn()).toBeNull();
    await pointer(window, "pointerup", 520, 56);
  });

  it("opens the tab's menu on a right-click on its title or the row's space", async () => {
    await render();
    for (const target of [address(), empty()]) {
      let opened = true;
      await act(async () => {
        opened = target.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: 700,
            clientY: 56,
          }),
        );
      });
      expect(opened).toBe(false);
      const items = [
        ...document.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
      ].map((item) => item.textContent?.trim());
      expect(items.some((item) => item?.startsWith("Close browser"))).toBe(
        true,
      );
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
    }
    // A control keeps its own.
    let opened = false;
    await act(async () => {
      opened = document
        .querySelector('[aria-label="Go back"]')!
        .dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
    });
    expect(opened).toBe(true);
  });
});

/**
 * A right-click (or Control-click) as WebKit sends it: the pointer's press,
 * the mouse's, whose default focuses a field it lands on, then the menu.
 * Returns whether the page took the menu and whether the press focused.
 */
async function rightClick(target: HTMLElement, x: number, ctrl = false) {
  const button = ctrl ? 0 : 2;
  const init = {
    bubbles: true,
    cancelable: true,
    button,
    ctrlKey: ctrl,
    clientX: x,
    clientY: 56,
  };
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent("pointerdown", { ...init, pointerId: 1 }),
    );
  });
  await act(async () => {
    const focusable = target.dispatchEvent(new MouseEvent("mousedown", init));
    if (focusable && target.matches("input, button")) target.focus();
  });
  const focused = document.activeElement === target;
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent("pointerup", { ...init, pointerId: 1 }),
    );
  });
  let taken = false;
  await act(async () => {
    taken = !target.dispatchEvent(new MouseEvent("contextmenu", init));
  });
  return { taken, focused };
}
const menuItems = () =>
  [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].map(
    (item) => item.textContent?.trim() ?? "",
  );
const closeMenu = () =>
  act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });

describe("right-clicks and edits in a lone page's header", () => {
  it("opens the tab's menu on a right-click or Control-click on the title, which a press would otherwise focus", async () => {
    await render();
    for (const ctrl of [false, true]) {
      const { taken, focused } = await rightClick(address(), 700, ctrl);
      expect(focused).toBe(false);
      expect(taken).toBe(true);
      expect(menuItems().some((item) => item.startsWith("Close browser"))).toBe(
        true,
      );
      // Still the page's title, a handle for its tab.
      expect(address().dataset.paneGrab).toBe("face");
      await closeMenu();
    }
    // Being edited, the field keeps its own menu.
    await act(async () => address().focus());
    const { taken } = await rightClick(address(), 700);
    expect(taken).toBe(false);
  });

  it("ends an edit when the row is pressed, the title lifting with the tab", async () => {
    await render();
    await act(async () => address().focus());
    expect(address().hasAttribute("data-pane-grab")).toBe(false);
    const { focusable } = await press(mark(), 546);
    expect(focusable).toBe(false);
    expect(document.activeElement).not.toBe(address());
    // Naming the page again, the title is what the chip lifts from.
    expect(address().dataset.paneGrab).toBe("face");
    expect(standIn()?.style.left).toBe("560px");
    await pointer(window, "pointermove", 570, 70);
    await frame();
    expect(address().style.opacity).toBe("0");
    await pointer(window, "pointerup", 570, 70);
  });
});

describe("a lone file's header moves its tab", () => {
  const files = (list: readonly FilePaneTab[]) => (id: string) =>
    createElement(FileToolbar, { id, files: list });

  it("moves the tab by its lone file's tab, and still closes the file by its ×", async () => {
    closeFile.mockClear();
    await render(
      {
        tabs: [tab("files", "README.md", { files: ["README.md"] })],
        browserTabs: [],
        surfaceOrder: ["files"],
        activeId: "files",
      },
      files([readme]),
    );
    const fileTab = document.querySelector<HTMLElement>(
      '[data-pane-header-slot] [data-tab-track-id="readme"]',
    )!;
    await drag(fileTab, 560, 250, 350);
    expect(drops.at(-1)).toEqual({ id: "chat", edge: "tab" });
    await wait(600);
    const close = fileTab.querySelector<HTMLElement>(".aven-tab-close")!;
    await press(close, 650);
    expect(standIn()).toBeNull();
    await pointer(window, "pointerup", 650, 56);
    await act(async () => close.click());
    expect(closeFile).toHaveBeenCalledExactlyOnceWith("readme");
  });

  it("keeps a lone file's own menu on its tab, and the tab's menu on the row's space", async () => {
    await render(
      {
        tabs: [tab("files", "README.md", { files: ["README.md"] })],
        browserTabs: [],
        surfaceOrder: ["files"],
        activeId: "files",
      },
      files([readme]),
    );
    const fileTab = document.querySelector<HTMLElement>(
      '[data-pane-header-slot] [data-tab-track-id="readme"] [role="tab"]',
    )!;
    const own = await rightClick(fileTab, 560);
    expect(own.taken).toBe(true);
    expect(menuItems()).toContain("Copy path");
    expect(menuItems().some((item) => item.startsWith("Close tab"))).toBe(
      false,
    );
    await closeMenu();
    const strip = document.querySelector<HTMLElement>(
      '[data-pane-header-slot] [aria-label="Open files"]',
    )!;
    await rightClick(strip, 900);
    expect(menuItems().some((item) => item.startsWith("Close tab"))).toBe(true);
    await closeMenu();
  });

  it("leaves several files' tabs to reorder the files, and moves the tab by the row's space", async () => {
    reorderFiles.mockClear();
    await render(
      {
        tabs: [tab("files", "README.md", { files: ["README.md", "NOTES.md"] })],
        browserTabs: [],
        surfaceOrder: ["files"],
        activeId: "files",
      },
      files([readme, notes]),
    );
    const first = document.querySelector<HTMLElement>(
      '[data-pane-header-slot] [data-tab-track-id="readme"]',
    )!;
    expect(first.hasAttribute("data-pane-grab")).toBe(false);
    await press(first, 560);
    expect(standIn()).toBeNull();
    await pointer(window, "pointerup", 560, 56);
    // The strip's space after the files.
    const strip = document.querySelector<HTMLElement>(
      '[data-pane-header-slot] [aria-label="Open files"]',
    )!;
    await drag(strip, 900, 20, 350);
    expect(drops.at(-1)).toEqual({ id: "chat", edge: "left" });
  });
});

describe("the window's strip with a split alone", () => {
  it("shows the split, so its tabs can be pulled out, but no single tab alone", async () => {
    await render();
    expect(stripHost.querySelectorAll("[data-split-entry]")).toHaveLength(1);
    expect(
      [...stripHost.querySelectorAll<HTMLElement>("[data-split-segment]")].map(
        (segment) => segment.textContent,
      ),
    ).toEqual(["Add sign-up flow", "Pricing — WorkOS"]);

    windowStrip = {
      ...windowStrip,
      splits: [],
      browserTabs: [],
      surfaceOrder: ["chat"],
      activeId: "chat",
      visibleIds: ["chat"],
    };
    await act(async () =>
      stripRoot.render(createElement(TitleBar, windowStrip)),
    );
    expect(stripHost.querySelector("[data-surface-tab-id]")).toBeNull();
  });
});
