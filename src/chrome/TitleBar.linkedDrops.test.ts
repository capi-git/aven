// @vitest-environment happy-dom
import { act, createElement, Fragment, type ComponentProps } from "react";
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
vi.mock("../lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/platform")>()),
  IS_MAC: true,
  IS_WIN: false,
}));

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

/**
 * The window as App draws it with a split in front: the window's strip
 * (two single tabs and the split) and the split's left pane, whose title
 * row holds two tabs, sign-up in front and a draft behind it.
 */
const SPLIT = "aven-space:s1";
const split: StripSplit = {
  id: SPLIT,
  segments: [
    { id: "signup", tab: tab("signup", "Add sign-up flow") },
    { id: "notes", tab: tab("notes", "Release notes") },
  ],
  focusedId: "signup",
  members: ["signup", "draft", "notes"],
};

/**
 * Where everything is drawn. The strip (y 0–30): hero 0–100, checkout
 * 100–200, the split 200–400 (sign-up 202–300, notes 300–398). The pane's
 * title row (y 100–130): sign-up 0–150, the draft 150–300.
 */
function layout(element: HTMLElement): DOMRect {
  const bar = element.closest<HTMLElement>("[data-bar]")?.dataset.bar;
  const top = bar === "row" ? 100 : 0;
  const rect = (left: number, width: number) =>
    new DOMRect(left, top, width, 30);
  const segment = element.closest<HTMLElement>("[data-split-segment]");
  if (segment && bar === "strip")
    return segment.dataset.splitSegment === "signup"
      ? rect(202, 98)
      : rect(300, 98);
  const item = element.closest<HTMLElement>(
    "[data-surface-tab-id], [data-motion-slot]",
  );
  const id = item?.dataset.surfaceTabId ?? item?.dataset.motionSlot;
  if (bar === "strip") {
    if (id === "hero") return rect(0, 100);
    if (id === "checkout") return rect(100, 100);
    if (id === SPLIT) return rect(200, 200);
    if (element.matches('[aria-label="Workspace tabs"]')) return rect(0, 500);
  }
  if (bar === "row") {
    if (id === "signup") return rect(0, 150);
    if (id === "draft") return rect(150, 150);
    if (
      element.matches('[aria-label="Tabs in this pane"], [aria-label="Pane"]')
    )
      return rect(0, 300);
  }
  return new DOMRect(0, 0, 0, 0);
}

let root: Root;
let container: HTMLDivElement;
let strip: ComponentProps<typeof TitleBar>;
let row: ComponentProps<typeof TitleBar>;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });
  // On that clock a test can end mid-animation. Browsers mark a cancelled
  // animation's finished promise as handled; happy-dom leaves it unhandled.
  const cancel = Animation.prototype.cancel;
  vi.spyOn(Animation.prototype, "cancel").mockImplementation(function (
    this: Animation,
  ) {
    this.finished.catch(() => {});
    cancel.call(this);
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return layout(this);
    },
  );
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const common = {
    paneLocal: true,
    cwd: "/projects/demo",
    onToggleSidebar: vi.fn(),
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onClose: vi.fn(),
    onCloseMany: vi.fn(),
    onReorder: vi.fn(),
    onReorderSurfaces: vi.fn(),
    onSurfaceDragMove: vi.fn(),
    // Like the stage: nothing here is a pane's drop.
    onSurfaceDragEnd: vi.fn(() => false),
  };
  strip = {
    ...common,
    variant: "strip",
    hideLoneTab: true,
    acceptsPaneDrops: true,
    windowTitle: false,
    tabs: [
      tab("hero", "Tighten the hero layout"),
      tab("checkout", "Fix the flaky checkout test"),
    ],
    splits: [split],
    surfaceOrder: ["hero", "checkout", SPLIT],
    activeId: SPLIT,
    visibleIds: [SPLIT],
    onSelectSplitTab: vi.fn(),
    onAddToSplit: vi.fn(),
    onCombineTabs: vi.fn(),
    onDetachFromSplit: vi.fn(),
  };
  row = {
    ...common,
    variant: "title",
    stackOnStrip: false,
    tabs: [tab("signup", "Add sign-up flow"), tab("draft", "Draft the copy")],
    surfaceOrder: ["signup", "draft"],
    activeId: "signup",
    visibleIds: ["signup", "notes"],
    onDropOnStrip: vi.fn(),
    onPairTabs: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetHarnessModelOverlays();
});

async function render() {
  await act(async () =>
    root.render(
      createElement(
        Fragment,
        null,
        createElement(
          "div",
          { "data-bar": "strip" },
          createElement(TitleBar, strip),
        ),
        createElement(
          "div",
          { "data-bar": "row" },
          createElement(TitleBar, row),
        ),
      ),
    ),
  );
}

const inBar = (bar: string) =>
  container.querySelector<HTMLElement>(`[data-bar="${bar}"]`)!;
const tabIn = (bar: string, id: string) =>
  inBar(bar).querySelector<HTMLElement>(
    `[data-surface-tab-id="${id}"] [role="tab"], [data-surface-tab-id="${id}"] button`,
  )!;
const combineTarget = (bar: string) =>
  inBar(bar).querySelector<HTMLElement>("[data-combine-into]");
const nearTarget = (bar: string) =>
  inBar(bar).querySelector<HTMLElement>("[data-combine-near]");
/** The tabs drawing an insertion line, where a release would move one. */
const insertionIn = (bar: string) =>
  [...inBar(bar).querySelectorAll<HTMLElement>(".personal-tab-insertion")].map(
    (line) =>
      line.closest<HTMLElement>("[data-surface-tab-id]")?.dataset.surfaceTabId,
  );
const pointer = (target: EventTarget, type: string, x: number, y: number) =>
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
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
/** Let the drag's frame run. */
const frame = () => wait(40);
/** Rest where the pointer is until a drop there arms, and paint. */
const arm = async () => {
  await wait(260);
  await frame();
};
/** Press `handle` at (x, y) and carry it out of its bar, to between them. */
async function lift(handle: Element, x: number, y: number) {
  await pointer(handle, "pointerdown", x, y);
  await pointer(window, "pointermove", x + 10, 60);
  await frame();
}
/** Move the held pointer to (x, y) and paint. */
async function hold(x: number, y: number) {
  await pointer(window, "pointermove", x, y);
  await frame();
}

describe("a pane's tab let go on the window's strip", () => {
  it("makes a split with a single tab let go on its middle, without resting", async () => {
    await render();
    await lift(tabIn("row", "draft"), 225, 115);
    // Checkout's middle is 125–175.
    await hold(150, 15);
    await pointer(window, "pointerup", 150, 15);
    expect(strip.onCombineTabs).toHaveBeenCalledExactlyOnceWith(
      "checkout",
      "draft",
    );
    // It does not also stand on the strip, and the stage only tidied up.
    expect(row.onDropOnStrip).not.toHaveBeenCalled();
    expect(row.onSurfaceDragEnd).toHaveBeenLastCalledWith(
      "draft",
      150,
      15,
      true,
      expect.anything(),
    );
    expect(row.onPairTabs).not.toHaveBeenCalled();
    expect(row.onReorderSurfaces).not.toHaveBeenCalled();
    expect(combineTarget("strip")).toBeNull();
  });

  it("previews the split on the strip's tab once it rests there, with no line", async () => {
    await render();
    await lift(tabIn("row", "draft"), 225, 115);
    await hold(150, 15);
    // On checkout's middle a release combines: at once a light hint marks
    // it, no line says it would stand on the strip, and no pane takes it.
    expect(combineTarget("strip")).toBeNull();
    expect(nearTarget("strip")?.dataset.surfaceTabId).toBe("checkout");
    expect(inBar("strip").querySelector("[data-tear-insertion]")).toBeNull();
    expect(row.onSurfaceDragMove).toHaveBeenLastCalledWith(
      "draft",
      150,
      15,
      expect.anything(),
      true,
    );
    await arm();
    // Resting, checkout previews the split it would make with the draft.
    expect(combineTarget("strip")?.dataset.surfaceTabId).toBe("checkout");
    expect(
      combineTarget("strip")?.querySelector("[data-combine-incoming]")
        ?.textContent,
    ).toContain("Draft the copy");
    expect(inBar("strip").querySelector("[data-tear-insertion]")).toBeNull();
    // No pane takes it meanwhile.
    expect(row.onSurfaceDragMove).toHaveBeenLastCalledWith(
      "draft",
      150,
      15,
      expect.anything(),
      true,
    );
    await pointer(window, "pointerup", 150, 15);
    expect(strip.onCombineTabs).toHaveBeenCalledExactlyOnceWith(
      "checkout",
      "draft",
    );
    expect(combineTarget("strip")).toBeNull();
  });

  it("still stands on the strip, alone, let go at a tab's edge", async () => {
    await render();
    await lift(tabIn("row", "draft"), 225, 115);
    await hold(190, 15);
    await arm();
    expect(combineTarget("strip")).toBeNull();
    await pointer(window, "pointerup", 190, 15);
    expect(strip.onCombineTabs).not.toHaveBeenCalled();
    expect(row.onDropOnStrip).toHaveBeenCalledExactlyOnceWith("draft", SPLIT);
  });

  it("joins another split beside the segment it is let go on", async () => {
    // A split the draft is not in.
    strip = {
      ...strip,
      splits: [{ ...split, members: ["signup", "notes"] }],
    };
    await render();
    await lift(tabIn("row", "draft"), 225, 115);
    // Notes (300–398), its first half.
    await hold(330, 15);
    await pointer(window, "pointerup", 330, 15);
    expect(strip.onAddToSplit).toHaveBeenCalledExactlyOnceWith(SPLIT, "draft", {
      pane: "notes",
      side: "before",
    });
    expect(row.onDropOnStrip).not.toHaveBeenCalled();
  });

  it("goes back to the strip let go on its own split, never into it", async () => {
    await render();
    await lift(tabIn("row", "draft"), 225, 115);
    await hold(330, 15);
    await arm();
    expect(inBar("strip").querySelector("[data-drop-into]")).toBeNull();
    await pointer(window, "pointerup", 330, 15);
    expect(strip.onAddToSplit).not.toHaveBeenCalled();
    expect(row.onDropOnStrip).toHaveBeenCalledExactlyOnceWith("draft", null);
  });
});

describe("a lone pane's header let go on the window's strip", () => {
  it("makes a split of its tab and the strip's tab", async () => {
    // A single tab in front: its pane's header names nothing and moves it
    // by its empty space.
    row = {
      ...row,
      stackOnStrip: true,
      frontNamedBelow: true,
      tabs: [tab("signup", "Add sign-up flow")],
      surfaceOrder: ["signup"],
      visibleIds: ["signup"],
    };
    await render();
    const handle = inBar("row").querySelector<HTMLElement>(
      '[aria-label="Pane"]',
    )!;
    await lift(handle, 200, 115);
    await hold(50, 15);
    await pointer(window, "pointerup", 50, 15);
    expect(strip.onCombineTabs).toHaveBeenCalledExactlyOnceWith(
      "hero",
      "signup",
    );
    expect(row.onDropOnStrip).not.toHaveBeenCalled();
  });
});

describe("a tab let go on a tab in a pane's row", () => {
  it("pairs a strip tab let go on its middle with it", async () => {
    await render();
    await lift(tabIn("strip", "hero"), 50, 15);
    // Sign-up's middle in the row is 37.5–112.5.
    await hold(75, 115);
    await arm();
    expect(combineTarget("row")?.dataset.surfaceTabId).toBe("signup");
    expect(
      combineTarget("row")?.querySelector("[data-combine-incoming]")
        ?.textContent,
    ).toContain("Tighten the hero layout");
    // The strip's own pane drop is off meanwhile.
    expect(strip.onSurfaceDragMove).toHaveBeenLastCalledWith(
      "hero",
      75,
      115,
      expect.anything(),
      true,
    );
    await pointer(window, "pointerup", 75, 115);
    expect(row.onPairTabs).toHaveBeenCalledExactlyOnceWith("signup", "hero");
    expect(strip.onReorderSurfaces).not.toHaveBeenCalled();
    expect(strip.onSurfaceDragEnd).toHaveBeenLastCalledWith(
      "hero",
      75,
      115,
      true,
      expect.anything(),
    );
    expect(combineTarget("row")).toBeNull();
  });

  it("pairs two tabs of the same row let go on the middle, and reorders at the edge", async () => {
    await render();
    await pointer(tabIn("row", "signup"), "pointerdown", 75, 115);
    await hold(100, 115);
    // The draft's middle is 187.5–262.5.
    await hold(225, 115);
    await pointer(window, "pointerup", 225, 115);
    expect(row.onPairTabs).toHaveBeenCalledExactlyOnceWith("draft", "signup");
    expect(row.onReorderSurfaces).not.toHaveBeenCalled();

    await wait(600);
    await pointer(tabIn("row", "signup"), "pointerdown", 75, 115);
    await hold(100, 115);
    await hold(290, 115);
    await arm();
    await pointer(window, "pointerup", 290, 115);
    expect(row.onPairTabs).toHaveBeenCalledOnce();
    expect(row.onReorderSurfaces).toHaveBeenCalledExactlyOnceWith(
      ["draft", "signup"],
      "signup",
    );
  });
});

describe("what shows at release is what a release does", () => {
  it("pairs a brisk drag in a pane's row let go past a neighbour's midpoint, having shown no line", async () => {
    await render();
    await pointer(tabIn("row", "signup"), "pointerdown", 75, 115);
    // To the right, one move per frame, no rest: into the draft's middle
    // (187.5–262.5), past its midpoint.
    for (const x of [100, 140, 180, 220, 240]) await hold(x, 115);
    expect(insertionIn("row")).toEqual([]);
    expect(nearTarget("row")?.dataset.surfaceTabId).toBe("draft");
    await pointer(window, "pointerup", 240, 115);
    expect(row.onPairTabs).toHaveBeenCalledExactlyOnceWith("draft", "signup");
    expect(row.onReorderSurfaces).not.toHaveBeenCalled();
  });

  it("combines on the strip let go past a neighbour's midpoint, and moves past its far edge", async () => {
    await render();
    await pointer(tabIn("strip", "hero"), "pointerdown", 50, 15);
    // Into checkout's middle (125–175), past its midpoint.
    for (const x of [70, 100, 130, 160]) await hold(x, 15);
    expect(insertionIn("strip")).toEqual([]);
    expect(nearTarget("strip")?.dataset.surfaceTabId).toBe("checkout");
    await pointer(window, "pointerup", 160, 15);
    expect(strip.onCombineTabs).toHaveBeenCalledExactlyOnceWith(
      "checkout",
      "hero",
    );
    expect(strip.onReorderSurfaces).not.toHaveBeenCalled();

    // On to checkout's far edge: the line shows past it, and a release
    // there moves the tab.
    await wait(600);
    await pointer(tabIn("strip", "hero"), "pointerdown", 50, 15);
    for (const x of [70, 100, 130, 160, 190]) await hold(x, 15);
    expect(insertionIn("strip")).toEqual(["checkout"]);
    expect(nearTarget("strip")).toBeNull();
    await pointer(window, "pointerup", 190, 15);
    expect(strip.onCombineTabs).toHaveBeenCalledOnce();
    expect(strip.onReorderSurfaces).toHaveBeenCalledExactlyOnceWith(
      ["checkout", "hero", SPLIT],
      "hero",
    );
  });
});
