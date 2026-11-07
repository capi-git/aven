import { describe, expect, it } from "vitest";
import {
  firstSentence,
  prBranch,
  prText,
  reviewChecks,
  reviewPages,
  reviewRows,
} from "./avosReview";
import type { CrewCard } from "./crews";

function card(
  id: string,
  title: string,
  round: {
    summary?: string;
    pages?: string[];
    ran?: { command: string; ok: boolean }[];
  } = {},
  extra: Partial<CrewCard> = {},
): CrewCard {
  return {
    id,
    title,
    brief: title,
    from: "you",
    stage: "ready",
    round: 1,
    maxRounds: 3,
    rounds: [
      {
        n: 1,
        ...(round.summary !== undefined
          ? {
              handoff: {
                summary: round.summary,
                howToCheck: [],
                ran: [],
                ...(round.pages ? { pages: round.pages } : {}),
              },
            }
          : {}),
        verdict: {
          pass: true,
          summary: "Looks right",
          mustFix: [],
          later: [],
          ran: round.ran ?? [],
        },
      },
    ],
    later: [],
    runs: 2,
    queuedAt: 1,
    updatedAt: 2,
    ...extra,
  };
}

describe("What changed", () => {
  it("lists each card with the first sentence its Builder said", () => {
    expect(
      reviewRows([
        card("a", "Fix the pricing table on phones", {
          summary:
            "Plans stack on a phone instead of squeezing into a row. Prices stay on one line too.",
        }),
        card("b", "Use British spelling"),
      ]),
    ).toEqual([
      {
        id: "a",
        title: "Fix the pricing table on phones",
        line: "Plans stack on a phone instead of squeezing into a row.",
      },
      { id: "b", title: "Use British spelling" },
    ]);
  });

  it("leaves out a summary that only repeats the title", () => {
    expect(
      reviewRows([card("a", "Dark mode", { summary: "Dark mode" })])[0],
    ).toEqual({ id: "a", title: "Dark mode" });
  });

  it("cuts a long sentence at a word", () => {
    const line = firstSentence(`${"word ".repeat(60)}end.`, 30);
    expect(line.length).toBeLessThanOrEqual(31);
    expect(line.endsWith("word…")).toBe(true);
  });
});

describe("how it was checked", () => {
  it("names the checks that passed, a few at most", () => {
    expect(
      reviewChecks([
        card("a", "A", {
          ran: [
            { command: "npm test", ok: true },
            { command: "npm run lint", ok: false },
          ],
        }),
        card("b", "B", {
          ran: [
            { command: "npm test", ok: true },
            { command: "tsc", ok: true },
            { command: "playwright", ok: true },
            { command: "vitest", ok: true },
          ],
        }),
      ]),
    ).toBe("Checker ran npm test, tsc, playwright and 1 more");
  });

  it("says when nothing was run", () => {
    expect(reviewChecks([card("a", "A")])).toBe(
      "Checker looked at it and found no problems",
    );
  });

  it("says when the work was moved onto your files and not checked again", () => {
    expect(
      reviewChecks([
        card(
          "a",
          "A",
          {},
          { stacked: { commit: "c", parent: "p", replayed: true } },
        ),
      ]),
    ).toBe("Moved onto your latest files, not checked again since");
  });
});

describe("the pull request", () => {
  it("is named after the card, or the first and how many more", () => {
    expect(prText([card("a", "Fix the pricing table")]).title).toBe(
      "Fix the pricing table",
    );
    expect(
      prText([card("a", "Fix the pricing table"), card("b", "Dark mode")])
        .title,
    ).toBe("Fix the pricing table and 1 more");
  });

  it("says what changed and how it was checked", () => {
    const { body } = prText([
      card("a", "Fix the pricing table", {
        summary: "Plans stack on phones.",
        ran: [{ command: "npm test", ok: true }],
      }),
    ]);
    expect(body).toContain(
      "- **Fix the pricing table**: Plans stack on phones.",
    );
    expect(body).toContain("- Checker ran npm test");
  });

  it("goes out on an avos/ branch named after it", () => {
    expect(
      prBranch("Fix the pricing table on phones!", 1_700_000_000_000),
    ).toMatch(/^avos\/fix-the-pricing-table-on-phones-[a-z0-9]{1,6}$/);
    expect(prBranch("✨", 1)).toBe("avos/changes-1");
    expect(prBranch("a".repeat(80), 5).length).toBeLessThanOrEqual(5 + 40 + 7);
  });
});

describe("the pages Review pictures", () => {
  it("takes the pages each card's Builder changed, each once, a few at most", () => {
    expect(
      reviewPages([
        card("a", "A", { summary: "x", pages: ["/pricing", "/"] }),
        card("b", "B", {
          summary: "y",
          pages: ["/pricing", "/plans", "/more"],
        }),
      ]),
    ).toEqual(["/pricing", "/", "/plans"]);
    expect(reviewPages([card("a", "A", { summary: "Backend only" })])).toEqual(
      [],
    );
  });
});
