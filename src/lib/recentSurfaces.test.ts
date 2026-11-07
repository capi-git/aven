import { describe, expect, it } from "vitest";
import {
  cascadeCardSize,
  cascadeDepth,
  cascadePlace,
  firstRecentPick,
  recentChatLines,
  recentOrder,
  RECENT_DEPTH,
  stepRecent,
  touchRecent,
} from "./recentSurfaces";

describe("recent order", () => {
  it("moves the entry in front to the head", () => {
    expect(touchRecent(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(touchRecent(["a"], "")).toEqual(["a"]);
  });

  it("offers the front first, then the last used, then the strip", () => {
    expect(recentOrder(["b", "d", "a"], ["a", "b", "c", "d"], "a")).toEqual([
      "a",
      "b",
      "d",
      "c",
    ]);
  });

  it("leaves out entries no longer on the strip", () => {
    expect(recentOrder(["gone", "b"], ["a", "b"], "a")).toEqual(["a", "b"]);
    expect(recentOrder([], [], "")).toEqual([]);
  });
});

describe("stepping", () => {
  it("starts one back, or at the oldest with shift", () => {
    expect(firstRecentPick(1, 4)).toBe(1);
    expect(firstRecentPick(-1, 4)).toBe(3);
    expect(firstRecentPick(1, 1)).toBe(0);
  });

  it("wraps both ways", () => {
    expect(stepRecent(3, 1, 4)).toBe(0);
    expect(stepRecent(0, -1, 4)).toBe(3);
    expect(stepRecent(0, 1, 0)).toBe(0);
  });
});

describe("cascade", () => {
  const card = { width: 500, height: 320 };

  it("puts the picked card in front and the rest behind it", () => {
    expect(cascadeDepth(2, 2, 5)).toBe(0);
    expect(cascadeDepth(3, 2, 5)).toBe(1);
    expect(cascadeDepth(1, 2, 5)).toBe(4);
    const front = cascadePlace(0, 5, card);
    const behind = cascadePlace(1, 5, card);
    expect(front).toMatchObject({ x: 0, y: 0, z: 0, dim: 0, opacity: 1 });
    expect(behind.x).toBeGreaterThan(0);
    expect(behind.y).toBeLessThan(0);
    expect(behind.z).toBeLessThan(0);
    expect(behind.zIndex).toBeLessThan(front.zIndex);
  });

  it("sends the card just passed toward the viewer, faded", () => {
    const passed = cascadePlace(4, 5, card);
    expect(passed.z).toBeGreaterThan(0);
    expect(passed.opacity).toBe(0);
  });

  it("hides cards deeper than the stack shows", () => {
    expect(cascadePlace(RECENT_DEPTH, 12, card).opacity).toBe(0);
    expect(cascadePlace(RECENT_DEPTH - 1, 12, card).opacity).toBe(1);
  });

  it("keeps two cards as front and back", () => {
    expect(cascadePlace(1, 2, card).opacity).toBe(1);
  });

  it("sizes the front card to the window in the workspace's shape", () => {
    const size = cascadeCardSize({ width: 1400, height: 900 }, 1.6);
    expect(size.width).toBe(600);
    expect(size.height).toBe(375);
    const small = cascadeCardSize({ width: 700, height: 500 }, 1.6);
    expect(small.width).toBeLessThanOrEqual(350);
    expect(cascadeCardSize({ width: 800, height: 600 }, NaN).width).toBe(400);
  });
});

describe("chat lines", () => {
  it("keeps the last turns as plain text, oldest first", () => {
    const lines = recentChatLines(
      [
        { role: "user", text: "First" },
        {
          role: "assistant",
          text: "## Done\n\nSee **this** [link](https://x.y).",
        },
        { role: "tool", text: "ran ls" },
        { role: "user", text: "Hidden", internal: true },
        { role: "assistant", text: "Code:\n```ts\nconst a = 1;\n```\nafter" },
      ],
      2,
    );
    expect(lines).toEqual([
      { role: "assistant", text: "Done See this link." },
      { role: "assistant", text: "Code: after" },
    ]);
  });

  it("skips empty turns", () => {
    expect(
      recentChatLines([{ role: "assistant", text: "```\nonly code\n```" }]),
    ).toEqual([]);
  });
});
