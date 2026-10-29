// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clientRectScale,
  clientRectScales,
  cssZoomRects,
  pointInRects,
  setCssZoomRectsForTests,
  viewportRect,
} from "./drag";

describe("CSS zoom and client rects", () => {
  afterEach(() => {
    setCssZoomRectsForTests(undefined);
    vi.restoreAllMocks();
  });

  /** The probe, 10px at zoom 2, measured as `width` by the engine. */
  const measures = (width: number) =>
    vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => new DOMRect(0, 0, width, width));

  it("finds standardized zoom where a zoomed probe measures in viewport pixels", () => {
    const measured = measures(20);
    expect(cssZoomRects()).toBe("standard");
    // Measured once, and the probe is gone.
    expect(cssZoomRects()).toBe("standard");
    expect(measured).toHaveBeenCalledTimes(1);
    expect(document.body.childElementCount).toBe(0);
  });

  it("finds older WebKit, which divides a zoomed element's rects by its zoom", () => {
    measures(10);
    expect(cssZoomRects()).toBe("legacy");
  });

  it("assumes the standard, and asks again, without layout", () => {
    const measured = measures(0);
    expect(cssZoomRects()).toBe("standard");
    expect(cssZoomRects()).toBe("standard");
    expect(measured).toHaveBeenCalledTimes(2);
  });

  it("puts a zoomed element's rect in viewport pixels either way", () => {
    const element = document.createElement("div");
    Object.defineProperty(element, "currentCSSZoom", { value: 1.25 });
    const rect = { left: 80, top: 40, right: 160, bottom: 64 };
    setCssZoomRectsForTests("standard");
    expect(viewportRect(element, rect)).toEqual(rect);
    setCssZoomRectsForTests("legacy");
    expect(viewportRect(element, rect)).toEqual({
      left: 100,
      top: 50,
      right: 200,
      bottom: 80,
    });
  });

  it.each([0.8, 1.2])(
    "puts the pointer in a zoomed strip's reported pixels only on legacy WebKit, at %s",
    (ui) => {
      // The strip cancels the interface zoom: 1.25 at 80%, 1/1.2 at 120%.
      const element = document.createElement("div");
      const zoom = vi.fn(() => 1 / ui);
      Object.defineProperty(element, "currentCSSZoom", { get: zoom });
      const plain = document.createElement("div");
      Object.defineProperty(plain, "currentCSSZoom", { value: 1 });
      const pointer = { x: 500, y: 30 };

      setCssZoomRectsForTests("standard");
      expect(clientRectScale(element)).toBe(1);
      expect(clientRectScales()(element)).toBe(1);
      expect(pointInRects(pointer, 1)).toBe(pointer);
      expect(zoom).not.toHaveBeenCalled();

      setCssZoomRectsForTests("legacy");
      const scaleOf = clientRectScales();
      expect(scaleOf(element)).toBeCloseTo(1 / ui);
      expect(scaleOf(element)).toBeCloseTo(1 / ui);
      // Measured once for the gesture.
      expect(zoom).toHaveBeenCalledOnce();
      const at = pointInRects(pointer, scaleOf(element));
      expect(at.x).toBeCloseTo(500 * ui);
      expect(at.y).toBeCloseTo(30 * ui);
      // Outside the strip's zoom, the pointer as it is.
      expect(scaleOf(plain)).toBe(1);
      expect(pointInRects(pointer, scaleOf(plain))).toBe(pointer);
    },
  );
});
