import { describe, expect, it } from "vitest";
import {
  TAB_SLIDE_EASE,
  TAB_SLIDE_MS,
  TAB_TRACK_GAP,
  TAB_TRACK_MIN_WIDTH,
  highlightKeyframes,
  planHighlight,
  sameTrackBox,
  trackSeparators,
} from "./tabTrack";

const tabs = (...ids: string[]) => ids.map((id) => ({ id, tab: true }));

describe("tab track", () => {
  it("keeps Cydonia's measures", () => {
    expect(TAB_TRACK_MIN_WIDTH).toBe(120);
    expect(TAB_TRACK_GAP).toBe(2);
    expect(TAB_SLIDE_MS).toBe(150);
    expect(TAB_SLIDE_EASE).toBe("cubic-bezier(0, 0, 0.58, 1)");
  });

  describe("separators", () => {
    it("parts every pair of resting tabs, never the first tab", () => {
      expect([...trackSeparators(tabs("a", "b", "c", "d"), null)]).toEqual([
        "b",
        "c",
        "d",
      ]);
    });

    it("hides the line on either side of the tab in front", () => {
      expect([...trackSeparators(tabs("a", "b", "c", "d"), "b")]).toEqual([
        "d",
      ]);
      expect([...trackSeparators(tabs("a", "b", "c", "d"), "a")]).toEqual([
        "c",
        "d",
      ]);
      expect([...trackSeparators(tabs("a", "b", "c", "d"), "d")]).toEqual([
        "b",
        "c",
      ]);
    });

    it("draws no line beside a group's label", () => {
      const entries = [
        { id: "a", tab: true },
        { id: "group:g", tab: false },
        { id: "b", tab: true },
        { id: "c", tab: true },
      ];
      expect([...trackSeparators(entries, null)]).toEqual(["c"]);
    });

    it("has nothing to part with one tab", () => {
      expect(trackSeparators(tabs("a"), "a").size).toBe(0);
    });
  });

  describe("highlight", () => {
    const a = { x: 0, width: 200 };
    const b = { x: 202, width: 200 };

    it("slides from where it is drawn when another tab comes to the front", () => {
      expect(
        planHighlight({
          previousFront: "a",
          drawn: a,
          front: "b",
          target: b,
          reduced: false,
        }),
      ).toEqual({ to: b, from: a });
    });

    it("slides from part way along a slide that is interrupted", () => {
      const midway = { x: 120, width: 200 };
      expect(
        planHighlight({
          previousFront: "b",
          drawn: midway,
          front: "a",
          target: a,
          reduced: false,
        }).from,
      ).toEqual(midway);
    });

    it("moves straight to its tab when only the strip changed shape", () => {
      expect(
        planHighlight({
          previousFront: "b",
          drawn: b,
          front: "b",
          target: { x: 150, width: 150 },
          reduced: false,
        }),
      ).toEqual({ to: { x: 150, width: 150 }, from: null });
    });

    it("does not slide with reduced motion or from nothing", () => {
      expect(
        planHighlight({
          previousFront: "a",
          drawn: a,
          front: "b",
          target: b,
          reduced: true,
        }).from,
      ).toBeNull();
      expect(
        planHighlight({
          previousFront: null,
          drawn: null,
          front: "b",
          target: b,
          reduced: false,
        }),
      ).toEqual({ to: b, from: null });
    });

    it("is not drawn when the tab in front is not in the strip", () => {
      expect(
        planHighlight({
          previousFront: "a",
          drawn: a,
          front: "folded",
          target: null,
          reduced: false,
        }),
      ).toEqual({ to: null, from: null });
    });

    it("slides with transforms only, laid out at its new place", () => {
      expect(
        highlightKeyframes({ x: 10, width: 100 }, { x: 300, width: 200 }),
      ).toEqual([
        { transform: "translateX(10px) scaleX(0.5)" },
        { transform: "translateX(300px) scaleX(1)" },
      ]);
    });

    it("treats sub-pixel differences as the same place", () => {
      expect(sameTrackBox({ x: 1, width: 10 }, { x: 1.2, width: 10.3 })).toBe(
        true,
      );
      expect(sameTrackBox({ x: 1, width: 10 }, { x: 2, width: 10 })).toBe(
        false,
      );
      expect(sameTrackBox(null, null)).toBe(true);
      expect(sameTrackBox(null, { x: 0, width: 1 })).toBe(false);
    });
  });
});
