import { describe, expect, it } from "vitest";
import { changedBoxes } from "./pictureChanges";

/** A white RGBA picture, with black rectangles drawn on it. */
function picture(
  width: number,
  height: number,
  boxes: [number, number, number, number][] = [],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [left, top, w, h] of boxes)
    for (let y = top; y < top + h; y++)
      for (let x = left; x < left + w; x++)
        data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  return data;
}

describe("where a page looks different", () => {
  it("boxes each changed area, read top to bottom", () => {
    const before = picture(200, 400);
    const after = picture(200, 400, [
      [120, 300, 40, 20],
      [16, 40, 64, 16],
    ]);
    expect(changedBoxes(before, after, 200, 400)).toEqual([
      [0.08, 0.1, 0.32, 0.04],
      [0.6, 0.74, 0.2, 0.06],
    ]);
  });

  it("finds nothing when nothing changed, the sizes differ, or everything changed", () => {
    const blank = picture(100, 100);
    expect(changedBoxes(blank, picture(100, 100), 100, 100)).toEqual([]);
    expect(changedBoxes(blank, picture(100, 50), 100, 100)).toEqual([]);
    expect(
      changedBoxes(blank, picture(100, 100, [[0, 0, 100, 100]]), 100, 100),
    ).toEqual([]);
  });

  it("ignores a stray pixel or two", () => {
    const before = picture(100, 100);
    const after = picture(100, 100, [[50, 50, 1, 1]]);
    expect(changedBoxes(before, after, 100, 100)).toEqual([]);
  });
});
