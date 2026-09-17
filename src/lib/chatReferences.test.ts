import { describe, expect, it } from "vitest";
import { chatReferenceParts } from "./chatReferences";

const references = (text: string) =>
  chatReferenceParts(text, "/project").filter((part) => part.href);

describe("chat references", () => {
  it("preserves whitespace and balanced URL parentheses while excluding sentence punctuation", () => {
    const text =
      "See  (https://en.wikipedia.org/wiki/Function_(mathematics)).\n\tNext";
    const parts = chatReferenceParts(text);
    expect(parts.map((part) => part.text).join("")).toBe(text);
    expect(parts.filter((part) => part.href)).toEqual([
      {
        text: "https://en.wikipedia.org/wiki/Function_(mathematics)",
        href: "https://en.wikipedia.org/wiki/Function_(mathematics)",
      },
    ]);
  });

  it("normalizes shorthand URLs and preserves their visible spelling", () => {
    expect(
      references("www.example.com/x, localhost:5173/a?x=1#two; localhost."),
    ).toEqual([
      { text: "www.example.com/x", href: "https://www.example.com/x" },
      {
        text: "localhost:5173/a?x=1#two",
        href: "http://localhost:5173/a?x=1#two",
      },
      { text: "localhost", href: "http://localhost/" },
    ]);
  });

  it("retains IPv6 brackets and balanced path brackets", () => {
    const text = "[http://[::1]:5173/a] https://example.com/a[b]{c}.";
    expect(references(text).map((part) => part.text)).toEqual([
      "http://[::1]:5173/a",
      "https://example.com/a[b]{c}",
    ]);
    expect(
      chatReferenceParts(text)
        .map((part) => part.text)
        .join(""),
    ).toBe(text);
  });

  it.each([
    "javascript:https://example.com",
    "data:text/html,https://example.com",
    "ftp://www.example.com",
    "file:///Users/me/file.pdf",
    "me@www.example.com",
    "notlocalhost:3000",
    "localhost:99999",
    "https://",
    "localhost.company.com",
    "[bad](javascript:alert)",
    "[bad](%6aavascript%3Aalert)",
    "https://user:pass@example.com",
    "https://tauri.localhost",
    "[bad](www.example.com:99999)",
    "[bad](localhost:99999)",
    "[bad](<www.example.com:99999>)",
  ])("does not link unsupported, embedded or invalid targets: %s", (text) => {
    expect(references(text)).toEqual([]);
    expect(
      chatReferenceParts(text, "/project")
        .map((part) => part.text)
        .join(""),
    ).toBe(text);
  });

  it("preserves explicit document syntax and line navigation without guessing filenames", () => {
    const text =
      "Read [Plan](<docs/My Plan.md>) and [Code](src/App.tsx:12). Plain App.tsx";
    const parts = chatReferenceParts(text, "/project");
    expect(parts.map((part) => part.text).join("")).toBe(text);
    expect(parts.filter((part) => part.file).map((part) => part.file)).toEqual([
      { path: "/project/docs/My Plan.md" },
      { path: "/project/src/App.tsx", navigation: { line: 12 } },
    ]);
  });

  it.each([
    "https://example.com/[file](src/App.tsx)",
    "[site](www.example.com)",
    "[site](localhost:5173)",
  ])("keeps web references from overlapping document syntax: %s", (text) => {
    const parts = chatReferenceParts(text, "/project");
    expect(parts.map((part) => part.text).join("")).toBe(text);
    expect(parts.filter((part) => part.href)).toHaveLength(1);
    expect(parts.some((part) => part.file)).toBe(false);
  });
});
