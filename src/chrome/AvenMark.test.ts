import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AVEN_MARK_BODY_PATH,
  AVEN_MARK_ROWS,
  AVEN_MARK_SUMMIT_PATH,
} from "../lib/avenMark";
import { AvenMark } from "./AvenMark";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("AvenMark", () => {
  it("draws the Pixel A as crisp cells, the body in the text colour", () => {
    const markup = renderToStaticMarkup(createElement(AvenMark));

    expect(markup).toContain('viewBox="0 0 7 8"');
    expect(markup).toContain('shape-rendering="crispEdges"');
    expect(markup).toContain(`d="${AVEN_MARK_BODY_PATH}" fill="currentColor"`);
    expect(markup).toContain(`d="${AVEN_MARK_SUMMIT_PATH}" fill="#57b5ff"`);
    // Default size: two pixels a cell.
    expect(markup).toContain('class="h-4 w-3.5"');
  });

  it("puts one summit pixel at the apex above the body", () => {
    expect(AVEN_MARK_SUMMIT_PATH).toBe("M3 0h1v1h-1z");
    const cells = AVEN_MARK_ROWS.join("").replace(/\./g, "");
    expect(cells).toBe("B" + "#".repeat(24));
  });

  it("matches the mark the brand script renders for the browser", () => {
    // scripts/render-brand-icons.py writes this file from its own copy of the grid.
    const svg = readFileSync(`${ROOT}/public/aven-mark.svg`, "utf8");

    expect(svg).toContain(`d="${AVEN_MARK_BODY_PATH}"`);
    expect(svg).toContain(`d="${AVEN_MARK_SUMMIT_PATH}"`);
    expect(svg).toContain('shape-rendering="crispEdges"');
  });
});
