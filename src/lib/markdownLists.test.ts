import { describe, expect, it } from "vitest";
import { separateNumberedLists } from "./markdownLists";

describe("separateNumberedLists", () => {
  it("starts a list numbered on from 4 under a bold title", () => {
    const text = [
      "**One word for one thing**",
      "4. **Four names.** One.",
      "5. **Three words.** Two.",
    ].join("\n");
    expect(separateNumberedLists(text)).toBe(
      [
        "**One word for one thing**",
        "",
        "4. **Four names.** One.",
        "5. **Three words.** Two.",
      ].join("\n"),
    );
  });

  it("leaves a list that starts at 1 and items inside a list alone", () => {
    const text = ["Bugs", "1. One", "2. Two", "3. Three"].join("\n");
    expect(separateNumberedLists(text)).toBe(text);
  });

  it("keeps a wrapped item's next sibling in its list", () => {
    const text = ["3. Item three", "continues here", "4. Item four"].join("\n");
    expect(separateNumberedLists(text)).toBe(text);
  });

  it("leaves code, quotes and indented lines alone", () => {
    const fenced = ["```", "text", "4. not a list", "```"].join("\n");
    expect(separateNumberedLists(fenced)).toBe(fenced);
    const quoted = ["> Said", "> 4. inside"].join("\n");
    expect(separateNumberedLists(quoted)).toBe(quoted);
    const nested = ["- Item", "  text", "    4. code"].join("\n");
    expect(separateNumberedLists(nested)).toBe(nested);
  });

  it("starts a new list after a paragraph that follows a list", () => {
    const text = ["1. One", "", "Then more", "7. Seven"].join("\n");
    expect(separateNumberedLists(text)).toBe(
      ["1. One", "", "Then more", "", "7. Seven"].join("\n"),
    );
  });

  it("does not split a sentence that only mentions a number", () => {
    const text = "We shipped in 2026. It worked.";
    expect(separateNumberedLists(text)).toBe(text);
  });

  it("is stable as the text streams in", () => {
    const full = ["**Title**", "4. Four", "5. Five"].join("\n");
    const done = separateNumberedLists(full);
    for (let end = 1; end < full.length; end += 1) {
      const part = separateNumberedLists(full.slice(0, end));
      // Only the text not yet written can differ; what is there is kept.
      expect(done.startsWith(part.slice(0, part.lastIndexOf("\n") + 1))).toBe(
        true,
      );
    }
  });
});
