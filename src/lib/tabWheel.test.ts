import { describe, expect, it } from "vitest";
import {
  TAB_WHEEL_START,
  tabAfterStep,
  tabWheelStep,
  type TabWheelState,
} from "./tabWheel";

function turn(
  state: TabWheelState,
  deltas: readonly number[],
  now: number,
  gap = 16,
): { steps: number[]; state: TabWheelState } {
  const steps: number[] = [];
  let at = now;
  for (const deltaY of deltas) {
    const next = tabWheelStep(state, { deltaX: 0, deltaY, now: at });
    state = next.state;
    if (next.step) steps.push(next.step);
    at += gap;
  }
  return { steps, state };
}

describe("switching tabs with the wheel", () => {
  it("adds a trackpad's small turns up to one step, either way", () => {
    expect(turn(TAB_WHEEL_START, [10, 10, 10, 10, 10], 1000).steps).toEqual([
      1,
    ]);
    expect(turn(TAB_WHEEL_START, [-20, -20, -20], 1000).steps).toEqual([-1]);
  });

  it("takes a flick as one step, not three", () => {
    expect(turn(TAB_WHEEL_START, [120, 90, 60, 30, 10], 1000).steps).toEqual([
      1,
    ]);
    // After the cooldown, the next turn counts again.
    const first = turn(TAB_WHEEL_START, [120], 1000);
    expect(turn(first.state, [120], 1000 + 200).steps).toEqual([1]);
  });

  it("leaves a sideways scroll to the strip", () => {
    expect(
      tabWheelStep(TAB_WHEEL_START, { deltaX: 80, deltaY: 20, now: 1000 }).step,
    ).toBe(0);
  });

  it("forgets a remainder after a pause", () => {
    const some = turn(TAB_WHEEL_START, [30], 1000);
    expect(some.steps).toEqual([]);
    // 30 + 30 would be a step within a gesture; after a pause it isn't.
    expect(turn(some.state, [30], 2000).steps).toEqual([]);
  });

  it("steps to the neighbour and stops at the ends", () => {
    const tabs = [
      { id: "a", selected: false },
      { id: "b", selected: true },
      { id: "c", selected: false },
    ];
    expect(tabAfterStep(tabs, 1)?.id).toBe("c");
    expect(tabAfterStep(tabs, -1)?.id).toBe("a");
    expect(
      tabAfterStep(
        [
          { id: "a", selected: false },
          { id: "b", selected: false },
          { id: "c", selected: true },
        ],
        1,
      ),
    ).toBeUndefined();
    // Nothing selected: from the first.
    expect(
      tabAfterStep(
        [
          { id: "a", selected: false },
          { id: "b", selected: false },
        ],
        1,
      )?.id,
    ).toBe("b");
    expect(tabAfterStep([], 1)).toBeUndefined();
  });
});
