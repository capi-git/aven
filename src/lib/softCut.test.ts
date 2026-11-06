import { describe, expect, it } from "vitest";
import { cutMiddle, edgeFades, stuckShadow } from "./softCut";

// One unit per character, as a monospace font measures.
const measure = (value: string) => Array.from(value).length;

describe("cutMiddle", () => {
  it("leaves a path that fits alone", () => {
    expect(cutMiddle("src/a.ts", 20, measure)).toBe("src/a.ts");
  });

  it("keeps both ends, the file's name first", () => {
    const cut = cutMiddle("src/surfaces/UnifiedDiffView.tsx", 15, measure);
    expect(cut).toBe("src/…ffView.tsx");
    expect(measure(cut)).toBeLessThanOrEqual(15);
  });

  it("cuts between characters, not inside one", () => {
    expect(cutMiddle("📁📁📁📁📁📁📁📁/a.ts", 6, measure)).toBe("📁📁….ts");
  });
});

describe("edgeFades", () => {
  it("fades only an edge with content hidden past it", () => {
    expect(edgeFades(0, 300, 300)).toEqual({ top: 0, bottom: 0 });
    expect(edgeFades(0, 600, 300)).toEqual({ top: 0, bottom: 1 });
    expect(edgeFades(300, 600, 300)).toEqual({ top: 1, bottom: 0 });
  });

  it("comes in over the first 15 px hidden", () => {
    expect(edgeFades(6, 600, 300).top).toBe(0.4);
    expect(edgeFades(292.5, 600, 300).bottom).toBe(0.5);
  });
});

describe("stuckShadow", () => {
  it("ramps in over the first 8 px of scroll", () => {
    expect(stuckShadow(0)).toBe(0);
    expect(stuckShadow(4)).toBe(0.5);
    expect(stuckShadow(40)).toBe(1);
    expect(stuckShadow(-10)).toBe(0);
  });
});
