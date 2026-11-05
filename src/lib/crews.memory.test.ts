// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setMemberMemory } from "./crewActions";
import {
  CREWS_KEY,
  CREW_MEMORY_MAX,
  getCrew,
  newCrew,
  readCrew,
  resetCrewsCache,
  updateCrew,
  withMemberMemory,
  type Crew,
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

const PROJECT = "/Users/me/aven-site";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetCrewsCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetCrewsCache();
});

describe("a teammate's notes", () => {
  it("load with the member, clipped, and older members load without them", () => {
    const crew = readCrew({
      path: PROJECT,
      members: [
        { id: "builder", role: "builder" },
        {
          id: "checker",
          role: "checker",
          memory: "- Run npm test\n- Theme in src/theme.ts",
          memoryAt: 1_000,
        },
        {
          id: "scout",
          role: "scout",
          memory: "x".repeat(CREW_MEMORY_MAX + 50),
        },
        { id: "security", role: "security", memory: "   ", memoryAt: 5 },
      ],
    })!;
    expect(crew.members[0]).toEqual({ id: "builder", role: "builder" });
    expect(crew.members[1]).toMatchObject({
      memory: "- Run npm test\n- Theme in src/theme.ts",
      memoryAt: 1_000,
    });
    expect(crew.members[2]!.memory!.length).toBe(CREW_MEMORY_MAX);
    // Blank notes are no notes, and their time goes with them.
    expect(crew.members[3]).toEqual({ id: "security", role: "security" });
  });

  it("save with the crew under its key, and come back", () => {
    updateCrew(PROJECT, (crew) => ({
      ...crew,
      members: [{ id: "builder", role: "builder" }],
    }));
    updateCrew(PROJECT, (crew) =>
      withMemberMemory(crew, "builder", "- Lint: npm run lint\r\n- Node 22", 7),
    );
    const saved = JSON.parse(localStorage.getItem(CREWS_KEY)!);
    expect(Object.values(saved.crews)[0]).toMatchObject({
      members: [
        {
          id: "builder",
          memory: "- Lint: npm run lint\n- Node 22",
          memoryAt: 7,
        },
      ],
    });
    resetCrewsCache();
    expect(getCrew(PROJECT)!.members[0]).toMatchObject({
      memory: "- Lint: npm run lint\n- Node 22",
      memoryAt: 7,
    });
  });

  it("are each member's own: replacing or clearing one leaves the others", () => {
    let crew: Crew = {
      ...newCrew(PROJECT, 1),
      members: [
        { id: "builder", role: "builder" as const, memory: "b", memoryAt: 1 },
        { id: "checker", role: "checker" as const, memory: "c", memoryAt: 1 },
      ],
    };
    crew = withMemberMemory(crew, "builder", "b2", 2);
    expect(crew.members[0]).toMatchObject({ memory: "b2", memoryAt: 2 });
    expect(crew.members[1]).toMatchObject({ memory: "c", memoryAt: 1 });
    crew = withMemberMemory(crew, "checker", null, 3);
    expect(crew.members[1]).toEqual({ id: "checker", role: "checker" });
    expect(withMemberMemory(crew, "checker", "  ", 4).members[1]).toEqual({
      id: "checker",
      role: "checker",
    });
    expect(crew.members[0]).toMatchObject({ memory: "b2" });
  });

  it("can be set or cleared by you, for the Fixer too", () => {
    updateCrew(PROJECT, (crew) => ({
      ...crew,
      members: [
        { id: "builder", role: "builder" },
        { id: "fixer", role: "fixer" },
      ],
    }));
    expect(setMemberMemory(PROJECT, "fixer", "- Dev server on :5173", 9)).toBe(
      null,
    );
    expect(getCrew(PROJECT)!.members[1]).toMatchObject({
      memory: "- Dev server on :5173",
      memoryAt: 9,
    });
    expect(setMemberMemory(PROJECT, "fixer", null, 10)).toBeNull();
    expect(getCrew(PROJECT)!.members[1]).toEqual({
      id: "fixer",
      role: "fixer",
    });
    expect(setMemberMemory(PROJECT, "nobody", "x")).toBe(
      "That helper isn't with Avos any more.",
    );
  });
});
