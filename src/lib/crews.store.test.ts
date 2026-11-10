// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CREWS_KEY,
  getCrew,
  keptTalks,
  newCrew,
  resetCrewsCache,
  updateCrew,
  withTalk,
  type Crew,
  type CrewTalk,
} from "./crews";

const PROJECT = "/Users/me/aven-site";
const OTHER = "/Users/me/notes-app";

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

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetCrewsCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("saving crews", () => {
  it("writes the same text as before, other versions' crews included", () => {
    localStorage.setItem(
      CREWS_KEY,
      JSON.stringify({
        version: 1,
        crews: { "/old/one": { version: 99, odd: true } },
        allRunsPerDay: 40,
      }),
    );
    resetCrewsCache();
    updateCrew(PROJECT, (crew) => ({ ...crew, on: true }));
    updateCrew(OTHER, (crew) => ({ ...crew, on: false }));
    const raw = localStorage.getItem(CREWS_KEY)!;
    // Exactly what JSON.stringify gives for what it holds.
    expect(raw).toBe(JSON.stringify(JSON.parse(raw)));
    const saved = JSON.parse(raw);
    expect(saved.version).toBe(1);
    expect(saved.allRunsPerDay).toBe(40);
    expect(saved.crews["/old/one"]).toEqual({ version: 99, odd: true });
    expect(Object.keys(saved.crews)).toHaveLength(3);
    resetCrewsCache();
    expect(getCrew(PROJECT)?.on).toBe(true);
  });

  it("doesn't save again when nothing changed", () => {
    updateCrew(PROJECT, (crew) => ({ ...crew, on: true }));
    const save = vi.spyOn(localStorage, "setItem");
    updateCrew(PROJECT, (crew) => ({ ...crew }));
    expect(save).not.toHaveBeenCalled();
    updateCrew(PROJECT, (crew) => ({ ...crew, on: false }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps a crew's text until the crew changes", () => {
    updateCrew(PROJECT, (crew) => ({ ...crew, on: true }));
    updateCrew(OTHER, (crew) => ({ ...crew, on: true }));
    const stringify = vi.spyOn(JSON, "stringify");
    updateCrew(OTHER, (crew) => ({ ...crew, on: false }));
    // The changed crew, and keys: never the whole store at once.
    const whole = stringify.mock.calls.filter(
      ([value]) =>
        !!value && typeof value === "object" && "crews" in (value as object),
    );
    expect(whole).toHaveLength(0);
    const crews = stringify.mock.calls.filter(
      ([value]) =>
        !!value && typeof value === "object" && "members" in (value as object),
    );
    expect(crews).toHaveLength(1);
  });

  it("picks up another window's change", () => {
    updateCrew(PROJECT, (crew) => ({ ...crew, on: false }));
    const saved = JSON.parse(localStorage.getItem(CREWS_KEY)!);
    const key = Object.keys(saved.crews)[0]!;
    saved.crews[key] = { ...saved.crews[key], on: true };
    localStorage.setItem(CREWS_KEY, JSON.stringify(saved));
    expect(getCrew(PROJECT)?.on).toBe(true);
  });
});

describe("messages kept", () => {
  const talk = (index: number, sent: boolean): CrewTalk => ({
    id: `talk-${index}`,
    at: index,
    from: "lead",
    to: "checker",
    text: `Message ${index}`,
    hop: 1,
    ...(sent
      ? {
          sent: {
            at: index,
            owner: "me",
            turnId: `turn-${index}`,
            sessionId: "chat",
          },
        }
      : {}),
  });

  it("never drops a message that hasn't gone yet to make room", () => {
    let crew: Crew = newCrew(PROJECT, 1);
    for (let index = 0; index < 40; index += 1)
      crew = withTalk(crew, talk(index, false));
    expect(crew.talks).toHaveLength(40);
    expect(crew.talks![0]!.id).toBe("talk-0");
  });

  it("drops the oldest sent ones first", () => {
    const talks = [
      ...Array.from({ length: 35 }, (_, index) => talk(index, true)),
      talk(35, false),
    ];
    const kept = keptTalks(talks);
    expect(kept).toHaveLength(30);
    expect(kept.some((entry) => entry.id === "talk-35")).toBe(true);
    expect(kept[0]!.id).toBe("talk-6");
  });

  it("keeps them as stored, the same way", () => {
    let crew: Crew = { ...newCrew(PROJECT, 1), on: true };
    for (let index = 0; index < 40; index += 1)
      crew = withTalk(crew, talk(index, false));
    updateCrew(PROJECT, () => crew);
    resetCrewsCache();
    expect(getCrew(PROJECT)!.talks).toHaveLength(40);
  });
});
