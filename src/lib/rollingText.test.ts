import { describe, expect, it } from "vitest";
import { glyphs, matchGlyphs, rollsDown } from "./rollingText";

const roll = (old: string, next: string, trailing = false) => {
  const matched = matchGlyphs(glyphs(old), glyphs(next), trailing);
  // Upper case: the character rolls in; lower case or symbol: it is kept.
  return glyphs(next)
    .map((char, index) => (matched[index] == null ? `[${char}]` : char))
    .join("");
};

describe("matchGlyphs", () => {
  it("rolls only the changed digit", () => {
    expect(roll("68%", "69%")).toBe("6[9]%");
    expect(roll("176K", "177K")).toBe("17[7]K");
  });

  it("keeps a colon that holds its place", () => {
    expect(roll("1:00", "0:59")).toBe("[0]:[5][9]");
  });

  it("matches like an odometer when pinned to the right", () => {
    expect(roll("10s", "100s", true)).toBe("[1][0]0s");
    expect(roll("19s", "100s", true)).toBe("[1][0][0]s");
  });

  it("lets a unit slide with its number", () => {
    expect(roll("9%", "10%")).toBe("[1][0]%");
    expect(roll("$0.98", "$1.02")).toBe("$[1].[0][2]");
  });

  it("does not leave a lone letter sliding across a new word", () => {
    expect(roll("Copy password", "Copied, clears in")).toBe(
      "Cop[i][e][d][,][ ][c][l][e][a][r][s][ ][i][n]",
    );
  });
});

describe("rollsDown", () => {
  it("rolls down only when the number falls", () => {
    expect(rollsDown(10, 9)).toBe(true);
    expect(rollsDown(9, 10)).toBe(false);
    expect(rollsDown(undefined, 9)).toBe(false);
    expect(rollsDown(10, Number.NaN)).toBe(false);
  });
});

describe("glyphs", () => {
  it("keeps emoji and accents whole", () => {
    expect(glyphs("é👍🏽1")).toEqual(["é", "👍🏽", "1"]);
  });
});
