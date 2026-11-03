import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AVEN_MARK_DOT_RADIUS,
  AVEN_MARK_GRID,
  AVEN_MARK_ROWS,
  avenMarkDots,
} from "../lib/avenMark";
import { AvenMark } from "./AvenMark";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("AvenMark", () => {
  it("draws Rise as round dots in the text colour, with no tile", () => {
    const markup = renderToStaticMarkup(createElement(AvenMark));

    expect(markup).toContain('viewBox="0 0 5 5"');
    expect(markup).toContain('fill="currentColor"');
    expect(markup).not.toContain("crispEdges");
    expect(markup).not.toContain("<rect");
    expect(markup).not.toContain("<path");
    expect(markup.match(/<circle /g)).toHaveLength(15);
    for (const { cx, cy } of avenMarkDots())
      expect(markup).toContain(
        `<circle cx="${cx}" cy="${cy}" r="${AVEN_MARK_DOT_RADIUS}">`,
      );
    // Default size: three pixels a cell.
    expect(markup).toContain('class="size-[15px]"');
  });

  it("is a 5 × 5 staircase, one more dot on each row down", () => {
    expect(AVEN_MARK_GRID).toEqual({ width: 5, height: 5 });
    AVEN_MARK_ROWS.forEach((row, index) => {
      expect(row).toBe("#".repeat(index + 1) + ".".repeat(4 - index));
    });
    expect(avenMarkDots()[0]).toEqual({ cx: 0.5, cy: 0.5 });
    expect(avenMarkDots().at(-1)).toEqual({ cx: 4.5, cy: 4.5 });
    // Dots stay apart: well under a cell across.
    expect(AVEN_MARK_DOT_RADIUS * 2).toBeLessThan(0.75);
  });

  it("matches the mark the brand script renders for the browser", () => {
    // scripts/render-brand-icons.py writes this file from its own copy of the grid.
    const svg = readFileSync(`${ROOT}/public/aven-mark.svg`, "utf8");

    expect(svg.match(/<circle /g)).toHaveLength(15);
    for (const { cx, cy } of avenMarkDots())
      expect(svg).toContain(
        `<circle cx="${cx}" cy="${cy}" r="${AVEN_MARK_DOT_RADIUS}"/>`,
      );
    expect(svg).not.toContain("crispEdges");
    // On smoky glass the wallpaper shows through.
    expect(svg).toContain('fill="#2a2b30" fill-opacity="0.7"');
  });
});
