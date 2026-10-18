import { describe, expect, it } from "vitest";
import {
  contentShrankToEnd,
  followsAfterScroll,
  isAtEnd,
  readerScrolled,
  scrollClampedToBottom,
  tallerViewportClamped,
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

  it("follows when content shrinking clamps the reader to the end", () => {
    const before = { scrollHeight: 1000, clientHeight: 400 };
    // Work folded away under a reader 4px from the end.
    expect(contentShrankToEnd(box(560, 960), 596, before)).toBe(true);
    expect(followsAfterScroll(box(560, 960), 596, false, before)).toBe(true);
    // A taller viewport over the same content is layout, not following.
    expect(contentShrankToEnd(box(560, 1000, 440), 596, before)).toBe(false);
    expect(followsAfterScroll(box(560, 1000, 440), 596, false, before)).toBe(
      false,
    );
    // Shorter content that does not reach the reader leaves them be.
    expect(contentShrankToEnd(box(300, 960), 300, before)).toBe(false);
    expect(followsAfterScroll(box(300, 960), 300, false, before)).toBe(false);
  });

  it("treats a taller viewport's clamp as layout after a stretched turn grows back", () => {
    const before = { scrollHeight: 1000, clientHeight: 400 };
    // The viewport grew by 60 and clamped 600 to 540; the live turn's
    // stretch then grew by 60 too, so the bottom is back at 600.
    const regrown = box(540, 1060, 460);
    expect(scrollClampedToBottom(regrown, 600)).toBe(false);
    expect(tallerViewportClamped(regrown, 600, before)).toBe(true);
    expect(readerScrolled(regrown, 600, before)).toBe(false);
    expect(followsAfterScroll(regrown, 600, true, before)).toBe(true);
    // A reader who had scrolled up stays scrolled up.
    expect(followsAfterScroll(box(540, 1060, 460), 596, false, before)).toBe(
      false,
    );
    // Scrolling up moves the viewport's lower edge up; that still leaves.
    expect(tallerViewportClamped(box(500, 1000, 400), 600, before)).toBe(false);
    expect(followsAfterScroll(box(500, 1060, 460), 600, true, before)).toBe(
      false,
    );
    expect(readerScrolled(regrown, 600)).toBe(true);
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
