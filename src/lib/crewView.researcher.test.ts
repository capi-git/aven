import { describe, expect, it } from "vitest";
import { afterResearch, queueCard, startCard } from "./crewLoop";
import {
  crewBoardColumns,
  crewBoardInfo,
  crewCardMenu,
  crewIdeaInfo,
  findingsLine,
  sourcesText,
  type CrewBoardInfo,
} from "./crewView";
import { newCrew, withCard, withIdea, type Crew, type CrewCard } from "./crews";

const names = { builder: "Beetle", checker: "Owl", researcher: "Lens" };

/** A Board card as the columns take it. */
type Placed = {
  id: string;
  column: "idea" | "building" | "review" | "shipped";
  crew?: CrewBoardInfo;
};
const placed = (id: string, column: Placed["column"]): Placed => ({
  id,
  column,
});

function reading(): CrewCard {
  return {
    ...startCard(
      queueCard(
        {
          id: "q",
          title: "How do others debounce search?",
          brief: "q",
          from: "you",
          kind: "research",
          maxRounds: 1,
        },
        1,
      ),
      2,
    ),
    turn: { role: "researcher", sessionId: "r-chat", turnId: "t1", sentAt: 2 },
  };
}

function found(): CrewCard {
  return afterResearch(reading(), {
    findings: {
      summary: "About 200 ms.",
      findings: [
        { text: "React suggests useDeferredValue", source: "https://x.test" },
        { text: "Ours fires every keystroke", source: "project file" },
        { text: "No source" },
      ],
      ideas: ["Debounce the search box", "Show a spinner"],
      sources: 4,
    },
    edited: false,
    now: 3,
  }).card;
}

describe("a research card on the Board", () => {
  it("waits as Up next for the Researcher, then reads in Building", () => {
    const queued = queueCard(
      {
        id: "q",
        title: "Q",
        brief: "q",
        from: "you",
        kind: "research",
        maxRounds: 1,
      },
      1,
    );
    expect(crewBoardInfo(queued, names)).toMatchObject({
      column: "building",
      roles: ["researcher"],
      label: "Up next",
      detail: "Lens",
      actions: [],
    });
    const info = crewBoardInfo(reading(), names, {
      researcher: { id: "researcher", critter: "researcher" },
      holderId: "researcher",
    });
    expect(info).toMatchObject({
      column: "building",
      label: "Reading",
      detail: "Lens",
      holder: "researcher",
      holderId: "researcher",
      sessionId: "r-chat",
      since: 2,
      members: [
        { id: "researcher", role: "researcher", critter: "researcher" },
      ],
      actions: [],
    });
    expect(crewCardMenu(reading()).map((action) => action.id)).toEqual([
      "pause",
      "stop",
    ]);
  });

  it("lands in Ready for you as Findings, with Read and Add ideas, never Apply", () => {
    const info = crewBoardInfo(found(), names);
    expect(info).toMatchObject({
      column: "review",
      label: "Findings",
      detail: "3 findings · 2 ideas proposed",
    });
    expect(info.actions).toEqual([
      { id: "read", label: "Read" },
      { id: "add-ideas", label: "Add 2 ideas", primary: true },
    ]);
    expect(info.actions.map((action) => action.id)).not.toContain("apply");
    expect(crewCardMenu(found()).map((action) => action.id)).toEqual([
      "back-to-ideas",
      "throw-away",
    ]);
    // Nothing proposed: only Read.
    const bare = {
      ...found(),
      findings: { ...found().findings!, ideas: [] },
    };
    expect(crewBoardInfo(bare, names).actions).toEqual([
      { id: "read", label: "Read" },
    ]);
  });

  it("stops with why, and Try again, when its turn didn't finish or it changed files", () => {
    const failed = afterResearch(reading(), {
      findings: null,
      edited: false,
      now: 3,
      name: "Lens",
    });
    expect(failed.card).toMatchObject({
      stage: "stuck",
      stuck: {
        reason: "no-verdict",
        text: "Lens's turn ended without findings",
      },
    });
    const edited = afterResearch(reading(), {
      findings: { summary: "s", findings: [], ideas: [], sources: 0 },
      edited: true,
      now: 3,
      name: "Lens",
    });
    expect(edited.card.stuck?.text).toBe(
      "Lens changed files while reading, so its findings weren't used",
    );
    expect(edited.card.findings).toBeUndefined();
    const info = crewBoardInfo(failed.card, names);
    expect(info).toMatchObject({ needsYou: true, label: "Needs you" });
    expect(info.actions).toEqual([
      { id: "more", label: "Try again", primary: true },
      { id: "throw-away", label: "Throw away" },
    ]);
    expect(crewCardMenu(failed.card).map((action) => action.id)).toEqual([
      "back-to-ideas",
    ]);
  });

  it("stays readable from Done as Read, saying what was added", () => {
    const done: CrewCard = {
      ...found(),
      stage: "applied",
      findings: { ...found().findings!, added: 1 },
    };
    const info = crewBoardInfo(done, names);
    expect(info).toMatchObject({
      column: "shipped",
      label: "Read",
      detail: "3 findings · 1 idea added",
      actions: [{ id: "read", label: "Findings" }],
    });
    expect(findingsLine({ ...done.findings!, added: 0 }, true)).toBe(
      "3 findings · read",
    );
    expect(sourcesText(1)).toBe("1 source");
    expect(sourcesText(0)).toBe("no sources");
    const crew: Crew = withCard(
      {
        ...newCrew("/p", 1),
        on: true,
        members: [{ id: "r", role: "researcher" }],
      },
      done,
    );
    const columns = crewBoardColumns(
      {
        idea: [],
        building: [],
        review: [],
        shipped: [placed("q", "shipped")],
      },
      crew,
      { builder: "Beetle", checker: "Owl", scout: "Fox" },
      (who) => (who === "r" ? "Lens" : who),
    );
    expect(columns.shipped[0]?.crew).toMatchObject({
      label: "Read",
      detail: "3 findings · 1 idea added",
    });
  });
});

describe("the Researcher's ideas, and asking it", () => {
  it("shows whose an idea is, and that it waits for you", () => {
    const info = crewIdeaInfo(
      { at: 1, size: "medium", by: "researcher", outside: true },
      "Fox",
      "Security",
      { waits: "researcher", researcher: "Lens" },
    );
    expect(info).toMatchObject({
      roles: ["researcher"],
      line: "From Lens · Waits for you",
      actions: [{ id: "give", label: "Build it", primary: true }],
    });
    expect(info.menu?.map((action) => action.label)).toEqual([
      "Ask Lens",
      "Not now",
    ]);
  });

  it("offers Ask Researcher on every idea while a Researcher is on, and not otherwise", () => {
    const crew: Crew = {
      ...newCrew("/p", 1),
      on: true,
      members: [
        { id: "builder", role: "builder" },
        { id: "r", role: "researcher" },
      ],
    };
    const columns = crewBoardColumns(
      {
        idea: [placed("a", "idea")],
        building: [],
        review: [],
        shipped: [],
      },
      withIdea(crew, "a", { at: 1, size: "small" }),
      { builder: "Beetle", checker: "Owl", scout: "Fox" },
      (who) => (who === "r" ? "Lens" : who),
    );
    expect(columns.idea[0]?.crew?.menu?.map((action) => action.id)).toEqual([
      "give",
      "research",
      "not-now",
    ]);
    const without = crewBoardColumns(
      {
        idea: [placed("a", "idea")],
        building: [],
        review: [],
        shipped: [],
      },
      { ...crew, members: [{ id: "builder", role: "builder" }] },
      { builder: "Beetle", checker: "Owl", scout: "Fox" },
    );
    expect(without.idea[0]?.crew?.menu?.map((action) => action.id)).toEqual([
      "give",
      "not-now",
    ]);
    // Off, it isn't offered either.
    const off = crewBoardColumns(
      {
        idea: [placed("a", "idea")],
        building: [],
        review: [],
        shipped: [],
      },
      {
        ...crew,
        members: [
          { id: "builder", role: "builder" },
          { id: "r", role: "researcher", paused: true },
        ],
      },
      { builder: "Beetle", checker: "Owl", scout: "Fox" },
    );
    expect(off.idea[0]?.crew?.menu?.map((action) => action.id)).toEqual([
      "give",
      "not-now",
    ]);
  });
});
