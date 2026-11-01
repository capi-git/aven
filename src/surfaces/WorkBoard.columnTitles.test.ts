import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The Board's column titles are plain labels: Building never takes the
 * workspace's accent colour, which can be red and reads as an alarm. A
 * crew that holds says why in words, on its hold line. happy-dom doesn't
 * compute styles, so this reads the rules themselves.
 */

const board = readFileSync("src/surfaces/WorkBoard.css", "utf8");

describe("the Board's column titles", () => {
  it("never colour Building with the accent", () => {
    expect(board).not.toMatch(
      /\[data-board-column="building"\]\s*\{[^}]*--work-board-tone/,
    );
    expect(board).not.toMatch(/--work-board-tone:\s*var\(--color-accent\)/);
  });

  it("are the content colour unless a column says otherwise", () => {
    const at = board.indexOf("\n.work-board-column {");
    const column = board.slice(at, board.indexOf("}", at));
    expect(column).toContain("--work-board-tone: var(--color-content);");
  });
});
