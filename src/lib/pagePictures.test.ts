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
