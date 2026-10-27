// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_HIT_MARGIN_ATTRIBUTE,
  MAX_BROWSER_HIT_MARGIN,
  browserHitMargins,
  withBrowserHitMargins,
} from "./browserHitMargins";

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});
const handle = (...rects: ReturnType<typeof rect>[]) => ({ rects });
// A page at x 300..700, y 72..872.
const page = { x: 300, y: 72, width: 400, height: 800 };

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("browserHitMargins", () => {
  it("leaves the pointer to dividers that reach the page's edges", () => {
    expect(
      browserHitMargins(page, [
        // The stage divider on its left: 8px centred on a 1px gap.
        handle(rect(295.5, 40, 8, 860)),
        // The side panel's resizer on its right: 4px over the page.
        handle(rect(696, 40, 9, 860)),
        // A row divider along its bottom.
        handle(rect(300, 868.5, 400, 8)),
      ]),
    ).toEqual({ left: 3.5, top: 0, right: 4, bottom: 3.5 });
  });

  it("ignores handles that miss the page or sit inside it", () => {
    expect(
      browserHitMargins(page, [
        handle(rect(100, 40, 8, 860)),
        // A divider inside the page's own split does not reach an edge.
        handle(rect(480, 72, 8, 800)),
        handle(rect(300, 0, 400, 20)),
      ]),
    ).toBeNull();
  });

  it("never takes more than the cap or half the page", () => {
    expect(
      browserHitMargins(page, [handle(rect(250, 72, 80, 800))])?.left,
    ).toBe(MAX_BROWSER_HIT_MARGIN);
    expect(
      browserHitMargins({ ...page, width: 10 }, [handle(rect(300, 72, 8, 800))])
        ?.left,
    ).toBe(5);
  });

  it("reads the marked handles on screen into the page's bounds", () => {
    document.body.innerHTML = `
      <div ${BROWSER_HIT_MARGIN_ATTRIBUTE} id="shown"></div>
      <div hidden><div ${BROWSER_HIT_MARGIN_ATTRIBUTE} id="gone"></div></div>`;
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
      this: Element,
    ) {
      const box =
        this.id === "shown" ? rect(295.5, 40, 8, 860) : rect(696, 40, 9, 860);
      return [box] as unknown as DOMRectList;
    });
    const bounds = withBrowserHitMargins({ ...page, scale: 2 });
    expect(bounds.hitMargins).toEqual({
      left: 3.5,
      top: 0,
      right: 0,
      bottom: 0,
    });
    document.body.innerHTML = "";
    expect(withBrowserHitMargins({ ...page, scale: 2 }).hitMargins).toBe(
      undefined,
    );
  });
});
