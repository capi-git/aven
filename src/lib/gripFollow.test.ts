import { describe, expect, it } from "vitest";
import { gripShare } from "./gripFollow";

describe("gripShare", () => {
  it("gives the pointer's place along the divider", () => {
    expect(gripShare(150, 100, 200)).toBe(0.25);
    expect(gripShare(300, 100, 200)).toBe(1);
  });

  it("stays within the divider", () => {
    expect(gripShare(50, 100, 200)).toBe(0);
    expect(gripShare(400, 100, 200)).toBe(1);
  });

  it("falls back to the middle for an empty divider", () => {
    expect(gripShare(150, 100, 0)).toBe(0.5);
    expect(gripShare(Number.NaN, 100, 200)).toBe(0.5);
  });
});
