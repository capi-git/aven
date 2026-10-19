import { describe, expect, it } from "vitest";
import { slowPageNotice } from "./browserSlowLoad";

describe("slowPageNotice", () => {
  it("stays quiet once the page is mostly loaded and showing", () => {
    expect(slowPageNotice("https://krillion.io/", 0.5)).toBeNull();
    expect(slowPageNotice("https://krillion.io/", 0.9)).toBeNull();
    expect(slowPageNotice("http://localhost:5173/", 1)).toBeNull();
  });

  it("points at the local server for a local preview that hasn't loaded", () => {
    expect(slowPageNotice("http://localhost:5173/", 0.1)).toBe(
      "This page is taking longer to load. Check that the local server is running; the preview will keep loading.",
    );
    expect(slowPageNotice("http://127.0.0.1:5176/", null)).toContain(
      "local server",
    );
  });

  it("doesn't mention a local server for a website", () => {
    expect(slowPageNotice("https://krillion.io/", 0.2)).toBe(
      "This page is taking longer to load. It will keep loading.",
    );
    expect(slowPageNotice("https://example.com/", null)).not.toContain(
      "local server",
    );
  });
});
