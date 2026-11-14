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

it.each([
  ["8px", "8px", { bottomLeftRadius: 8, bottomRightRadius: 8 }],
  ["24px", "24px", { bottomLeftRadius: 10, bottomRightRadius: 10 }],
  ["0px", "0px", {}],
  ["invalid", "8px", { bottomRightRadius: 8 }],
])(
  "carries the measured bottom content radius %s/%s without altering viewport bounds",
  (left, right, radii) => {
    vi.stubGlobal("window", { innerHeight: 688, devicePixelRatio: 1.6 });
    vi.stubGlobal("getComputedStyle", () => ({
      borderBottomLeftRadius: left,
      borderBottomRightRadius: right,
    }));
    try {
      const element = {
        getBoundingClientRect: () => ({ x: 50, y: 100, width: 20, height: 60 }),
        parentElement: null,
      } as unknown as HTMLElement;
      expect(browserBounds(element)).toEqual({
        x: 50,
        y: 100,
        width: 20,
        height: 60,
        scale: 1.6,
        viewportHeight: 688,
        ...radii,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

describe("a page inside the rounded workspace card", () => {
  type Box = {
    rect: { x: number; y: number; width: number; height: number };
    style: Partial<CSSStyleDeclaration>;
    parent?: Box;
  };
  // The card: 10px corners, a 1px border and an overflow clip, as the
  // unified toolbar's `.personal-main` draws it. Its inner box runs from
  // (7, 41) to (793, 591).
  const card: Box = {
    rect: { x: 6, y: 40, width: 788, height: 552 },
    style: {
      overflow: "hidden",
      borderBottomLeftRadius: "10px",
      borderBottomRightRadius: "10px",
      borderLeftWidth: "1px",
      borderRightWidth: "1px",
      borderBottomWidth: "1px",
    },
  };
  // A pane between them clips square, as the workspace stage does.
  const stage: Box = {
    rect: { x: 7, y: 41, width: 786, height: 550 },
    style: { overflow: "hidden", borderBottomLeftRadius: "0px" },
    parent: card,
  };

  function bounds(rect: Box["rect"]) {
    const nodes = new Map<object, Box>();
    const element = (box: Box): HTMLElement => {
      const node = {
        getBoundingClientRect: () => box.rect,
        get parentElement() {
          return box.parent ? element(box.parent) : null;
        },
      };
      nodes.set(node, box);
      return node as unknown as HTMLElement;
    };
    vi.stubGlobal("window", { innerHeight: 600, devicePixelRatio: 2 });
    vi.stubGlobal(
      "getComputedStyle",
      (node: object) => nodes.get(node)?.style ?? {},
    );
    try {
      const page = browserBounds(
        element({ rect, style: { borderRadius: "0px" }, parent: stage }),
      );
      return [page?.bottomLeftRadius, page?.bottomRightRadius];
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it("rounds both bottom corners with the card's inner curve when it fills the card", () => {
    expect(bounds({ x: 7, y: 120, width: 786, height: 471 })).toEqual([9, 9]);
  });

  it("rounds only the corner a split page shares with the card", () => {
    expect(bounds({ x: 7, y: 120, width: 392, height: 471 })).toEqual([
      9,
      undefined,
    ]);
    expect(bounds({ x: 401, y: 120, width: 392, height: 471 })).toEqual([
      undefined,
      9,
    ]);
  });

  it("keeps square corners above a terminal or below another pane", () => {
    expect(bounds({ x: 7, y: 120, width: 786, height: 300 })).toEqual([
      undefined,
      undefined,
    ]);
  });
});

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
