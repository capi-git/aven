// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetHarnessModelOverlays } from "../lib/models";
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
// The strip's keys and labels are the Mac's.
vi.mock("../lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/platform")>()),
  IS_MAC: true,
  IS_WIN: false,
}));

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
/** Sign-up beside a page, as one split entry. */
const split = (focusedId = "signup"): StripSplit => ({
  id: SPLIT,
  segments: [
    { id: "signup", tab: tab("signup", "Add sign-up flow") },
    { id: "page", page: { title: "linking.coaching" } },
  ],
  focusedId,
});

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof TitleBar>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  // The window's strip, as App draws it: single tabs and a split.
  props = {
    paneLocal: true,
    variant: "strip",
    hideLoneTab: true,
    windowTitle: false,
    tabs: [
      tab("hero", "Tighten the hero layout"),
      tab("checkout", "Fix the flaky checkout test"),
    ],
    splits: [split()],
    surfaceOrder: ["hero", "checkout", SPLIT],
    activeId: "hero",
    visibleIds: ["hero"],
    cwd: "/projects/demo",
    onToggleSidebar: vi.fn(),
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onClose: vi.fn(),
    onCloseMany: vi.fn(),
    onReorder: vi.fn(),
    onReorderSurfaces: vi.fn(),
    onSelectSplitTab: vi.fn(),
    onAddToSplit: vi.fn(),
    onDetachFromSplit: vi.fn(),
    onSeparateSplit: vi.fn(),
    onCloseSplit: vi.fn(),
    onSurfaceDragMove: vi.fn(),
    // Like the stage: a drop over the strip is not a pane's.
    onSurfaceDragEnd: vi.fn(() => false),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
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
const entry = () => container.querySelector<HTMLElement>("[data-split-entry]")!;
const segments = () => [
  ...container.querySelectorAll<HTMLButtonElement>("[data-split-segment]"),
];
const segment = (id: string) =>
  container.querySelector<HTMLButtonElement>(`[data-split-segment="${id}"]`)!;
const tabButton = (id: string) =>
  container.querySelector<HTMLButtonElement>(
    `[data-surface-tab-id="${id}"] [role="tab"]`,
  )!;
const menuItems = () =>
  [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].map(
    (item) => item.textContent?.trim(),
  );
const menuItem = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(
    (item) => item.textContent?.trim() === text,
  )!;
const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

describe("a split on the window's strip", () => {
  it("is one entry with a segment per pane, each naming its pane's front tab", async () => {
    await render();
    expect(container.querySelectorAll("[data-split-entry]")).toHaveLength(1);
    expect(segments().map((node) => node.dataset.splitSegment)).toEqual([
      "signup",
      "page",
    ]);
    expect(segments().map((node) => node.textContent)).toEqual([
      "Add sign-up flow",
      "linking.coaching",
    ]);
    // A chat shows its agent's mark, a page its icon.
    expect(
      segment("signup").querySelector(".personal-title-tab-identity"),
    ).not.toBeNull();
    expect(segment("page").querySelector("img")).not.toBeNull();
    // One hairline between the two segments.
    expect(entry().querySelectorAll(".aven-split-divider")).toHaveLength(1);
    // Three panes: three segments.
    await render({
      splits: [
        {
          ...split(),
          segments: [
            ...split().segments,
            { id: "checkout", tab: tab("checkout", "Fix the flaky checkout") },
          ],
        },
      ],
      tabs: [tab("hero", "Tighten the hero layout")],
      surfaceOrder: ["hero", SPLIT],
    });
    expect(segments()).toHaveLength(3);
    expect(entry().style.getPropertyValue("--aven-split-panes")).toBe("3");
  });

  it("rests apart from its neighbours, and lights its focused pane in front", async () => {
    await render();
    expect(entry().dataset.active).toBe("false");
    expect(segments().some((node) => node.dataset.lit)).toBe(false);
    // No hairline parts a split from the tab beside it.
    expect(entry().hasAttribute("data-tab-separator")).toBe(false);

    await render({ activeId: SPLIT, visibleIds: [SPLIT], splits: [split()] });
    expect(entry().dataset.active).toBe("true");
    // The highlight lands on the entry itself.
    expect(entry().getAttribute("data-tab-track-id")).toBe(SPLIT);
    expect(segment("signup").dataset.lit).toBe("true");
    expect(segment("page").dataset.lit).toBeUndefined();

    await render({ splits: [split("page")] });
    expect(segment("page").dataset.lit).toBe("true");
  });

  it("goes straight to a pane's tab in one click, in front or not", async () => {
    await render();
    await act(async () => segment("page").click());
    expect(props.onSelectSplitTab).toHaveBeenCalledExactlyOnceWith("page");
    expect(props.onSelect).not.toHaveBeenCalled();

    await render({ activeId: SPLIT, visibleIds: [SPLIT] });
    await act(async () => segment("signup").click());
    expect(props.onSelectSplitTab).toHaveBeenLastCalledWith("signup");
    expect(props.onSelectSplitTab).toHaveBeenCalledTimes(2);
  });

  it("says where a segment of a split behind goes, once pointed at", async () => {
    await render();
    expect(segment("page").getAttribute("aria-description")).toBe(
      "Go to linking.coaching in the split",
    );
    await act(async () => {
      segment("page").dispatchEvent(
        new PointerEvent("pointerover", { bubbles: true, pointerId: 1 }),
      );
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await wait(500);
    const tip = document.querySelector<HTMLElement>('[role="tooltip"]');
    expect(tip?.textContent).toBe("Go to linking.coaching in the split");
    expect(tip?.dataset.nativeBrowserOccluded).toBe("true");
    await act(async () => {
      segment("page").dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, pointerId: 1 }),
      );
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();

    // In front, a segment names its tab as any tab does instead.
    await render({ activeId: SPLIT, visibleIds: [SPLIT] });
    expect(segment("page").getAttribute("aria-description")).toBe(
      "In the split",
    );
    expect(segment("page").title).toBe("linking.coaching");
  });

  it("never says space or N panes", async () => {
    const words = () => {
      const text = [container.textContent ?? ""];
      for (const node of container.querySelectorAll<HTMLElement>("*"))
        for (const attribute of ["aria-label", "title", "aria-description"])
          text.push(node.getAttribute(attribute) ?? "");
      return text.join("\n");
    };
    for (const activeId of ["hero", SPLIT]) {
      await render({ activeId, visibleIds: [activeId] });
      expect(words()).not.toMatch(/\bspaces?\b/i);
      expect(words()).not.toMatch(/\d+\s+panes\b/i);
    }
    await act(async () => {
      entry().dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    expect(menuItems().join("\n")).not.toMatch(/\bspaces?\b|\bpanes\b/i);
  });
});

describe("a split's menu", () => {
  async function openMenu() {
    await act(async () => {
      entry().dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
  }

  it("offers Separate split and Close split", async () => {
    await render();
    await openMenu();
    expect(menuItems()).toEqual(["Separate split", "Close split"]);
    await act(async () => menuItem("Separate split").click());
    expect(props.onSeparateSplit).toHaveBeenCalledExactlyOnceWith(SPLIT);

    await openMenu();
    await act(async () => menuItem("Close split").click());
    expect(props.onCloseSplit).toHaveBeenCalledExactlyOnceWith(SPLIT);
  });

  it("cannot close a split that would leave no chat", async () => {
    await render({ splits: [{ ...split(), closable: false }] });
    await openMenu();
    const close = menuItem("Close split");
    expect(
      close.getAttribute("aria-disabled") === "true" ||
        (close as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => close.click());
    expect(props.onCloseSplit).not.toHaveBeenCalled();
  });
});

describe("the keyboard on a split", () => {
  it("makes each segment a tab of the strip, so the arrows step through them", async () => {
    await render();
    // One tablist of tabs: no group inside it.
    expect(strip().getAttribute("role")).toBe("tablist");
    expect(strip().querySelector('[role="group"]')).toBeNull();
    expect(segments().every((node) => node.getAttribute("role") === "tab"));
    expect(
      [...strip().querySelectorAll('[role="tab"]')].map(
        (node) =>
          (node as HTMLElement).dataset.splitSegment ??
          node.closest<HTMLElement>("[data-surface-tab-id]")?.dataset
            .surfaceTabId,
      ),
    ).toEqual(["hero", "checkout", "signup", "page"]);

    const press = (target: HTMLElement, key: string) =>
      act(async () => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
      });
    tabButton("checkout").focus();
    await press(tabButton("checkout"), "ArrowRight");
    expect(document.activeElement).toBe(segment("signup"));
    expect(props.onSelectSplitTab).toHaveBeenLastCalledWith("signup");

    // Within the split, the arrows move between its segments.
    await render({ activeId: SPLIT, visibleIds: [SPLIT] });
    await press(segment("signup"), "ArrowRight");
    expect(document.activeElement).toBe(segment("page"));
    expect(props.onSelectSplitTab).toHaveBeenLastCalledWith("page");
    await render({ splits: [split("page")] });
    await press(segment("page"), "ArrowLeft");
    expect(document.activeElement).toBe(segment("signup"));
    expect(props.onSelectSplitTab).toHaveBeenLastCalledWith("signup");
    // And out of it, back to the single tabs.
    await press(segment("signup"), "ArrowLeft");
    expect(document.activeElement).toBe(tabButton("checkout"));
    expect(props.onSelect).toHaveBeenLastCalledWith("checkout");
  });

  it("selects the focused pane's segment and keeps one tab stop", async () => {
    await render({
      activeId: SPLIT,
      visibleIds: [SPLIT],
      splits: [split("page")],
    });
    expect(segment("page").getAttribute("aria-selected")).toBe("true");
    expect(segment("signup").getAttribute("aria-selected")).toBe("false");
    expect(tabButton("hero").getAttribute("aria-selected")).toBe("false");
    const stops = [...strip().querySelectorAll('[role="tab"]')].filter(
      (node) => node.getAttribute("tabindex") === "0",
    );
    expect(stops).toEqual([segment("page")]);
  });
});

describe("dragging with splits", () => {
  /**
   * Lay the strip out: hero 0-100, checkout 100-200, the split 200-400
   * (sign-up 200-300, page 300-400), all 30px tall in a 500px strip.
   */
  function layOut() {
    const box = (element: HTMLElement, left: number, width: number) => {
      element.getBoundingClientRect = () => new DOMRect(left, 0, width, 30);
      element.setPointerCapture = vi.fn();
      element.releasePointerCapture = vi.fn();
    };
    for (const [id, left, width] of [
      ["hero", 0, 100],
      ["checkout", 100, 100],
      [SPLIT, 200, 200],
    ] as const) {
      for (const node of container.querySelectorAll<HTMLElement>(
        `[data-surface-tab-id="${id}"], [data-motion-slot="${id}"]`,
      ))
        box(node, left, width);
    }
    box(segment("signup"), 202, 98);
    box(segment("page"), 300, 98);
    strip().getBoundingClientRect = () => new DOMRect(0, 0, 500, 30);
  }
  const pointer = (target: EventTarget, type: string, x: number, y = 15) =>
    act(async () => {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          button: 0,
          clientX: x,
          clientY: y,
        }),
      );
    });
  /** Let the drag's frame run. */
  const frame = () => wait(40);

  it("adds a tab let go on a split's entry as a pane", async () => {
    await render();
    layOut();
    await pointer(tabButton("hero"), "pointerdown", 50);
    await pointer(window, "pointermove", 120);
    await frame();
    await pointer(window, "pointermove", 300);
    await frame();
    expect(entry().dataset.dropInto).toBe("true");
    await pointer(window, "pointerup", 300);
    expect(props.onAddToSplit).toHaveBeenCalledExactlyOnceWith(SPLIT, "hero");
    expect(props.onReorderSurfaces).not.toHaveBeenCalled();
  });

  it("still reorders past a split's edge, and moves the split like a tab", async () => {
    await render();
    layOut();
    // A tab over the split's outer edge is a move, not a drop into it.
    await pointer(tabButton("hero"), "pointerdown", 50);
    await pointer(window, "pointermove", 120);
    await frame();
    await pointer(window, "pointermove", 390);
    await frame();
    await pointer(window, "pointerup", 390);
    expect(props.onAddToSplit).not.toHaveBeenCalled();
    expect(props.onReorderSurfaces).toHaveBeenLastCalledWith(
      ["checkout", SPLIT, "hero"],
      "hero",
    );

    // Pressing a segment and moving along the strip moves the whole split.
    await render();
    layOut();
    await pointer(segment("page"), "pointerdown", 350);
    await pointer(window, "pointermove", 300);
    await frame();
    await pointer(window, "pointermove", 20);
    await frame();
    await pointer(window, "pointerup", 20);
    expect(props.onReorderSurfaces).toHaveBeenLastCalledWith(
      [SPLIT, "hero", "checkout"],
      SPLIT,
    );
    expect(props.onDetachFromSplit).not.toHaveBeenCalled();
    expect(props.onSelectSplitTab).not.toHaveBeenCalled();
  });

  it("pulls a segment's tab out of the split onto a pane", async () => {
    await render();
    layOut();
    await pointer(segment("page"), "pointerdown", 350);
    await pointer(window, "pointermove", 350, 60);
    await frame();
    // Out of the strip, it drags as its own tab.
    expect(props.onSurfaceDragMove).toHaveBeenLastCalledWith(
      "page",
      350,
      60,
      expect.anything(),
    );
    expect(segment("page").dataset.sortableTornPart).toBe("true");
    await pointer(window, "pointermove", 420, 300);
    await frame();
    await pointer(window, "pointerup", 420, 300);
    expect(props.onSurfaceDragEnd).toHaveBeenLastCalledWith(
      "page",
      420,
      300,
      false,
      expect.anything(),
    );
    expect(props.onReorderSurfaces).not.toHaveBeenCalled();
    expect(props.onDetachFromSplit).not.toHaveBeenCalled();
    expect(segment("page").dataset.sortableTornPart).toBeUndefined();
  });

  it("leaves a segment's tab on the strip, alone, when let go back there", async () => {
    await render();
    layOut();
    await pointer(segment("page"), "pointerdown", 350);
    await pointer(window, "pointermove", 350, 80);
    await frame();
    // Back over the strip, before checkout: a line shows where it lands.
    await pointer(window, "pointermove", 130, 15);
    await frame();
    expect(container.querySelector("[data-tear-insertion]")).not.toBeNull();
    await pointer(window, "pointerup", 130, 15);
    expect(props.onDetachFromSplit).toHaveBeenCalledExactlyOnceWith(
      "page",
      "checkout",
    );
    // The stage only clears its drop hints.
    expect(props.onSurfaceDragEnd).toHaveBeenLastCalledWith(
      "page",
      130,
      15,
      true,
      expect.anything(),
    );
    expect(props.onReorderSurfaces).not.toHaveBeenCalled();
    expect(container.querySelector("[data-tear-insertion]")).toBeNull();

    // Past the last entry: at the end.
    await pointer(segment("page"), "pointerdown", 350);
    await pointer(window, "pointermove", 350, 80);
    await frame();
    await pointer(window, "pointermove", 480, 15);
    await frame();
    await pointer(window, "pointerup", 480, 15);
    expect(props.onDetachFromSplit).toHaveBeenLastCalledWith("page", null);
  });
});
