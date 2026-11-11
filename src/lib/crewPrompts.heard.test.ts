import { describe, expect, it } from "vitest";
import { queueCard, startCard } from "./crewLoop";
import {
  builderMessage,
  cardHeard,
  checkerMessage,
  securityMessage,
} from "./crewPrompts";
import type { CrewCard, CrewNote } from "./crews";

const names = { builder: "Beetle", checker: "Owl" };
const notes: CrewNote[] = [{ id: "n", at: 1, text: "Use pnpm, not npm." }];
const about = "A to-do app for busy parents.";
const guidance = {
  instructions: "Prefer small components.",
  memory: "Tests run with pnpm test.",
  scope: ["src/settings"],
};

// The real-app check's stand-in (scripts/smoke/fake-claude.py) answers a
// card's turn only when its words carry the card's marker, and by role from
// "Round N of M", "finished round N of M", "passed round N of M by" and
// "This is a re-check".
const MARKER = "AVEN_SMOKE_CREW";

function card(round: number): CrewCard {
  return {
    ...startCard(
      queueCard(
        {
          id: "c",
          title: "Dark mode toggle",
          brief: `Dark mode toggle\n\nA switch in Settings. ${MARKER}`,
          from: "you",
          maxRounds: 3,
        },
        1,
      ),
      2,
    ),
    round,
  };
}

describe("a later round in the same conversation", () => {
  const standing = { about, notes, guidance };

  it("leaves out what the conversation already has, and keeps the card, the round and the scope", () => {
    const heard = new Set(cardHeard(standing));
    const first = builderMessage({
      card: card(1),
      notes,
      about,
      names,
      guidance,
    });
    const later = builderMessage({
      card: card(2),
      notes,
      about,
      names,
      guidance,
      heard,
    });
    for (const text of [about, "Use pnpm", "Prefer small", "Tests run with"]) {
      expect(first).toContain(text);
      expect(later).not.toContain(text);
    }
    expect(later).toContain(
      "Aven left out what the project is, the user's standing notes, your standing instructions and your notes: you have them earlier in this conversation, unchanged.",
    );
    expect(later).toContain(MARKER);
    expect(later).toContain("Round 2 of 3");
    expect(later).toContain("Work only inside: src/settings");
    expect(later).toContain("`aven-handoff` block");
    expect(later.length).toBeLessThan(first.length);
  });

  it("sends a section again once its words changed, and says when the user took one away", () => {
    const heard = new Set(cardHeard(standing));
    const text = builderMessage({
      card: card(2),
      notes: [],
      about,
      names,
      guidance: { memory: "Tests run with vitest now." },
      heard,
    });
    expect(text).toContain("Tests run with vitest now.");
    expect(text).toContain("<your-notes>");
    expect(text).not.toContain(about);
    expect(text).toContain(
      "The user took away their standing notes for the crew: the earlier ones no longer apply.",
    );
    expect(text).toContain(
      "You have no standing instructions now: the earlier ones no longer apply.",
    );
    expect(text).toContain("Aven left out what the project is:");
  });

  it("keeps the Checker's and Security's re-check words for the stand-in", () => {
    const heard = new Set(
      cardHeard({
        about,
        notes,
        guidance: {
          instructions: guidance.instructions,
          memory: guidance.memory,
        },
      }),
    );
    const checked = checkerMessage({
      card: card(2),
      notes,
      about,
      names,
      guidance,
      heard,
    });
    expect(checked).toContain("finished round 2 of 3");
    expect(checked).toContain(MARKER);
    expect(checked).not.toContain("Prefer small components.");
    const reviewed = securityMessage({
      card: card(2),
      notes,
      about,
      names,
      guidance,
      heard,
    });
    expect(reviewed).toMatch(/passed round 2 of 3 by Beetle/);
    expect(reviewed).toContain(MARKER);
    expect(reviewed).not.toContain(about);
  });

  it("records each kind's newest words, keeping a message's own keys", () => {
    const before = cardHeard(standing, new Set(["g:x", "rules:y"]));
    const after = cardHeard(
      { about, notes, guidance: { memory: "New notes." } },
      new Set(before),
    );
    expect(after).toContain("g:x");
    expect(after).toContain("rules:y");
    expect(after.filter((key) => key.startsWith("c:memory:"))).toHaveLength(1);
    expect(after.some((key) => key.startsWith("c:instructions:"))).toBe(false);
    expect(after.filter((key) => key.startsWith("c:about:"))).toEqual(
      before.filter((key) => key.startsWith("c:about:")),
    );
  });
});

describe("a re-check's list of what changed", () => {
  it("names at most 20 paths, and how many more", () => {
    const paths = (n: number, adds: number) =>
      Array.from({ length: n }, (_, index) => ({
        path: `src/file${index}.ts`,
        additions: adds,
        deletions: 0,
      }));
    const change = (n: number, adds: number) => ({
      base: "b",
      hash: `h${adds}`,
      files: n,
      additions: n * adds,
      deletions: 0,
      paths: paths(n, adds),
    });
    const base = card(2);
    const recheck: CrewCard = {
      ...base,
      rounds: [
        {
          n: 1,
          change: change(30, 1),
          verdict: {
            pass: false,
            summary: "Not yet.",
            mustFix: [{ text: "Broken" }],
            later: [],
            ran: [],
          },
        },
        { n: 2, change: change(30, 2) },
      ],
    };
    const text = checkerMessage({ card: recheck, notes, about, names });
    expect(text).toContain("This is a re-check");
    expect(text).toContain("src/file19.ts and 10 more.");
    expect(text).not.toContain("src/file20.ts,");
  });
});
