// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTeamSetup, turnOnCrew, updateCrewMember } from "./crewActions";
import { ideaWaits, ideasToBuild, nextIdeaToBuild } from "./crewLimits";
import { crewIdeaInfo } from "./crewView";
import {
  crewCard,
  getCrew,
  newCrew,
  resetCrewsCache,
  updateCrew,
} from "./crews";
import {
  featureBoardState,
  memoryFeatureCardBackend,
  setFeatureCardBackend,
} from "./featureCards";
import { resetProjectBotsCache } from "./projectBots";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

const PATH = "/Users/me/Pom";
const NOON = new Date(2026, 9, 29, 12, 0).getTime();
const MODELS = {
  builder: { harness: "claude" as const, model: "claude:opus" },
  checker: { harness: "codex" as const, model: "codex:gpt" },
  scout: { harness: "claude" as const, model: "claude:haiku" },
  researcher: { harness: "claude" as const, model: "claude:opus" },
  designer: { harness: "claude" as const, model: "claude:opus" },
};
const DRAFT = {
  description: "An ADHD-friendly planner.\nOne screen.",
  teammates: [
    { role: "builder" as const, job: "Builds each card in a copy of Pom" },
    { role: "checker" as const, job: "Checks every build before you see it" },
    { role: "researcher" as const, job: "Reads up on ADHD planning" },
  ],
  ideas: [
    { title: "Make the today list hold five things", source: "you" as const },
    { title: "Timer: a ring that fills", source: "setup" as const },
    {
      title: "What helps people with ADHD plan a day?",
      source: "researcher" as const,
    },
    { title: "   ", source: "you" as const },
  ],
};
const turnOnNow = async () => {
  turnOnCrew(PATH, MODELS, NOON);
  return null;
};

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  setFeatureCardBackend(memoryFeatureCardBackend());
  resetProjectBotsCache();
  resetCrewsCache();
  updateCrew(PATH, (crew) => ({ ...newCrew(PATH, 1), ...crew, on: false }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  setFeatureCardBackend(null);
  resetProjectBotsCache();
  resetCrewsCache();
});

describe("Start team from the setup sheet", () => {
  it("makes the team you chose, keeps your words as its about, turns it on, and puts the first ideas on the Board", async () => {
    const turnOn = vi.fn(turnOnNow);
    expect(await startTeamSetup(PATH, DRAFT, turnOn, MODELS, NOON)).toEqual({
      on: true,
      problem: null,
    });
    expect(turnOn).toHaveBeenCalledTimes(1);
    const crew = getCrew(PATH)!;
    expect(crew.on).toBe(true);
    expect(
      crew.members.map((member) => [member.role, member.preset, member.job]),
    ).toEqual([
      ["lead", undefined, undefined],
      ["builder", "builder", "Builds each card in a copy of Pom"],
      ["checker", "checker", undefined],
      ["researcher", "researcher", "Reads up on ADHD planning"],
    ]);
    // Its ready-made settings come along; the Builder runs on the usual pick.
    expect(
      crew.members.find((member) => member.role === "builder")!.instructions,
    ).toContain("Keep each change small");
    expect(
      crew.members.find((member) => member.role === "builder"),
    ).toMatchObject({
      harness: "claude",
      model: "claude:opus",
    });
    // Your description, whole, as the team's about: no note, no feed noise.
    expect(crew.about).toBe("An ADHD-friendly planner.\nOne screen.");
    expect(crew.notes).toEqual([]);
    const board = featureBoardState(PATH).cards;
    expect(board.map((card) => [card.title, card.column])).toEqual([
      ["Make the today list hold five things", "idea"],
      ["Timer: a ring that fills", "idea"],
      ["What helps people with ADHD plan a day?", "building"],
    ]);
    const [yours, suggested, question] = board;
    // Your own idea builds by itself in its turn; Aven's waits for you.
    expect(crew.ideas?.[yours!.id]).toBeUndefined();
    expect(ideaWaits(crew, yours!, NOON)).toBeNull();
    expect(crew.ideas?.[suggested!.id]).toMatchObject({
      by: "setup",
      outside: true,
    });
    expect(ideaWaits(crew, suggested!, NOON)).toBe("setup");
    expect(
      crewIdeaInfo(crew.ideas?.[suggested!.id], "Scout", "Security", {
        waits: "setup",
      }),
    ).toMatchObject({ roles: [], line: "From setup · waits for you" });
    // The question went to the Researcher, as its idea, quoted as data.
    expect(crewCard(crew, question!.id)).toMatchObject({
      kind: "research",
      stage: "queued",
      from: "setup",
    });
  });

  it("marks every suggestion before the team is on, so no tick can start one as yours", async () => {
    // A runner tick, as it would run between adding and turning on: only
    // your own idea could build, and nothing builds while the team is off.
    const turnOn = vi.fn(async () => {
      const crew = getCrew(PATH)!;
      const cards = featureBoardState(PATH).cards;
      expect(crew.on).toBe(false);
      expect(cards).toHaveLength(3);
      expect(crew.ideas?.[cards[1]!.id]).toMatchObject({ by: "setup" });
      // The question is the Researcher's card already, in Building: never
      // an idea at all.
      expect(cards[2]!.column).toBe("building");
      expect(crewCard(crew, cards[2]!.id)).toMatchObject({
        kind: "research",
        stage: "queued",
      });
      expect(ideasToBuild(crew, cards, NOON).map((card) => card.title)).toEqual(
        ["Make the today list hold five things"],
      );
      // With the question queued, the team isn't idle: nothing starts by
      // itself until the Researcher has read it.
      expect(nextIdeaToBuild(crew, cards, NOON)).toBeNull();
      return turnOnNow();
    });
    expect(await startTeamSetup(PATH, DRAFT, turnOn, MODELS, NOON)).toEqual({
      on: true,
      problem: null,
    });
    expect(turnOn).toHaveBeenCalledTimes(1);
  });

  it("undoes everything when turn-on refuses, so Start again starts clean", async () => {
    const before = getCrew(PATH)!;
    const refused = await startTeamSetup(
      PATH,
      DRAFT,
      async () => "Teams need a Git project.",
      MODELS,
      NOON,
    );
    expect(refused).toEqual({
      on: false,
      problem: "Teams need a Git project.",
    });
    const after = getCrew(PATH)!;
    expect(after.on).toBe(false);
    expect(after.members).toEqual(before.members);
    expect(after.about).toBeUndefined();
    expect(after.notes).toEqual([]);
    expect(after.ideas ?? {}).toEqual({});
    expect(featureBoardState(PATH).cards).toEqual([]);
    // Pressed again, it goes, once: one about, one of each idea.
    expect(await startTeamSetup(PATH, DRAFT, turnOnNow, MODELS, NOON)).toEqual({
      on: true,
      problem: null,
    });
    expect(getCrew(PATH)!.about).toBe("An ADHD-friendly planner.\nOne screen.");
    expect(getCrew(PATH)!.notes).toEqual([]);
    expect(featureBoardState(PATH).cards).toHaveLength(3);
  });

  it("keeps a long description whole", async () => {
    const long = "x".repeat(1_900);
    await startTeamSetup(
      PATH,
      { ...DRAFT, description: long, ideas: [] },
      turnOnNow,
      MODELS,
      NOON,
    );
    expect(getCrew(PATH)!.about).toBe(long);
    expect(getCrew(PATH)!.about!.length).toBe(1_900);
  });

  it("keeps a question the Researcher's even when it goes off as the team starts", async () => {
    const result = await startTeamSetup(
      PATH,
      DRAFT,
      async () => {
        turnOnCrew(PATH, MODELS, NOON);
        // The Researcher went off as the team turned on.
        updateCrewMember(
          PATH,
          getCrew(PATH)!.members.find((m) => m.role === "researcher")!.id,
          { paused: true },
        );
        return null;
      },
      MODELS,
      NOON,
    );
    expect(result).toEqual({ on: true, problem: null });
    // The question was queued for the Researcher before the team turned
    // on: it waits in Building for it, and is never a Builder's.
    const board = featureBoardState(PATH).cards;
    expect(board[2]!.column).toBe("building");
    expect(crewCard(getCrew(PATH)!, board[2]!.id)).toMatchObject({
      kind: "research",
      stage: "queued",
      from: "setup",
    });
    expect(nextIdeaToBuild(getCrew(PATH)!, board, NOON)).toBeNull();
  });

  it("makes a Researcher's question an ordinary waiting idea when the team has no Researcher", async () => {
    const result = await startTeamSetup(
      PATH,
      {
        description: "",
        teammates: [{ role: "builder", job: "" }],
        ideas: [{ title: "What do others do?", source: "researcher" }],
      },
      turnOnNow,
      MODELS,
      NOON,
    );
    expect(result).toEqual({ on: true, problem: null });
    const crew = getCrew(PATH)!;
    expect(crew.members.map((member) => member.role)).toEqual([
      "lead",
      "builder",
    ]);
    expect(crew.about).toBeUndefined();
    const [card] = featureBoardState(PATH).cards;
    expect(card!.column).toBe("idea");
    expect(crewCard(crew, card!.id)).toBeUndefined();
    expect(ideaWaits(crew, card!, NOON)).toBe("setup");
  });

  it("needs a Builder and a team that hasn't started", async () => {
    expect(
      await startTeamSetup(
        PATH,
        {
          description: "",
          teammates: [{ role: "checker", job: "" }],
          ideas: [],
        },
        async () => null,
        MODELS,
      ),
    ).toEqual({ on: false, problem: "A team needs a Builder." });
    updateCrew(PATH, (crew) => ({ ...crew, on: true, onAt: 1 }));
    expect(
      (
        await startTeamSetup(
          PATH,
          {
            description: "",
            teammates: [{ role: "builder", job: "" }],
            ideas: [],
          },
          async () => null,
          MODELS,
        )
      ).problem,
    ).toBe(
      "This team has started already: add or remove teammates one at a time.",
    );
  });
});
