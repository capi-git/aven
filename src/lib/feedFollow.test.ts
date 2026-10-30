import { describe, expect, it } from "vitest";
import {
  FEED_FOLLOW_START,
  atFeedBottom,
  feedEntryFolds,
  feedGrew,
  feedScrolled,
  unseenLabel,
} from "./feedFollow";

const at = (scrollTop: number) => ({
  scrollTop,
  scrollHeight: 1_000,
  clientHeight: 300,
});

describe("a feed that follows its newest entry", () => {
  it("stays at the bottom while you're there", () => {
    expect(atFeedBottom(at(700))).toBe(true);
    expect(atFeedBottom(at(690))).toBe(true);
    const step = feedGrew(FEED_FOLLOW_START, 1);
    expect(step).toEqual({ state: FEED_FOLLOW_START, scrollToBottom: true });
  });

  it("doesn't move while you read further up, and counts what arrives", () => {
    const reading = feedScrolled(FEED_FOLLOW_START, at(100));
    expect(reading).toEqual({ following: false, unseen: 0 });
    const one = feedGrew(reading, 1);
    expect(one.scrollToBottom).toBe(false);
    const three = feedGrew(one.state, 2);
    expect(three.state).toEqual({ following: false, unseen: 3 });
    expect(unseenLabel(three.state.unseen)).toBe("3 new ↓");
    // Back at the bottom by hand: nothing unseen, following again.
    expect(feedScrolled(three.state, at(700))).toEqual(FEED_FOLLOW_START);
    // Nothing new: nothing changes.
    expect(feedGrew(reading, 0)).toEqual({
      state: reading,
      scrollToBottom: false,
    });
  });

  it("folds a long entry, and only a long one", () => {
    expect(feedEntryFolds("Short and sweet")).toBe(false);
    expect(feedEntryFolds("x".repeat(281))).toBe(true);
    expect(feedEntryFolds("a\nb\nc\nd\ne")).toBe(true);
    expect(feedEntryFolds("a\nb\nc\nd")).toBe(false);
  });
});
