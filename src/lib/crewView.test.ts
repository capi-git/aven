import { describe, expect, it } from "vitest";
import { queueCard, startCard } from "./crewLoop";
import { crewBoardInfo, crewStatus } from "./crewView";
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

describe("a Queued card", () => {
  it("can go back to Ideas before it starts (Not now)", () => {
    const queued = queueCard(
      { id: "c", title: "Dark mode", brief: "x", from: "you", maxRounds: 3 },
      1,
    );
    expect(crewBoardInfo(queued, names).actions).toEqual([
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
