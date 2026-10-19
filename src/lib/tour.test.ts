// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  TOUR_EDGE,
  TOUR_GAP,
  TOUR_START_EVENT,
  TOUR_STOPS,
  clipTourRect,
  nextTourIndex,
  placeTourPopover,
  startTour,
  tourRectOnScreen,
} from "./tour";

const viewport = { width: 1200, height: 800 };
const popover = { width: 300, height: 140 };

describe("tour stops", () => {
  it("has six stops in order, each anchored by data-tour", () => {
    expect(TOUR_STOPS.map((stop) => stop.id)).toEqual([
      "composer",
      "sidebar",
      "browser",
      "changes",
      "board",
      "memory",
    ]);
    for (const stop of TOUR_STOPS) {
      expect(stop.anchors.length, stop.id).toBeGreaterThan(0);
      expect(stop.title, stop.id).not.toBe("");
      expect(stop.body.length, stop.id).toBeLessThan(160);
    }
    expect(TOUR_STOPS[0].body).toContain(
      "Plan mode, Orchestrator, Discuss and Race",
    );
  });

  it("asks the workspace to start it", () => {
    const started = vi.fn();
    window.addEventListener(TOUR_START_EVENT, started);
    startTour();
    window.removeEventListener(TOUR_START_EVENT, started);
    expect(started).toHaveBeenCalledTimes(1);
  });
});

describe("tour popover placement", () => {
  it("sits above a wide target near the bottom, centred and inside the window", () => {
    const composer = { left: 300, top: 680, width: 860, height: 90 };
    const placed = placeTourPopover(composer, popover, viewport);
    expect(placed.side).toBe("top");
    expect(placed.top).toBe(680 - TOUR_GAP - popover.height);
    expect(placed.left).toBe(300 + 430 - 150);
  });

  it("sits beside a tall target such as the sidebar", () => {
    const sidebar = { left: 0, top: 40, width: 240, height: 760 };
    const placed = placeTourPopover(sidebar, popover, viewport);
    expect(placed.side).toBe("right");
    expect(placed.left).toBe(240 + TOUR_GAP);
    expect(placed.top).toBeGreaterThanOrEqual(TOUR_EDGE);
    expect(placed.top + popover.height).toBeLessThanOrEqual(
      viewport.height - TOUR_EDGE,
    );
  });

  it("goes below a small target at the top and stays inside the window's edge", () => {
    const button = { left: 1180, top: 4, width: 20, height: 20 };
    const placed = placeTourPopover(button, popover, viewport);
    expect(placed.side).toBe("bottom");
    expect(placed.left).toBe(viewport.width - popover.width - TOUR_EDGE);
  });

  it("falls back inside a target that fills the window", () => {
    const placed = placeTourPopover(
      { left: 0, top: 0, width: 1200, height: 800 },
      popover,
      viewport,
    );
    expect(placed.top + popover.height).toBeLessThanOrEqual(
      viewport.height - TOUR_EDGE,
    );
    expect(placed.left).toBeGreaterThanOrEqual(TOUR_EDGE);
  });
});

describe("tour helpers", () => {
  it("knows when an element is on screen", () => {
    expect(
      tourRectOnScreen({ left: 10, top: 10, width: 100, height: 40 }, viewport),
    ).toBe(true);
    expect(
      tourRectOnScreen({ left: 10, top: 10, width: 0, height: 0 }, viewport),
    ).toBe(false);
    expect(
      tourRectOnScreen(
        { left: -300, top: 10, width: 200, height: 40 },
        viewport,
      ),
    ).toBe(false);
    expect(
      tourRectOnScreen(
        { left: 10, top: 900, width: 200, height: 40 },
        viewport,
      ),
    ).toBe(false);
  });

  it("clips a rectangle to the window", () => {
    expect(
      clipTourRect({ left: -20, top: 700, width: 200, height: 200 }, viewport),
    ).toEqual({ left: 0, top: 700, width: 180, height: 100 });
  });

  it("skips stops that can't be shown, both ways", () => {
    const shown = [true, false, false, true];
    const available = (index: number) => shown[index];
    expect(nextTourIndex(4, 0, 1, available)).toBe(3);
    expect(nextTourIndex(4, 3, -1, available)).toBe(0);
    expect(nextTourIndex(4, 3, 1, available)).toBeNull();
    expect(nextTourIndex(4, 0, -1, available)).toBeNull();
  });
});
