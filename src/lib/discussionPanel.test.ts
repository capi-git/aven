import { describe, expect, it } from "vitest";
import {
  clampRect,
  defaultRect,
  firstNewReply,
  foldedRoundCount,
  foldLabel,
  newSinceLabel,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  PANEL_TOP_INSET,
  replyCount,
  resizeRect,
  threadRounds,
} from "./discussionPanel";
import type { DiscussionThreadItem } from "./discussionThread";

const WINDOW = { width: 1400, height: 900 };

describe("where the panel sits", () => {
  it("first opens in the window's bottom-right corner", () => {
    const rect = defaultRect(WINDOW);
    expect(rect.x + rect.width).toBeLessThanOrEqual(WINDOW.width - 8);
    expect(rect.y + rect.height).toBeLessThanOrEqual(WINDOW.height - 8);
    expect(rect.x).toBeGreaterThan(WINDOW.width / 2);
  });

  it("stays inside the window and below its title bar", () => {
    expect(
      clampRect({ x: -50, y: 0, width: 430, height: 590 }, WINDOW),
    ).toEqual({ x: 8, y: PANEL_TOP_INSET, width: 430, height: 590 });
    expect(
      clampRect({ x: 2000, y: 2000, width: 430, height: 590 }, WINDOW),
    ).toEqual({ x: 1400 - 8 - 430, y: 900 - 8 - 590, width: 430, height: 590 });
    // Never smaller than it can be read at, nor larger than the window.
    expect(
      clampRect({ x: 0, y: 0, width: 10, height: 10 }, WINDOW),
    ).toMatchObject({ width: PANEL_MIN_WIDTH, height: PANEL_MIN_HEIGHT });
    expect(
      clampRect({ x: 0, y: 0, width: 5000, height: 5000 }, WINDOW),
    ).toMatchObject({ width: 1400 - 16, height: 900 - PANEL_TOP_INSET - 8 });
  });

  it("resizes from any edge, keeping the opposite edge in place", () => {
    const start = { x: 500, y: 200, width: 430, height: 590 };
    expect(resizeRect(start, "e", 70, 0, WINDOW)).toMatchObject({
      x: 500,
      width: 500,
    });
    expect(resizeRect(start, "w", -100, 0, WINDOW)).toMatchObject({
      x: 400,
      width: 530,
    });
    expect(resizeRect(start, "nw", 50, 40, WINDOW)).toMatchObject({
      x: 550,
      y: 240,
      width: 380,
      height: 550,
    });
    // Not past its smallest size, which leaves the right edge where it was.
    const narrow = resizeRect(start, "w", 400, 0, WINDOW);
    expect(narrow.width).toBe(PANEL_MIN_WIDTH);
    expect(narrow.x + narrow.width).toBe(start.x + start.width);
    // Not above the title bar.
    expect(resizeRect(start, "n", 0, -500, WINDOW).y).toBe(PANEL_TOP_INSET);
  });
});

describe("a long thread in the panel", () => {
  const reply = (turn: number): DiscussionThreadItem => ({
    kind: "reply",
    key: `turn-${turn}`,
    side: turn % 2 === 0 ? "a" : "b",
    turn,
    text: `reply ${turn}`,
    stance: turn === 3 ? "agree" : turn === 5 ? "pushback" : null,
  });
  const round = (value: number): DiscussionThreadItem => ({
    kind: "round",
    key: `round-${value}`,
    round: value,
    rounds: 4,
  });
  const items: DiscussionThreadItem[] = [
    { kind: "topic", key: "topic", text: "Topic" },
    round(1),
    reply(0),
    reply(1),
    round(2),
    reply(2),
    reply(3),
    round(3),
    reply(4),
    reply(5),
    round(4),
    reply(6),
  ];

  it("splits into the topic and its rounds, each marked by its last reply", () => {
    const { head, rounds } = threadRounds(items);
    expect(head.map((item) => item.key)).toEqual(["topic"]);
    expect(rounds.map((entry) => [entry.round, entry.stance])).toEqual([
      [1, null],
      [2, "agree"],
      [3, "pushback"],
      [4, null],
    ]);
    expect(replyCount(items)).toBe(7);
  });

  it("folds all but the last two rounds, unless one holds something new", () => {
    const { rounds } = threadRounds(items);
    expect(foldedRoundCount(rounds, null)).toBe(2);
    expect(foldLabel(2)).toBe("Rounds 1–2 · Show");
    expect(foldLabel(1)).toBe("Round 1 · Show");
    // The first reply not seen is the fourth, in round 2: only round 1 folds.
    expect(foldedRoundCount(rounds, 3)).toBe(1);
    expect(foldedRoundCount(rounds, 6)).toBe(2);
    expect(foldedRoundCount(rounds.slice(0, 2), null)).toBe(0);
  });

  it("marks what arrived since the user last looked", () => {
    expect(firstNewReply(7, 4)).toBe(4);
    expect(firstNewReply(7, 7)).toBeNull();
    // Never looked: nothing is marked.
    expect(firstNewReply(7, undefined)).toBeNull();
    expect(newSinceLabel(3)).toBe("3 new since you looked");
  });
});
