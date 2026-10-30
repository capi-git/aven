import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The Board never grows past its pane: each column's list of cards scrolls
 * on its own, and so does the crew's Feed, with Tell the crew pinned below
 * it. happy-dom doesn't lay pages out, so this reads the rules themselves.
 */

const board = readFileSync("src/surfaces/WorkBoard.css", "utf8");
const crew = readFileSync("src/surfaces/CrewBoard.css", "utf8");

function rule(css: string, selector: string, from = 0): string {
  const at = css.indexOf(`${selector} {`, from);
  if (at < 0) throw new Error(`Missing ${selector}`);
  return css.slice(at, css.indexOf("}", at));
}

/** A rule inside a container query, by the query's condition. */
function within(css: string, condition: string, selector: string): string {
  const at = css.indexOf(`@container (${condition})`);
  if (at < 0) throw new Error(`Missing @container (${condition})`);
  return rule(css, selector, at);
}

describe("the Board's columns scroll on their own", () => {
  it("scrolls a column's list of cards, not the page, keeping its title and Add an idea", () => {
    expect(rule(board, ".work-board-list")).toContain("overflow-y: auto;");
    expect(rule(board, ".work-board-list")).toContain("min-height: 0;");
    expect(
      rule(board, ".work-board-column > :not(.work-board-list)"),
    ).toContain("flex-shrink: 0;");
  });

  it("fits one row of columns to the pane", () => {
    const row = within(board, "min-width: 761px", ".work-board-columns");
    expect(row).toContain("flex: 1 1 0;");
    expect(row).toContain("align-items: stretch;");
    expect(rule(board, ".work-board")).toContain("flex-direction: column;");
  });

  it("caps each column when they wrap into rows", () => {
    expect(
      within(
        board,
        "max-width: 760px",
        ".work-board-columns > .work-board-column",
      ),
    ).toContain("max-height: 480px;");
    expect(
      within(
        crew,
        "max-width: 1180px",
        ".work-board[data-crew] .work-board-column:not(.crew-feed)",
      ),
    ).toContain("max-height: 520px;");
  });
});

describe("the Feed scrolls", () => {
  it("scrolls its entries in its column, with Tell the crew pinned below", () => {
    expect(rule(crew, ".crew-feed-scroll")).toContain("overflow-y: auto;");
    expect(rule(crew, ".crew-feed-scroll-wrap")).toContain("flex: 1 1 0;");
    expect(rule(crew, ".crew-feed .crew-tell")).toContain("flex: none;");
    expect(
      within(crew, "max-width: 1180px", ".work-board[data-crew] .crew-feed"),
    ).toContain("height: 420px;");
  });

  it("folds a long entry to four lines", () => {
    const folded = rule(crew, ".crew-feed-words[data-folded]");
    expect(folded).toContain("-webkit-line-clamp: 4;");
    expect(folded).toContain("overflow: hidden;");
  });
});
