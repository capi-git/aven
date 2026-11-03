import { describe, expect, it } from "vitest";
import {
  crewHoldGate,
  ideaMayAutoStart,
  ideaWaits,
  ideasToBuild,
} from "./crewLimits";
import { queueCard, startCard } from "./crewLoop";
import { newCrew, withCard, withIdea, type Crew } from "./crews";

const NOON = new Date(2026, 9, 29, 12, 0).getTime();

function crew(patch: Partial<Crew> = {}): Crew {
  return { ...newCrew("/Users/me/aven-site", 1), on: true, ...patch };
}

describe("the Researcher's ideas", () => {
  it("always wait for you, whatever their size, and never start by themselves", () => {
    const idea = { at: 1, size: "small" as const, by: "researcher" as const };
    expect(ideaMayAutoStart(idea)).toBe(false);
    expect(ideaMayAutoStart({ ...idea, outside: true })).toBe(false);
    const current = withIdea(crew(), "from-research", idea);
    expect(ideaWaits(current, { id: "from-research" }, NOON)).toBe(
      "researcher",
    );
    expect(
      ideasToBuild(
        current,
        [
          { id: "from-research", column: "idea", createdAt: 1 },
          { id: "yours", column: "idea", createdAt: 2 },
        ],
        NOON,
      ).map((card) => card.id),
    ).toEqual(["yours"]);
  });
});

describe("a question with no Researcher on", () => {
  it("waits and says so, like a card without a Builder", () => {
    const question = startCard(
      queueCard(
        {
          id: "q",
          title: "How do others do it?",
          brief: "q",
          from: "you",
          kind: "research",
          maxRounds: 1,
        },
        1,
      ),
      2,
    );
    const held = crewHoldGate({
      crew: withCard(
        crew({
          members: [
            { id: "builder", role: "builder" },
            { id: "researcher", role: "researcher", paused: true },
          ],
        }),
        question,
      ),
      now: NOON,
      weeklyUsed: 40,
      fixerRuns: 0,
      allRuns: 0,
    });
    expect(held?.gate).toMatchObject({
      reason: "no-member",
      title: "No Researcher is on",
    });
    expect(held?.waiting?.id).toBe("q");
    // With it on, nothing holds.
    expect(
      crewHoldGate({
        crew: withCard(
          crew({
            members: [
              { id: "builder", role: "builder" },
              { id: "researcher", role: "researcher" },
            ],
          }),
          question,
        ),
        now: NOON,
        weeklyUsed: 40,
        fixerRuns: 0,
        allRuns: 0,
      }),
    ).toBeNull();
  });
});
