import { describe, expect, it } from "vitest";
import type { Root } from "hast";
import {
  countWords,
  WORD_STAGGER_MAX_MS,
  WORD_STAGGER_MIN_MS,
  wordStagger,
} from "./wordReveal";

describe("wordStagger", () => {
  it("shrinks from 20 ms to 5.5 ms as words pile up", () => {
    expect(wordStagger(0)).toBe(WORD_STAGGER_MAX_MS);
    expect(wordStagger(5)).toBe(20);
    expect(wordStagger(20)).toBe(11);
    expect(wordStagger(400)).toBe(WORD_STAGGER_MIN_MS);
  });
});

describe("countWords", () => {
  it("counts words, inline code as one, and skips code blocks", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [
            { type: "text", value: "Run  the " },
            {
              type: "element",
              tagName: "code",
              properties: {},
              children: [{ type: "text", value: "npm test" }],
            },
            { type: "text", value: " now" },
          ],
        },
        {
          type: "element",
          tagName: "pre",
          properties: {},
          children: [{ type: "text", value: "not counted at all" }],
        },
      ],
    };
    expect(countWords(tree)).toBe(4);
  });
});

describe("WordReveal", () => {
  it("never lets a word wait longer than the lag limit", async () => {
    const { WordReveal, WORD_MAX_LAG_MS } = await import("./wordReveal");
    const reveal = new WordReveal(true);
    const tree = (count: number): Root => ({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [
            {
              type: "text",
              value: Array.from({ length: count }, (_, i) => `w${i}`).join(" "),
            },
          ],
        },
      ],
    });
    // A fast stream: 400 words in ten flushes 10 ms apart.
    let last: Root = tree(0);
    for (let flush = 1; flush <= 10; flush += 1) {
      last = tree(flush * 40);
      reveal.revealBlock(last, 0, flush * 10);
    }
    expect(reveal.settlesAt).toBeLessThanOrEqual(100 + WORD_MAX_LAG_MS + 180);
    void last;
  });
});
