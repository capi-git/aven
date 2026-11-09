import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/index.css", "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The selectors of the rule that turns text selection back on. */
function selectable(): string[] {
  const rule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(
    ([, selectors, body]) =>
      /user-select:\s*text/.test(body!) && selectors!.includes("textarea"),
  );
  return (rule?.[1] ?? "")
    .split(",")
    .map((selector) => selector.trim())
    .filter(Boolean);
}

describe("text you can copy", () => {
  it("includes Avos's chat and its activity, like any chat", () => {
    expect(selectable()).toEqual(
      expect.arrayContaining([
        ".agent-transcript",
        ".team-thread-scroll",
        ".crew-feed-scroll",
      ]),
    );
    // The classes it names are the ones the chat and the activity draw.
    expect(readFileSync("src/surfaces/TeamChat.tsx", "utf8")).toContain(
      'className="team-thread-scroll"',
    );
    expect(readFileSync("src/surfaces/CrewBoard.tsx", "utf8")).toContain(
      'className="crew-feed-scroll"',
    );
  });
});
