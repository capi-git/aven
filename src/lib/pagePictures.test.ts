import { describe, expect, it } from "vitest";
import { pageAddress } from "./pagePictures";

describe("a page's address on a running app", () => {
  it("puts the page on the app's own address", () => {
    expect(pageAddress("http://127.0.0.1:5174", "/pricing")).toBe(
      "http://127.0.0.1:5174/pricing",
    );
    expect(pageAddress("http://localhost:3000/", "/settings?tab=team")).toBe(
      "http://localhost:3000/settings?tab=team",
    );
    expect(pageAddress("http://127.0.0.1:5174", "/")).toBe(
      "http://127.0.0.1:5174/",
    );
  });
});

import { partAt, readLayout } from "./pagePictures";

describe("where things are on a picture", () => {
  it("keeps only boxes inside the picture and parts of the right shape", () => {
    expect(
      readLayout({
        spots: [[0.1, 0.2, 0.3, 0.1], null, [0.9, 0, 0.5, 0.1], "x"],
        parts: [
          { box: [0, 0, 1, 1], what: "section", element: "main" },
          { box: [0, 0, 2, 1], what: "too wide", element: "div" },
          { box: [0, 0, 1, 1], what: 3, element: "div" },
        ],
      }),
    ).toEqual({
      spots: [[0.1, 0.2, 0.3, 0.1], null, null, null],
      parts: [{ box: [0, 0, 1, 1], what: "section", element: "main" }],
    });
    expect(readLayout(null)).toEqual({});
  });

  it("names the most particular thing under a click", () => {
    const parts = [
      { box: [0, 0, 1, 1] as const, what: "section", element: "main" },
      { box: [0.1, 0.1, 0.4, 0.2] as const, what: "button “Go”", element: "b" },
    ];
    expect(partAt(parts, 0.2, 0.2)?.what).toBe("button “Go”");
    // Something as big as the page names nothing in particular.
    expect(partAt(parts, 0.8, 0.8)).toBeUndefined();
    expect(partAt([], 0.5, 0.5)).toBeUndefined();
  });
});
