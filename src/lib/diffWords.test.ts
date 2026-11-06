import { describe, expect, it } from "vitest";
import {
  changedFlags,
  lineWordChanges,
  markPieces,
  wordChanges,
  wordPartners,
} from "./diffWords";
import type { UnifiedLine } from "./unifiedDiff";

const slice = (text: string, ranges: readonly (readonly [number, number])[]) =>
  ranges.map(([start, end]) => text.slice(start, end));

describe("wordChanges", () => {
  it("marks only the words that changed", () => {
    const before = "const total = price * count;";
    const after = "const total = price * quantity;";
    const changes = wordChanges(before, after)!;
    expect(slice(before, changes.old)).toEqual(["count"]);
    expect(slice(after, changes.new)).toEqual(["quantity"]);
  });

  it("joins changes split only by spaces", () => {
    const before = "return a + b";
    const after = "return x - y";
    const changes = wordChanges(before, after)!;
    expect(slice(after, changes.new)).toEqual(["x - y"]);
  });

  it("marks an insertion on the new side only", () => {
    const before = "call(a, b)";
    const after = "call(a, b, c)";
    const changes = wordChanges(before, after)!;
    expect(changes.old).toEqual([]);
    expect(slice(after, changes.new)).toEqual([", c"]);
  });

  it("gives no marks to lines that share too little", () => {
    expect(wordChanges("alpha beta gamma", "one two three")).toBeNull();
    expect(wordChanges("same", "same")).toBeNull();
    expect(wordChanges("x".repeat(1001), "y")).toBeNull();
  });

  it("splits words by letters, digits and underscores in any script", () => {
    const changes = wordChanges("let größe_1 = 2;", "let größe_2 = 2;")!;
    expect(slice("let größe_2 = 2;", changes.new)).toEqual(["größe_2"]);
  });
});

describe("changedFlags", () => {
  it("finds the shortest edit", () => {
    const [removed, added] = changedFlags(
      ["a", "b", "c", "a", "b", "b", "a"],
      ["c", "b", "a", "b", "a", "c"],
    )!;
    const kept = removed.filter((flag) => !flag).length;
    expect(kept).toBe(4);
    expect(added.filter((flag) => !flag).length).toBe(4);
  });

  it("gives up past its step limit", () => {
    const a = Array.from({ length: 50 }, (_, index) => `a${index}`);
    const b = Array.from({ length: 50 }, (_, index) => `b${index}`);
    expect(changedFlags(a, b, 10)).toBeNull();
  });
});

describe("wordPartners", () => {
  it("pairs removed lines with the added lines after them, in order", () => {
    const lines: UnifiedLine[] = [
      line("context", "keep"),
      line("del", "one"),
      line("del", "two"),
      line("add", "uno"),
      line("context", "keep"),
      line("add", "alone"),
    ];
    const partners = wordPartners(lines);
    expect(partners.get(lines[1])).toBe(lines[3]);
    expect(partners.get(lines[3])).toBe(lines[1]);
    expect(partners.has(lines[2])).toBe(false);
    expect(partners.has(lines[5])).toBe(false);
  });

  it("works out both sides of a pair once", () => {
    const removed = line("del", "value = 1");
    const added = line("add", "value = 2");
    expect(lineWordChanges(added, removed)).toEqual([[8, 9]]);
    expect(lineWordChanges(removed, added)).toEqual([[8, 9]]);
    expect(lineWordChanges(line("context", "x"), added)).toBeNull();
  });
});

describe("markPieces", () => {
  it("cuts syntax pieces where word changes start and end", () => {
    const pieces = [
      { text: "const ", color: "#k" },
      { text: "count", color: "#v" },
      { text: " = 1;" },
    ];
    expect(markPieces(pieces, [[8, 12]])).toEqual([
      { text: "const ", color: "#k", changed: false },
      { text: "co", color: "#v", changed: false },
      { text: "unt", color: "#v", changed: true },
      { text: " ", changed: true },
      { text: "= 1;", changed: false },
    ]);
  });

  it("leaves pieces whole without changes", () => {
    expect(markPieces([{ text: "abc" }], [])).toEqual([
      { text: "abc", changed: false },
    ]);
  });
});

function line(kind: UnifiedLine["kind"], text: string): UnifiedLine {
  return { kind, text, oldNumber: 1, newNumber: 1 };
}
