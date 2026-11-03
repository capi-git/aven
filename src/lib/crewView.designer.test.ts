import { describe, expect, it } from "vitest";
import { afterMockup, queueCard, startCard } from "./crewLoop";
import {
  crewBoardColumns,
  crewBoardInfo,
  crewCardMenu,
  crewIdeaInfo,
  type CrewBoardInfo,
} from "./crewView";
import { newCrew, withCard, type Crew, type CrewCard } from "./crews";

const names = { builder: "Beetle", checker: "Owl", designer: "Brush" };

function drawing(): CrewCard {
  return {
    ...startCard(
      queueCard(
        {
          id: "m",
          title: "Timer: a ring that fills",
          brief: "m",
          from: "you",
          kind: "mockup",
          maxRounds: 1,
        },
        1,
      ),
      2,
    ),
    turn: { role: "designer", sessionId: "d-chat", turnId: "t1", sentAt: 2 },
  };
}

const drawn = () =>
  afterMockup(drawing(), {
    mockup: {
      file: "/data/bots/mockups/copy/m.html",
      note: "The ring fills",
      bytes: 900,
    },
    now: 3,
  }).card;

describe("a mock-up card on the Board", () => {
  it("waits as Up next for the Designer, then Mocking up with its time", () => {
    const queued = queueCard(
      {
        id: "m",
        title: "T",
        brief: "m",
        from: "you",
        kind: "mockup",
        maxRounds: 1,
      },
      1,
    );
    expect(crewBoardInfo(queued, names)).toMatchObject({
      column: "building",
      roles: ["designer"],
      label: "Up next",
      detail: "Brush",
    });
    expect(
      crewBoardInfo(drawing(), names, {
        designer: { id: "designer", critter: "designer" },
        holderId: "designer",
      }),
    ).toMatchObject({
      column: "building",
      label: "Mocking up",
      detail: "Brush is on it",
      holder: "designer",
      holderId: "designer",
      sessionId: "d-chat",
      since: 2,
      members: [{ id: "designer", role: "designer", critter: "designer" }],
      actions: [],
    });
  });

  it("lands in Ready for you as Mock-up with Look and Build it; Dismiss is in its menu, never Apply", () => {
    const info = crewBoardInfo(drawn(), names);
    expect(info).toMatchObject({
      column: "review",
      label: "Mock-up",
      detail: "Brush",
      line: "The ring fills",
    });
    expect(info.actions).toEqual([
      { id: "look", label: "Look" },
      { id: "build-mockup", label: "Build it", primary: true },
    ]);
    expect(crewCardMenu(drawn()).map((action) => action.id)).toEqual([
      "dismiss-mockup",
      "back-to-ideas",
      "throw-away",
    ]);
  });

  it("stops with Try again when its turn left nothing, and reads Mock-up · built or · dismissed in Done", () => {
    const stuck = afterMockup(drawing(), {
      mockup: null,
      now: 3,
      name: "Brush",
    }).card;
    const info = crewBoardInfo(stuck, names);
    expect(info).toMatchObject({ needsYou: true, label: "Needs you" });
    expect(info.actions[0]).toEqual({
      id: "more",
      label: "Try again",
      primary: true,
    });
    const built: CrewCard = {
      ...drawn(),
      stage: "applied",
      mockup: { ...drawn().mockup!, outcome: "built" },
    };
    expect(crewBoardInfo(built, names)).toMatchObject({
      column: "shipped",
      label: "Mock-up",
      detail: "built",
      actions: [{ id: "look", label: "Look" }],
    });
    const crew: Crew = withCard(
      {
        ...newCrew("/p", 1),
        on: true,
        members: [{ id: "d", role: "designer" }],
      },
      { ...built, mockup: { ...built.mockup!, outcome: "dismissed" } },
    );
    const columns = crewBoardColumns(
      {
        idea: [],
        building: [],
        review: [],
        shipped: [
          { id: "m", column: "shipped" } as {
            id: string;
            column: "shipped";
            crew?: CrewBoardInfo;
          },
        ],
      },
      crew,
      { builder: "Beetle", checker: "Owl", scout: "Fox" },
      (who) => (who === "d" ? "Brush" : who),
    );
    expect(columns.shipped[0]?.crew).toMatchObject({
      label: "Mock-up",
      detail: "dismissed",
    });
  });

  it("offers Ask Designer on an idea while a Designer is on", () => {
    const info = crewIdeaInfo(undefined, "Fox", "Security", {
      researcher: "Lens",
      designer: "Brush",
    });
    expect(info.menu?.map((action) => action.label)).toEqual([
      "Build it next",
      "Ask Lens",
      "Ask Brush",
      "Not now",
    ]);
    expect(
      crewIdeaInfo(undefined, "Fox").menu?.map((action) => action.id),
    ).toEqual(["give", "not-now"]);
  });
});
