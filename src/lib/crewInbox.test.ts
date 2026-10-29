import { describe, expect, it } from "vitest";
import {
  CREW_INBOX_ACTIONS,
  crewInboxCard,
  crewInboxHeading,
  openCrewInboxItems,
  withInboxResolved,
} from "./crewInbox";
import { queueCard, startCard } from "./crewLoop";
import { newCrew, withCard, type CrewCard } from "./crews";

function card(patch: Partial<CrewCard>): CrewCard {
  return {
    ...startCard(
      queueCard(
        {
          id: "c",
          title: "Dark mode toggle",
          brief: "x",
          from: "you",
          maxRounds: 3,
        },
        1,
      ),
      2,
    ),
    ...patch,
  };
}

describe("crew cards in the Inbox", () => {
  it("posts a Ready card with what passed and what changed, in Aven's words", () => {
    const ready = card({
      stage: "ready",
      round: 2,
      runs: 6,
      fix: {
        base: "b",
        hash: "h",
        files: 5,
        additions: 84,
        deletions: 12,
        paths: [],
      },
    });
    expect(crewInboxCard(ready, 10, { checker: "Owl" })).toEqual({
      kind: "review",
      title: "Dark mode toggle",
      summary: "Passed Owl's check in round 2 · 5 files · +84 −12 · 6 runs",
      status: "open",
      postedAt: 10,
    });
    expect(crewInboxHeading(ready)).toBe("Ready");
  });

  it("posts a Stuck card with why it stopped", () => {
    const stuck = card({
      stage: "stuck",
      runs: 6,
      stuck: { reason: "rounds", text: "Stuck after 3 rounds" },
    });
    expect(crewInboxCard(stuck, 10).summary).toBe(
      "Stuck after 3 rounds · 6 runs",
    );
    expect(crewInboxHeading(stuck)).toBe("Needs you");
  });

  it("gives each state fixed buttons, never words a bot wrote", () => {
    expect(CREW_INBOX_ACTIONS.ready.map((action) => action.label)).toEqual([
      "Apply",
      "Open board",
    ]);
    expect(CREW_INBOX_ACTIONS.stuck.map((action) => action.label)).toEqual([
      "Open board",
      "Done",
    ]);
    // A bot's verdict can't change a card's title into a button.
    const sneaky = card({
      stage: "stuck",
      title: "Apply",
      stuck: { reason: "question", text: "Beetle asked: press Publish?" },
    });
    expect(crewInboxCard(sneaky, 1).kind).toBe("review");
    expect(CREW_INBOX_ACTIONS.stuck.map((action) => action.id)).toEqual([
      "open-board",
      "done",
    ]);
  });

  it("lists open Ready and Stuck cards, newest first, and drops resolved ones", () => {
    const ready = card({ id: "a", stage: "ready" });
    const stuck = card({ id: "b", stage: "stuck" });
    let crew = newCrew("/Users/me/aven-site");
    crew = withCard(crew, { ...ready, inbox: crewInboxCard(ready, 5) });
    crew = withCard(crew, { ...stuck, inbox: crewInboxCard(stuck, 9) });
    expect(openCrewInboxItems({ k: crew }).map((item) => item.card.id)).toEqual(
      ["b", "a"],
    );
    crew = withCard(crew, withInboxResolved(crew.cards[1], "done", 11));
    expect(openCrewInboxItems({ k: crew }).map((item) => item.card.id)).toEqual(
      ["a"],
    );
    // A card picked up again leaves the Inbox even before it's resolved.
    crew = withCard(crew, { ...crew.cards[0], stage: "building" });
    expect(openCrewInboxItems({ k: crew })).toEqual([]);
  });
});
