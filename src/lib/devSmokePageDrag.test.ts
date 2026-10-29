import { describe, expect, it } from "vitest";
import type { BrowserBounds } from "./browser";
import {
  copyAtPointerProblem,
  pageBackProblem,
  pageDragProblem,
} from "./devSmokePageDrag";

const frame: BrowserBounds = {
  x: 200,
  y: 100,
  width: 1000,
  height: 700,
  scale: 2,
};
const copy = { left: 900, top: 400, right: 1010, bottom: 430 };
const full = { width: 1000, height: 700 };

describe("dragging a tab over a page, as the real-app check reads it", () => {
  it("passes a live page at its own frame with nothing cut out", () => {
    expect(
      pageDragProblem(
        { bounds: frame, visible: true },
        frame,
        copy,
        null,
        true,
      ),
    ).toBeNull();
  });

  it("names a hidden page, a moved frame and a changed clip", () => {
    expect(
      pageDragProblem(
        { bounds: frame, visible: false },
        frame,
        copy,
        null,
        false,
      ),
    ).toBe("the page was hidden");
    expect(
      pageDragProblem(
        { bounds: { ...frame, width: 500 }, visible: true },
        frame,
        copy,
        null,
        false,
      ),
    ).toMatch(/frame changed \(width 1000 to 500\)/);
    expect(
      pageDragProblem(
        { bounds: { ...frame, clipRight: 40 }, visible: true },
        frame,
        copy,
        null,
        false,
      ),
    ).toBe("the page's clip changed");
  });

  it("accepts a cut-out under the copy over a full-size still image", () => {
    const bounds = {
      ...frame,
      holes: [{ x: 700, y: 300, width: 110, height: 30, radius: 8 }],
    };
    expect(
      pageDragProblem({ bounds, visible: true }, frame, copy, full, true),
    ).toBeNull();
  });

  it("names the 0.1.156 band: a cut-out away from the copy", () => {
    // At 80% zoom the strip's 1.25 counter-zoom put the copy's cut-out at a
    // fifth of its distance from the window's corner.
    const bounds = {
      ...frame,
      holes: [{ x: 40, y: 20, width: 600, height: 28, radius: 8 }],
    };
    expect(
      pageDragProblem({ bounds, visible: true }, frame, copy, full, true),
    ).toMatch(/600×28 cut-out at \(240, 120\) lies outside the tab's copy/);
  });

  it("names a cut-out with nothing beneath it, even while the copy moves", () => {
    const bounds = {
      ...frame,
      holes: [{ x: 700, y: 300, width: 110, height: 30, radius: 8 }],
    };
    expect(
      pageDragProblem({ bounds, visible: true }, frame, copy, null, false),
    ).toBe("a cut-out with no still image of the page beneath it");
    expect(
      pageDragProblem(
        { bounds, visible: true },
        frame,
        copy,
        { width: 500, height: 700 },
        false,
      ),
    ).toMatch(/still image beneath is 500×700/);
    // Moving, a cut-out may trail its copy by a frame over the still image.
    expect(
      pageDragProblem(
        { bounds, visible: true },
        frame,
        { ...copy, left: 960, right: 1070 },
        full,
        false,
      ),
    ).toBeNull();
  });

  it("wants the page back live at its pane with no cut-out or still image", () => {
    const pane = { x: 200, y: 100, width: 1000, height: 700 };
    expect(
      pageBackProblem({ bounds: frame, visible: true }, pane, 0),
    ).toBeNull();
    expect(
      pageBackProblem(
        { bounds: frame, visible: true },
        { ...pane, width: 500 },
        0,
      ),
    ).toMatch(/not at its pane/);
    expect(pageBackProblem({ bounds: frame, visible: false }, pane, 0)).toBe(
      "the page is still hidden",
    );
    expect(pageBackProblem({ bounds: frame, visible: true }, pane, 1)).toBe(
      "a still image of the page was left behind",
    );
    expect(
      pageBackProblem(
        {
          bounds: {
            ...frame,
            holes: [{ x: 0, y: 0, width: 9, height: 9, radius: 0 }],
          },
          visible: true,
        },
        pane,
        0,
      ),
    ).toBe("the page still has 1 cut-out(s)");
  });

  it("wants the copy under the pointer", () => {
    expect(copyAtPointerProblem(copy, { x: 950, y: 415 })).toBeNull();
    expect(copyAtPointerProblem(copy, { x: 880, y: 470 })).toBeNull();
    expect(copyAtPointerProblem(null, { x: 950, y: 415 })).toBe(
      "the tab's copy is not drawn",
    );
    expect(copyAtPointerProblem(copy, { x: 600, y: 415 })).toMatch(
      /stayed at \(900, 400\), away from the pointer at \(600, 415\)/,
    );
  });
});
