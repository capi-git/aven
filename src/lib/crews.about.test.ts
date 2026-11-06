// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queueCard, startCard } from "./crewLoop";
import { builderMessage, scoutMessage } from "./crewPrompts";
import {
  CREWS_KEY,
  CREW_ABOUT_MAX,
  getCrew,
  readCrew,
  resetCrewsCache,
  updateCrew,
} from "./crews";

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

const PROJECT = "/Users/me/Pom";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetCrewsCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetCrewsCache();
});

describe("what the team is about", () => {
  it("is kept whole up to its limit and saved with the crew", () => {
    const long = "y".repeat(CREW_ABOUT_MAX + 100);
    updateCrew(PROJECT, (crew) => ({ ...crew, about: "A planner." }));
    const saved = JSON.parse(localStorage.getItem(CREWS_KEY)!);
    expect(Object.values(saved.crews)[0]).toMatchObject({
      about: "A planner.",
    });
    resetCrewsCache();
    expect(getCrew(PROJECT)!.about).toBe("A planner.");
    expect(readCrew({ path: PROJECT, about: long })!.about!.length).toBe(
      CREW_ABOUT_MAX,
    );
    expect(readCrew({ path: PROJECT, about: 42 })!.about).toBeUndefined();
  });

  it("opens every turn, as the user's own words, only when there is one", () => {
    const card = startCard(
      queueCard(
        { id: "c", title: "Dark mode", brief: "x", from: "you", maxRounds: 3 },
        1,
      ),
      2,
    );
    const names = { builder: "Beetle", checker: "Owl" };
    const heading = "What this project is, and what the user wants";
    expect(
      builderMessage({ card, notes: [], names, about: "An ADHD planner." }),
    ).toContain(`${heading}, in their own words:\nAn ADHD planner.`);
    expect(
      scoutMessage({
        notes: [],
        boardTitles: [],
        ideasLeft: 1,
        about: "An ADHD planner.",
      }),
    ).toContain("An ADHD planner.");
    expect(builderMessage({ card, notes: [], names })).not.toContain(heading);
    expect(
      builderMessage({ card, notes: [], names, about: "  " }),
    ).not.toContain(heading);
  });
});
