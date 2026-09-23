import { describe, expect, it } from "vitest";
import { sortableMotionOffsets } from "./sortableMotion";

describe("sortable visual projection", () => {
  const items = [
    { id: "small", start: 10, size: 80 },
    { id: "large", start: 94, size: 140 },
    { id: "medium", start: 238, size: 100 },
  ];

  it("packs unequal-width siblings into the vacated space while preserving gaps", () => {
    expect([...sortableMotionOffsets(items, "large", 2)]).toEqual([
      ["small", 0],
      ["medium", -144],
      ["large", 104],
    ]);
    expect(items.map((item) => item.start)).toEqual([10, 94, 238]);
  });

  it("projects a move to the first slot and is independent of scroll position", () => {
    const expected = [
      ["medium", -228],
      ["small", 104],
      ["large", 104],
    ];
    expect([...sortableMotionOffsets(items, "medium", 0)]).toEqual(expected);
    expect([
      ...sortableMotionOffsets(
        items.map((item) => ({ ...item, start: item.start - 70 })),
        "medium",
        0,
      ),
    ]).toEqual(expected);
  });

  it("returns zero offsets at the current index and ignores missing sources", () => {
    expect([...sortableMotionOffsets(items, "large", 1).values()]).toEqual([
      0, 0, 0,
    ]);
    expect(sortableMotionOffsets(items, "missing", 1).size).toBe(0);
  });
});
