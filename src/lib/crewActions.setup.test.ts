// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTeamSetup, turnOnCrew } from "./crewActions";
import { ideaWaits } from "./crewLimits";
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
  it("makes the team you chose, keeps your words as a note, turns it on, then puts the first ideas on the Board", async () => {
    const turnOn = vi.fn(async () => {
      turnOnCrew(PATH, MODELS, NOON);
      return null;
    });
    const why = await startTeamSetup(
      PATH,
      {
        description: "An ADHD-friendly planner.\nOne screen.",
        teammates: [
          { role: "builder", job: "Builds each card in a copy of Pom" },
          { role: "researcher", job: "Reads up on ADHD planning" },
          { role: "checker", job: "Checks every build before you see it" },
        ],
        ideas: [
          { title: "Make the today list hold five things", source: "you" },
          { title: "Timer: a ring that fills", source: "setup" },
          {
            title: "What helps people with ADHD plan a day?",
            source: "researcher",
          },
          { title: "   ", source: "you" },
        ],
      },
      turnOn,
      MODELS,
      NOON,
    );
    expect(why).toBeNull();
    expect(turnOn).toHaveBeenCalledTimes(1);
    const crew = getCrew(PATH)!;
    expect(crew.on).toBe(true);
    expect(
      crew.members.map((member) => [member.role, member.preset, member.job]),
    ).toEqual([
      ["builder", "builder", "Builds each card in a copy of Pom"],
      ["checker", "checker", undefined],
      ["researcher", "researcher", "Reads up on ADHD planning"],
    ]);
    // Its ready-made settings come along; the Builder runs on the usual pick.
    expect(crew.members[0]!.instructions).toContain("Keep each change small");
    expect(crew.members[0]).toMatchObject({
      harness: "claude",
      model: "claude:opus",
    });
    expect(crew.notes.map((note) => note.text)).toEqual([
      "About this project: An ADHD-friendly planner. One screen.",
    ]);
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

  it("makes a Researcher's question an ordinary waiting idea when the team has no Researcher", async () => {
    const why = await startTeamSetup(
      PATH,
      {
        description: "",
        teammates: [{ role: "builder", job: "" }],
        ideas: [{ title: "What do others do?", source: "researcher" }],
      },
      async () => {
        turnOnCrew(PATH, MODELS, NOON);
        return null;
      },
      MODELS,
      NOON,
    );
    expect(why).toBeNull();
    const crew = getCrew(PATH)!;
    expect(crew.members.map((member) => member.role)).toEqual(["builder"]);
    expect(crew.notes).toEqual([]);
    const [card] = featureBoardState(PATH).cards;
    expect(card!.column).toBe("idea");
    expect(crewCard(crew, card!.id)).toBeUndefined();
    expect(ideaWaits(crew, card!, NOON)).toBe("setup");
  });

  it("needs a Builder, a team that hasn't started, and a turn-on that went", async () => {
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
    ).toBe("A team needs a Builder.");
    const refused = await startTeamSetup(
      PATH,
      {
        description: "x",
        teammates: [{ role: "builder", job: "" }],
        ideas: [{ title: "Idea", source: "you" }],
      },
      async () => "Teams need a Git project.",
      MODELS,
    );
    expect(refused).toBe("Teams need a Git project.");
    // Nothing went on the Board, and the team is still off.
    expect(featureBoardState(PATH).cards).toEqual([]);
    expect(getCrew(PATH)!.on).toBe(false);
    updateCrew(PATH, (crew) => ({ ...crew, on: true, onAt: 1 }));
    expect(
      await startTeamSetup(
        PATH,
        {
          description: "",
          teammates: [{ role: "builder", job: "" }],
          ideas: [],
        },
        async () => null,
        MODELS,
      ),
    ).toBe(
      "This team has started already: add or remove teammates one at a time.",
    );
  });
});
