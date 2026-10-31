import { describe, expect, it } from "vitest";
import {
  CREW_INBOX_ACTIONS,
  crewInboxActions,
  crewInboxCard,
  crewInboxHeading,
  openCrewInboxItems,
  withInboxResolved,
} from "./crewInbox";
import { queueCard, startCard } from "./crewLoop";
import { newCrew, withCard, type Crew, type CrewCard } from "./crews";

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

  it("shows the cards on the crew's branch as one batch to apply", () => {
    let crew: Crew = {
      ...newCrew("/Users/me/aven-site"),
      stack: { base: "a".repeat(40) },
    };
    const one = card({ id: "a", title: "Timer", stage: "ready" });
    const two = card({ id: "b", title: "Settings", stage: "ready" });
    crew = withCard(crew, {
      ...one,
      inbox: crewInboxCard(one, 5),
      stacked: { commit: "1".repeat(40), parent: "a".repeat(40) },
    });
    crew = withCard(crew, {
      ...two,
      inbox: crewInboxCard(two, 9),
      stacked: { commit: "2".repeat(40), parent: "1".repeat(40) },
    });
    const items = openCrewInboxItems({ k: crew });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "crew:k:batch",
      card: { id: "b" },
      review: {
        title: "2 cards ready on the crew's branch",
        postedAt: 9,
      },
    });
    expect(items[0].review.summary).toContain("Timer · Settings");
    // Its only button opens the batch's Review: Apply lands what you saw there.
    expect(items[0].batch).toBe(true);
    expect(crewInboxActions(items[0]).map((action) => action.id)).toEqual([
      "review",
    ]);
    expect(
      crewInboxActions({ ...items[0], batch: undefined }).map(
        (action) => action.id,
      ),
    ).toEqual(["apply", "open-board"]);
    // Replayed onto your files by a restack: it never says checked.
    const replayed = withCard(crew, {
      ...crew.cards[1]!,
      stacked: { ...crew.cards[1]!.stacked!, replayed: true },
    });
    expect(openCrewInboxItems({ k: replayed })[0]!.review.summary).toContain(
      "replayed onto your files, not re-checked",
    );
  });
});
