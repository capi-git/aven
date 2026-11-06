import { describe, expect, it } from "vitest";
import { AVEN_DIR, outsideScope } from "./crews";

describe("Aven's own folder in a copy", () => {
  it("is never a change outside a Builder's scope", () => {
    expect(AVEN_DIR).toBe(".aven");
    expect(
      outsideScope(
        [
          "src/ui/a.ts",
          ".aven/.gitignore",
          ".aven/files/Report.pdf",
          "./.aven/files/chart.png",
          ".aven",
          "src/server.ts",
        ],
        ["src/ui/"],
      ),
    ).toEqual(["src/server.ts"]);
  });

  it("counts only the copy's top-level folder, not a name like it", () => {
    expect(
      outsideScope(
        [".avenue/a.ts", "docs/.aven/notes.md", ".aven-old/x"],
        ["src/"],
      ),
    ).toEqual([".avenue/a.ts", "docs/.aven/notes.md", ".aven-old/x"]);
  });
});
