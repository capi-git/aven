import { describe, expect, it, vi } from "vitest";
import {
  browserBounds,
  browserSearchSuggestion,
  browserDownloadProgress,
  normalizeBrowserUrl,
  resolveBrowserAddress,
} from "./browser";

it.each([688, 900])(
  "includes the measured DOM viewport height %s in native placement",
  (viewportHeight) => {
    vi.stubGlobal("window", {
      innerHeight: viewportHeight,
      devicePixelRatio: 2,
    });
    try {
      const element = {
        getBoundingClientRect: () => ({
          x: 1,
          y: 113,
          width: 998,
          height: 574,
        }),
      } as HTMLElement;
      expect(browserBounds(element)).toEqual({
        x: 1,
        y: 113,
        width: 998,
        height: 574,
        scale: 2,
        viewportHeight,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

describe("browser omnibox", () => {
  it.each([
    ["google", "https://www.google.com/search?q=google"],
    [
      "  how to make tabs draggable  ",
      "https://www.google.com/search?q=how+to+make+tabs+draggable",
    ],
    ["cats & dogs", "https://www.google.com/search?q=cats+%26+dogs"],
    [
      "what is example.com",
      "https://www.google.com/search?q=what+is+example.com",
    ],
    ["google.com", "https://google.com/"],
    ["example.com:8443/docs", "https://example.com:8443/docs"],
    ["localhost:3000", "http://localhost:3000/"],
    ["192.168.1.10:8000/page", "http://192.168.1.10:8000/page"],
    ["[::1]:5173", "http://[::1]:5173/"],
    ["[fd00::1]:8080", "http://[fd00::1]:8080/"],
    ["preview.local:8080", "http://preview.local:8080/"],
    ["myserver:3000", "http://myserver:3000/"],
    ["https://google/", "https://google/"],
    ["http://intranet/tools", "http://intranet/tools"],
  ])("resolves %s", (input, expected) => {
    expect(resolveBrowserAddress(input)).toBe(expected);
  });

  it.each([
    "",
    "javascript:1",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:123",
    "tauri://localhost",
    "http://ipc.localhost",
    "https://user:secret@example.com",
    "https://",
    "hello\nworld",
  ])(
    "does not send unsafe or malformed address %s to a search engine",
    (input) => {
      expect(() => resolveBrowserAddress(input)).toThrow();
    },
  );

  it("offers recovery for old single-word addresses without changing explicit intranet URLs", () => {
    expect(browserSearchSuggestion("https://google/")).toBe("google");
    expect(browserSearchSuggestion("http://intranet/")).toBe("intranet");
    expect(browserSearchSuggestion("https://google.com/")).toBeUndefined();
    expect(browserSearchSuggestion("http://localhost/")).toBeUndefined();
    expect(
      browserSearchSuggestion("http://intranet:8000/tools"),
    ).toBeUndefined();
  });
});

describe("preview URL boundary", () => {
  it.each([
    ["example.com/docs", "https://example.com/docs"],
    [
      " https://example.com/path?q=hello%20world#part ",
      "https://example.com/path?q=hello%20world#part",
    ],
    ["localhost:3000", "http://localhost:3000/"],
    ["127.0.0.1:5173/page", "http://127.0.0.1:5173/page"],
    ["[::1]:8080", "http://[::1]:8080/"],
    ["http://192.168.1.10:8000", "http://192.168.1.10:8000/"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeBrowserUrl(input)).toBe(expected);
  });

  it.each([
    "",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "tauri://localhost",
    "data:text/html,hello",
    "https://user:secret@example.com",
    "http://ipc.localhost",
    "https://asset.localhost",
    "http://tauri.localhost",
    "https://example.com/\nsecret",
    "hello world",
    "https://",
  ])("rejects unsafe or invalid input %s", (input) => {
    expect(() => normalizeBrowserUrl(input)).toThrow();
  });
});

describe("download progress", () => {
  it("does not invent a total size when the server does not provide one", () => {
    expect(
      browserDownloadProgress({
        id: "one",
        filename: "file",
        receivedBytes: 1536,
        state: "in-progress",
      }),
    ).toBe("1.5 KB");
    expect(
      browserDownloadProgress({
        id: "one",
        filename: "file",
        receivedBytes: 1048576,
        totalBytes: 2097152,
        state: "in-progress",
      }),
    ).toBe("1.0 MB of 2.0 MB");
  });
  it("keeps invalid or unavailable byte counts readable", () => {
    expect(
      browserDownloadProgress({
        id: "one",
        filename: "file",
        receivedBytes: -1,
        totalBytes: 0,
        state: "in-progress",
      }),
    ).toBe("0 B");
    expect(
      browserDownloadProgress({
        id: "one",
        filename: "file",
        receivedBytes: Number.NaN,
        state: "in-progress",
      }),
    ).toBe("0 B");
  });
});
