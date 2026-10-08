import { describe, expect, it } from "vitest";
import {
  COLOR_PRESETS,
  colorChoiceLabel,
  normalizeColorChoice,
} from "./colorChoice";

describe("colour choices", () => {
  it("accepts the standard look, the workspace colour and hex colours", () => {
    expect(normalizeColorChoice("none")).toBe("none");
    expect(normalizeColorChoice("accent")).toBe("accent");
    expect(normalizeColorChoice("#4F7CFF")).toBe("#4f7cff");
  });

  it("rejects anything else", () => {
    for (const value of ["", "red", "#fff", "#12345g", "url(x)", 5, null])
      expect(normalizeColorChoice(value)).toBeNull();
  });

  it("names presets and calls anything else custom", () => {
    expect(colorChoiceLabel("none")).toBe("Graphite");
    expect(colorChoiceLabel("accent")).toBe("Workspace colour");
    expect(colorChoiceLabel("#123456")).toBe("Custom");
    expect(new Set(COLOR_PRESETS.map((preset) => preset.value)).size).toBe(
      COLOR_PRESETS.length,
    );
  });
});
