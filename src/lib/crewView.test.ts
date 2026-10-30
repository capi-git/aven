import { describe, expect, it } from "vitest";
import { queueCard, startCard } from "./crewLoop";
import { crewBoardInfo } from "./crewView";
import type { CrewCard } from "./crews";

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
