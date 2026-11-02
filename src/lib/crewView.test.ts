import { describe, expect, it } from "vitest";
import { queueCard, startCard } from "./crewLoop";
import { crewBoardInfo, crewCardMenu, crewStatus } from "./crewView";
import { newCrew, type Crew, type CrewCard } from "./crews";

const names = { builder: "Beetle", checker: "Owl" };

function stuck(reason: NonNullable<CrewCard["stuck"]>["reason"]): CrewCard {
  return {
    ...startCard(
      queueCard(
        { id: "c", title: "Dark mode", brief: "x", from: "you", maxRounds: 3 },
        1,
      ),
      2,
    ),
    stage: "stuck",
    holder: "checker",
    stuck: { reason, text: "Owl's turn didn't finish" },
  };
}

describe("a Stuck card's buttons", () => {
  it("offers Try again for a turn that didn't finish", () => {
    for (const reason of [
      "failed",
      "timeout",
      "stopped",
      "no-verdict",
    ] as const)
      expect(crewBoardInfo(stuck(reason), names).actions[0]).toEqual({
        id: "more",
        label: "Try again",
        primary: true,
      });
  });

  it("offers One more round after the last round or a change that moved", () => {
    for (const reason of ["rounds", "no-change", "changed"] as const)
      expect(crewBoardInfo(stuck(reason), names).actions[0]?.label).toBe(
        "One more round",
      );
  });
});

describe("a card that changed nothing", () => {
  it("says so in its Builder's words, with Try again or Throw away", () => {
    const card: CrewCard = {
      ...stuck("no-change"),
      holder: "builder",
      stuck: { reason: "no-change", text: "Beetle changed nothing" },
      rounds: [
        {
          n: 1,
          handoff: {
            summary: "The fix was already in the team's latest commit",
            howToCheck: [],
            ran: [],
          },
        },
      ],
    };
    const info = crewBoardInfo(card, names);
    expect(info).toMatchObject({
      label: "Needs you",
      needsYou: true,
      line: "Beetle changed nothing · The fix was already in the team's latest commit",
    });
    expect(info.actions.map((action) => action.label)).toEqual([
      "One more round",
      "Throw away",
    ]);
    expect(crewCardMenu(card).map((action) => action.label)).toEqual([
      "Take over in a chat",
      "Back to Ideas",
    ]);
  });
});

describe("a Queued card", () => {
  it("can go back to Ideas before it starts (Not now, in its ⋯)", () => {
    const queued = queueCard(
      { id: "c", title: "Dark mode", brief: "x", from: "you", maxRounds: 3 },
      1,
    );
    expect(crewBoardInfo(queued, names)).toMatchObject({
      label: "Up next",
      actions: [],
    });
    expect(crewCardMenu(queued)).toEqual([
      { id: "back-to-ideas", label: "Not now" },
    ]);
  });
});

describe("the crew's one word", () => {
  /** A card waiting for its Builder's next round, with no turn running. */
  const waiting = (patch: Partial<Crew> = {}, turn = false): Crew => {
    const card = startCard(
      queueCard(
        { id: "c", title: "Dark mode", brief: "x", from: "you", maxRounds: 3 },
        1,
      ),
      2,
    );
    return {
      ...newCrew("/Users/me/site"),
      on: true,
      cards: [
        turn
          ? {
              ...card,
              turn: {
                role: "builder",
                sessionId: "s",
                turnId: "t",
                sentAt: 3,
              },
            }
          : card,
      ],
      ...patch,
    };
  };

  it("is Paused while you or a limit hold a card that waits for its turn", () => {
    expect(crewStatus(waiting({ paused: true }))).toBe("paused");
    expect(
      crewStatus(waiting({ hold: { reason: "quiet-hours", at: 1 } })),
    ).toBe("paused");
  });

  it("is Working while a turn runs, paused or not, and while nothing holds it", () => {
    expect(crewStatus(waiting({ paused: true }, true))).toBe("working");
    expect(crewStatus(waiting())).toBe("working");
  });
});
