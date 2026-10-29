// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cssZoomRects, setCssZoomRectsForTests, viewportRect } from "./drag";

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
});
