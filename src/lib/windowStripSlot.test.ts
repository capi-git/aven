// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { setCssZoomRectsForTests, type CssZoomRects } from "./drag";
import { overStrip, stripSlotAt } from "./windowStripSlot";

/**
 * The window's strip at an interface zoom: its CSS zoom cancels it (1.25
 * at 80%, 1/1.2 at 120%), so each of its pixels is that many of the
 * viewport's, where the pointer is. Its entries are 100px wide from 10px
 * into its content; the strip is 500 by 40 of its own pixels at the
 * viewport's left edge, scrolled `scroll`.
 */
function strip(engine: CssZoomRects, ui: number, scroll = 0) {
  setCssZoomRectsForTests(engine);
  const zoom = 1 / ui;
  // Legacy WebKit reports rects divided by the zoom.
  const reported = engine === "legacy" ? 1 : zoom;
  const zoomed = (element: HTMLElement, left: number, width: number) => {
    Object.defineProperty(element, "currentCSSZoom", { value: zoom });
    element.getBoundingClientRect = () =>
      new DOMRect(left * reported, 0, width * reported, 40 * reported);
    return element;
  };
  const root = zoomed(document.createElement("div"), 0, 500);
  Object.defineProperty(root, "scrollLeft", { value: scroll });
  const slots = ["a", "b", "c"].map((id, index) => {
    const slot = zoomed(
      document.createElement("div"),
      10 + 100 * index - scroll,
      100,
    );
    slot.dataset.motionSlot = id;
    root.append(slot);
    return slot;
  });
  /** A point the strip draws at (x, y) of its own, in the viewport's pixels. */
  const pointer = (x: number, y = 20) => ({ x: x * zoom, y: y * zoom });
  return { root, slots, pointer };
}

/** A slot, its line placed to within float rounding. */
const slot = (before: string | null, x: number) => ({
  before,
  x: expect.closeTo(x, 6),
});

const cases = (["standard", "legacy"] as const).flatMap((engine) =>
  [0.8, 1.2].map((ui) => [engine, ui] as const),
);

describe("letting a pane's tab go on the window's strip", () => {
  afterEach(() => setCssZoomRectsForTests(undefined));

  it.each(cases)(
    "stands it where the pointer is, on %s CSS zoom at %s",
    (engine, ui) => {
      const { root, slots, pointer } = strip(engine, ui);
      // The second entry is 110 to 210 of the strip's own: its first half,
      // then just past its middle.
      expect(stripSlotAt(root, slots, pointer(144).x)).toEqual(slot("b", 109));
      expect(stripSlotAt(root, slots, pointer(170).x)).toEqual(slot("c", 209));
      expect(stripSlotAt(root, slots, pointer(400).x)).toEqual(slot(null, 311));
      // Over the strip's last pixels and its bottom ones, and just past it.
      const inside = pointer(480, 36);
      const past = pointer(505, 20);
      expect(overStrip(root, inside.x, inside.y)).toBe(true);
      expect(overStrip(root, past.x, past.y)).toBe(false);
    },
  );

  it.each(cases)(
    "places the line in the strip's scrolled content, on %s CSS zoom at %s",
    (engine, ui) => {
      const { root, slots, pointer } = strip(engine, ui, 40);
      // Scrolled 40 of its own pixels, 144 shows 184 of its content.
      expect(stripSlotAt(root, slots, pointer(144).x)).toEqual(slot("c", 209));
      expect(stripSlotAt(root, slots, pointer(16).x)).toEqual(slot("a", 9));
    },
  );

  it("measures an unzoomed strip as it is drawn", () => {
    setCssZoomRectsForTests("legacy");
    const root = document.createElement("div");
    root.getBoundingClientRect = () => new DOMRect(100, 0, 300, 40);
    const entry = document.createElement("div");
    entry.dataset.motionSlot = "a";
    entry.getBoundingClientRect = () => new DOMRect(110, 0, 100, 40);
    root.append(entry);
    expect(stripSlotAt(root, [entry], 150)).toEqual({ before: "a", x: 9 });
    expect(stripSlotAt(root, [], 150)).toEqual({ before: null, x: 0 });
    expect(overStrip(root, 390, 39)).toBe(true);
  });
});
