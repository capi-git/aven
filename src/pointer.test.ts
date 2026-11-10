import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("pointer sheet", () => {
  it("is loaded by every window", () => {
    expect(read("src/main.tsx")).toContain('import "./pointer.css";');
  });

  it("names the system's own cursors, with no image pointer", () => {
    const sheet = read("src/pointer.css");
    for (const name of ["default", "pointer", "grab", "progress"]) {
      expect(sheet).toContain(`--aven-cursor-${name}: ${name};`);
    }
    expect(sheet).not.toMatch(/url\(|image-set/);
  });
});
