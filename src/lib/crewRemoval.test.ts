import { describe, expect, it } from "vitest";
import { queueCard } from "./crewLoop";
import { helperRemoval, withHelperRemoved } from "./crewRemoval";
import { newCrew, type Crew, type CrewCard } from "./crews";

const NOW = new Date(2026, 10, 7, 12).getTime();

function card(id: string, patch: Partial<CrewCard> = {}): CrewCard {
  return {
    ...queueCard(
      { id, title: `Card ${id}`, brief: id, from: "you", maxRounds: 3 },
      NOW,
    ),
    ...patch,
  };
}

function crew(patch: Partial<Crew> = {}): Crew {
  return {
    ...newCrew("/Users/me/pom", NOW),
    on: true,
    members: [
      { id: "lead", role: "lead" },
      { id: "builder", role: "builder" },
      { id: "builder-2", role: "builder", sessionId: "b2" },
      { id: "checker", role: "checker" },
      { id: "scout", role: "scout", sessionId: "s1" },
    ],
    ...patch,
  };
}

describe("what removing a helper does", () => {
  it("says only that its chat stays when it has no work", () => {
    expect(helperRemoval(crew(), "scout")).toEqual({
      ok: true,
      busy: false,
      lines: ["Its chat stays in your history."],
    });
  });

  it("names who takes its cards, and says when that helper is off", () => {
    const team = crew({
      cards: [
        card("a", { builderId: "builder-2", stage: "ready" }),
        card("b", { builderId: "builder-2" }),
        card("c", { builderId: "builder-2", stage: "applied" }),
      ],
    });
    expect(helperRemoval(team, "builder-2")).toMatchObject({
      ok: true,
      lines: ["Its 2 cards go to Builder.", "Its chat stays in your history."],
    });
    const off = {
      ...team,
      members: team.members.map((member) =>
        member.id === "builder" ? { ...member, paused: true } : member,
      ),
    };
    expect(helperRemoval(off, "builder-2")).toMatchObject({
      lines: [
        "Its 2 cards go to Builder, which is off.",
        "Its chat stays in your history.",
      ],
    });
  });

  it("stops the card it is working on, which then waits for you", () => {
    const team = crew({
      cards: [
        card("a", {
          stage: "building",
          holder: "builder",
          builderId: "builder-2",
          turn: { role: "builder", sessionId: "b2", turnId: "t", sentAt: NOW },
        }),
      ],
    });
    const plan = helperRemoval(team, "builder-2");
    expect(plan).toMatchObject({
      ok: true,
      stops: { id: "a" },
      busy: false,
      lines: [
        "It stops work on “Card a”, which waits for you.",
        "Its chat stays in your history.",
      ],
    });
  });

  it("stops a look round with no card of its own", () => {
    const team = crew();
    team.members[4] = {
      ...team.members[4]!,
      doing: { at: NOW, text: "Looking" },
    };
    expect(helperRemoval(team, "scout")).toMatchObject({
      busy: true,
      lines: ["What it's doing now stops.", "Its chat stays in your history."],
    });
  });

  it("keeps Avos, the Fixer and the last Checker, saying what to do instead", () => {
    const team = crew({
      members: [...crew().members, { id: "fixer", role: "fixer" }],
    });
    expect(helperRemoval(team, "lead")).toMatchObject({
      ok: false,
      title: "Avos stays",
    });
    expect(helperRemoval(team, "fixer")).toMatchObject({ ok: false });
    expect(helperRemoval(team, "checker")).toEqual({
      ok: false,
      title: "Avos needs a Checker",
      text: "Add another Checker first, or switch this one off.",
    });
    expect(helperRemoval(team, "nobody")).toBeNull();
  });
});

describe("the team without it", () => {
  it("gives a card in Avos's copy to another Builder, and leaves queued ones to your rules", () => {
    const next = withHelperRemoved(
      crew({
        defaultBuilder: "builder-2",
        routes: [{ id: "r", words: ["css"], to: "builder-2" }],
        cards: [
          card("a", { builderId: "builder-2", stage: "stuck" }),
          card("b", { builderId: "builder-2" }),
        ],
      }),
      "builder-2",
    );
    expect(next.members.map((member) => member.id)).not.toContain("builder-2");
    expect(next.cards.find((entry) => entry.id === "a")?.builderId).toBe(
      "builder",
    );
    expect(
      next.cards.find((entry) => entry.id === "b")?.builderId,
    ).toBeUndefined();
    expect(next.routes).toBeUndefined();
    expect(next.defaultBuilder).toBeUndefined();
    expect(next.retired).toEqual([{ sessionId: "b2", role: "builder" }]);
  });
});
