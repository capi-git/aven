import { describe, expect, it } from "vitest";
import { sidebarOnScreen } from "./sidebarVisibility";

// [hoverVisible, native, pinned, floatingRevealed] → on screen
type Row = [boolean, boolean, boolean, boolean, boolean];

describe("sidebarOnScreen", () => {
  it.each<Row>([
    // DOM peek (Windows, Linux, or the native layer failed to attach).
    [false, false, false, false, false],
    [true, false, false, false, true],
    // A docked DOM sidebar shows through the peek's own `visible`.
    [true, false, true, false, true],
    // A stale native reveal must not count once the DOM peek is in charge.
    [false, false, true, true, false],
    // Native layer: the DOM peek is disabled and never visible.
    [false, true, false, false, false],
    [false, true, false, true, true],
    // 0.1.138: docked with the native layer read as hidden, which froze other
    // projects' task lists at "No tasks yet".
    [false, true, true, false, true],
    [false, true, true, true, true],
  ])(
    "hover %s, native %s, pinned %s, revealed %s → %s",
    (hoverVisible, native, pinned, floatingRevealed, shown) => {
      expect(
        sidebarOnScreen({ hoverVisible, native, pinned, floatingRevealed }),
      ).toBe(shown);
    },
  );
});
