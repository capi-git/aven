// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_BROWSER_HOLES,
  browserOverlayState,
  type BrowserOverlayState,
} from "./browserOverlays";
import type { BrowserBounds } from "./browser";

const bounds: BrowserBounds = {
  x: 100,
  y: 80,
  width: 600,
  height: 500,
  scale: 2,
};

type Style = Partial<
  Pick<
    CSSStyleDeclaration,
    | "visibility"
    | "opacity"
    | "transform"
    | "transformOrigin"
    | "borderTopLeftRadius"
    | "borderTopRightRadius"
    | "borderBottomRightRadius"
    | "borderBottomLeftRadius"
  >
>;

describe("browser overlay cut-outs", () => {
  const styles = new Map<Element, Style>();
  beforeEach(() => {
    const original = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = styles.get(element);
      if (!style) return original(element);
      return {
        visibility: "visible",
        opacity: "1",
        transform: "none",
        transformOrigin: "0px 0px",
        borderTopLeftRadius: "0px",
        borderTopRightRadius: "0px",
        borderBottomRightRadius: "0px",
        borderBottomLeftRadius: "0px",
        ...style,
      } as CSSStyleDeclaration;
    });
  });
  afterEach(() => {
    styles.clear();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const overlay = (
    rect: DOMRect,
    {
      role = "menu",
      style = {},
      parent = document.body,
    }: { role?: string; style?: Style; parent?: HTMLElement } = {},
  ) => {
    const element = document.createElement("div");
    element.setAttribute("role", role);
    vi.spyOn(element, "getClientRects").mockReturnValue([
      rect,
    ] as unknown as DOMRectList);
    styles.set(element, style);
    parent.appendChild(element);
    return element;
  };
  const state = (supported = true, target = bounds): BrowserOverlayState =>
    browserOverlayState(target, supported);

  it("cuts a rounded menu out of the live page in page-relative pixels", () => {
    const menu = overlay(new DOMRect(400, 120, 224, 300), {
      style: {
        borderTopLeftRadius: "12px",
        borderTopRightRadius: "12px",
        borderBottomRightRadius: "12px",
        borderBottomLeftRadius: "12px",
      },
    });
    expect(state()).toEqual({
      capture: false,
      holes: [{ x: 300, y: 40, width: 224, height: 300, radius: 12 }],
      elements: [menu],
    });
  });

  it("uses the still-image path when the engine has no cut-out support", () => {
    overlay(new DOMRect(400, 120, 224, 300));
    expect(state(false)).toEqual({ capture: true, holes: [], elements: [] });
  });

  it("ignores surfaces outside the page or behind a covered sidebar edge", () => {
    overlay(new DOMRect(10, 100, 80, 300));
    overlay(new DOMRect(150, 100, 40, 40));
    expect(state(true, { ...bounds, clipLeft: 120 })).toEqual({
      capture: false,
      holes: [],
      elements: [],
    });
  });

  it("cuts a menu crossing the page edge with its whole rounded shape", () => {
    // Rounding only the visible part would bite into the menu at the edge.
    overlay(new DOMRect(650, 560, 200, 100), {
      style: {
        borderTopLeftRadius: "40px",
        borderTopRightRadius: "40px",
        borderBottomRightRadius: "40px",
        borderBottomLeftRadius: "40px",
      },
    });
    expect(state().holes).toEqual([
      { x: 550, y: 480, width: 200, height: 100, radius: 40 },
    ]);
  });

  it("keeps a menu that starts above the page as one shape", () => {
    overlay(new DOMRect(300, 40, 180, 160), {
      style: {
        borderTopLeftRadius: "12px",
        borderTopRightRadius: "12px",
        borderBottomRightRadius: "12px",
        borderBottomLeftRadius: "12px",
      },
    });
    expect(state().holes).toEqual([
      { x: 200, y: -40, width: 180, height: 160, radius: 12 },
    ]);
  });

  it("rounds a square frame that shares its box with a rounded surface", () => {
    const frame = overlay(new DOMRect(300, 100, 200, 240));
    frame.dataset.popoverSide = "bottom";
    frame.removeAttribute("role");
    overlay(new DOMRect(300, 100, 200, 240), {
      parent: frame,
      style: {
        borderTopLeftRadius: "12px",
        borderTopRightRadius: "12px",
        borderBottomRightRadius: "12px",
        borderBottomLeftRadius: "12px",
      },
    });
    expect(state().holes).toEqual([
      { x: 200, y: 20, width: 200, height: 240, radius: 12 },
    ]);
  });

  it("keeps the smallest corner radius and ignores percentages", () => {
    overlay(new DOMRect(200, 100, 100, 100), {
      style: {
        borderTopLeftRadius: "10px",
        borderTopRightRadius: "4px",
        borderBottomRightRadius: "10px",
        borderBottomLeftRadius: "10px",
      },
    });
    overlay(new DOMRect(400, 100, 100, 100), {
      style: {
        borderTopLeftRadius: "50%",
        borderTopRightRadius: "50%",
        borderBottomRightRadius: "50%",
        borderBottomLeftRadius: "50%",
      },
    });
    expect(state().holes.map((hole) => hole.radius)).toEqual([4, 0]);
  });

  it("keeps only the outermost of a popover frame and its nested surfaces", () => {
    const frame = overlay(new DOMRect(300, 100, 200, 240));
    frame.dataset.popoverSide = "bottom";
    frame.removeAttribute("role");
    const surface = overlay(new DOMRect(300, 100, 200, 240), {
      parent: frame,
    });
    surface.dataset.popoverSide = "bottom";
    surface.removeAttribute("role");
    overlay(new DOMRect(304, 104, 192, 200), { parent: surface });
    const result = state();
    expect(result.holes).toEqual([
      { x: 200, y: 20, width: 200, height: 240, radius: 0 },
    ]);
    expect(result.elements).toEqual([frame]);
  });

  it("cuts an entering menu at its final rectangle, even at opacity zero", () => {
    // A 200x300 menu that starts at scale(0.94) from its top-left origin and
    // 8px above its final position.
    const menu = overlay(new DOMRect(300, 92, 188, 282), {
      style: {
        opacity: "0",
        transform: "matrix(0.94, 0, 0, 0.94, 0, -8)",
        transformOrigin: "0px 0px",
      },
    });
    Object.defineProperties(menu, {
      offsetWidth: { value: 200 },
      offsetHeight: { value: 300 },
    });
    vi.spyOn(menu, "getAnimations").mockReturnValue([
      { playState: "running", pending: false } as unknown as Animation,
    ]);
    const hole = state().holes[0];
    expect(hole.x).toBeCloseTo(200);
    expect(hole.y).toBeCloseTo(20);
    expect(hole.width).toBe(200);
    expect(hole.height).toBe(300);
  });

  it("skips a surface left at opacity zero without an entrance animation", () => {
    const menu = overlay(new DOMRect(300, 100, 200, 240), {
      style: { opacity: "0" },
    });
    vi.spyOn(menu, "getAnimations").mockReturnValue([]);
    expect(state()).toEqual({ capture: false, holes: [], elements: [] });
    overlay(new DOMRect(300, 100, 200, 240), {
      style: { visibility: "hidden" },
    });
    expect(state().holes).toEqual([]);
  });

  it("captures for a true modal anywhere, even when it would fit a cut-out", () => {
    overlay(new DOMRect(300, 100, 200, 240));
    const modal = overlay(new DOMRect(5, 5, 40, 40), { role: "dialog" });
    modal.setAttribute("aria-modal", "true");
    expect(state()).toEqual({ capture: true, holes: [], elements: [] });
  });

  it("captures when menus would cover most of the page or exceed the cut-out limit", () => {
    const large = overlay(new DOMRect(100, 80, 500, 400));
    expect(state().capture).toBe(true);
    large.remove();
    for (let index = 0; index <= MAX_BROWSER_HOLES; index++)
      overlay(new DOMRect(110 + index * 60, 100, 40, 40));
    expect(state().capture).toBe(true);
    document.body.lastElementChild!.remove();
    expect(state()).toMatchObject({ capture: false });
    expect(state().holes).toHaveLength(MAX_BROWSER_HOLES);
  });

  it("leaves hover sidebar edges to the clip path", () => {
    const sidebar = overlay(new DOMRect(100, 80, 200, 500));
    sidebar.removeAttribute("role");
    sidebar.dataset.nativeBrowserOccluded = "true";
    sidebar.dataset.nativeBrowserEdge = "left";
    expect(state()).toEqual({ capture: false, holes: [], elements: [] });
  });
});
