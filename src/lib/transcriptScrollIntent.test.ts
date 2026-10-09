import { describe, expect, it } from "vitest";
import {
  followsAfterScroll,
  isAtEnd,
  readerScrolled,
  scrollClampedToBottom,
} from "./transcriptScrollIntent";

const box = (scrollTop: number, scrollHeight = 1000, clientHeight = 400) => ({
  scrollTop,
  scrollHeight,
  clientHeight,
});

describe("transcript follow decisions", () => {
  it("treats only the very end as the end", () => {
    expect(isAtEnd(box(600))).toBe(true);
    expect(isAtEnd(box(599.5))).toBe(true);
    expect(isAtEnd(box(590))).toBe(false);
  });

  it("recognises a taller viewport or shorter content clamping the offset", () => {
    // Was at 596; the viewport grew to 440, so the bottom is now 560.
    expect(scrollClampedToBottom(box(560, 1000, 440), 596)).toBe(true);
    // Content shrank under a following reader.
    expect(scrollClampedToBottom(box(560, 960), 600)).toBe(true);
    // Short content clamps to the top.
    expect(scrollClampedToBottom(box(0, 300), 120)).toBe(true);
    // The reader moving up is not a clamp.
    expect(scrollClampedToBottom(box(500), 600)).toBe(false);
    expect(readerScrolled(box(500), 600)).toBe(true);
    expect(readerScrolled(box(560, 1000, 440), 596)).toBe(false);
    expect(readerScrolled(box(600, 1100), 600)).toBe(false);
  });

  it("keeps the current choice when the reader did not move", () => {
    // Content grew under a queued event from the last pin.
    expect(followsAfterScroll(box(600, 1100), 600, true)).toBe(true);
    expect(followsAfterScroll(box(596, 1100), 596, false)).toBe(false);
    // A clamp to the bottom neither re-pins nor releases.
    expect(followsAfterScroll(box(560, 1000, 440), 596, false)).toBe(false);
    expect(followsAfterScroll(box(560, 1000, 440), 600, true)).toBe(true);
  });

  it("leaves on any upward move, however small", () => {
    expect(followsAfterScroll(box(596), 600, true)).toBe(false);
  });

  it("resumes only after moving down all the way to the end", () => {
    expect(followsAfterScroll(box(590), 560, false)).toBe(false);
    expect(followsAfterScroll(box(600), 590, false)).toBe(true);
    // A downward move short of the end also stops following.
    expect(followsAfterScroll(box(300), 200, true)).toBe(false);
  });
});
