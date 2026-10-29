// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CREWS_BACKUP_KEY,
  CREWS_KEY,
  crewsStoreUnreadable,
  CREW_DEFAULT_RUNS_PER_DAY,
  cardInCopy,
  crewForChat,
  crewFromBot,
  crewMembers,
  crewsSnapshot,
  getCrew,
  isCrewChat,
  migrateBotsIntoCrews,
  newCrew,
  queuedCards,
  readCrew,
  resetCrewsCache,
  updateCrew,
  withBotsAsFixers,
  withCard,
  withNote,
  withoutNote,
  type Crew,
} from "./crews";
import { queueCard, startCard } from "./crewLoop";
import {
  PROJECT_BOTS_KEY,
  botChatIds,
  isBotChat,
  isBotCopyPath,
  newProjectBot,
  readProjectBot,
  resetProjectBotsCache,
  type ProjectBot,
} from "./projectBots";

const PROJECT = "/Users/me/aven-site";
const OTHER = "/Users/me/notes-app";

function storedBot(path: string, extra: Partial<ProjectBot> = {}): ProjectBot {
  return {
    ...newProjectBot(path, 1_000),
    on: true,
    onAt: 1_000,
    name: "Jelly",
    sessionId: "bot-chat",
    copy: {
      path: "/data/bots/aven-site-1",
      branch: "aven/bot/jelly-1a2b",
      root: path,
    },
    base: "abc123",
    fixes: [
      {
        id: "fix-1",
        base: "abc123",
        turnId: "turn-1",
        files: 2,
        additions: 14,
        deletions: 3,
        paths: ["src/a.ts", "src/b.ts"],
        at: 2_000,
        hash: "h1",
        state: "ready",
      },
    ],
    runs: { day: "2026-10-29", count: 4 },
    ...extra,
  };
}

function writeBots(bots: Record<string, ProjectBot>) {
  localStorage.setItem(PROJECT_BOTS_KEY, JSON.stringify({ version: 1, bots }));
}

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
  resetProjectBotsCache();
  resetCrewsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProjectBotsCache();
  resetCrewsCache();
});

describe("migrating project bots into crews", () => {
  it("makes each bot its project's crew's Fixer, leaving the bot as it was", () => {
    const bot = storedBot(PROJECT);
    writeBots({ [PROJECT]: bot });
    const before = localStorage.getItem(PROJECT_BOTS_KEY);

    const crew = getCrew(PROJECT)!;
    expect(crew.on).toBe(false);
    expect(crewMembers(crew).map((member) => member.role)).toEqual([
      "builder",
      "checker",
      "scout",
      "fixer",
    ]);

    expect(migrateBotsIntoCrews()).toBe(true);
    // Saved once; a second run changes nothing.
    expect(migrateBotsIntoCrews()).toBe(false);
    const saved = JSON.parse(localStorage.getItem(CREWS_KEY)!);
    expect(Object.keys(saved.crews)).toHaveLength(1);
    expect(saved.crews[Object.keys(saved.crews)[0]].members).toContainEqual({
      role: "fixer",
    });
    // The bot's own store is untouched: its fix, runs, chat and copy stay.
    expect(localStorage.getItem(PROJECT_BOTS_KEY)).toBe(before);
    const reread = readProjectBot(
      JSON.parse(localStorage.getItem(PROJECT_BOTS_KEY)!).bots[PROJECT],
    )!;
    expect(reread.fixes?.[0]).toMatchObject({ id: "fix-1", state: "ready" });
    expect(reread.sessionId).toBe("bot-chat");
    expect(reread.copy?.path).toBe("/data/bots/aven-site-1");
  });

  it("migrates bots that are off too, and gives a crew without a Fixer one", () => {
    const off = storedBot(OTHER, { on: false, sessionId: undefined });
    const crews = {
      [PROJECT]: newCrew(PROJECT, 5),
    };
    const merged = withBotsAsFixers(crews, {
      [PROJECT]: storedBot(PROJECT),
      [OTHER]: off,
    });
    expect(merged[PROJECT].members.map((member) => member.role)).toContain(
      "fixer",
    );
    expect(merged[OTHER]).toEqual(crewFromBot(off));
    // Nothing to do: the same object back.
    expect(withBotsAsFixers(merged, { [PROJECT]: storedBot(PROJECT) })).toBe(
      merged,
    );
  });

  it("keeps a crew's own state through a migration", () => {
    updateCrew(PROJECT, (crew) => withNote(crew, "Use pnpm, not npm.", 10));
    writeBots({ [PROJECT]: storedBot(PROJECT) });
    resetProjectBotsCache();
    migrateBotsIntoCrews();
    const crew = getCrew(PROJECT)!;
    expect(crew.notes.map((note) => note.text)).toEqual(["Use pnpm, not npm."]);
    expect(
      crew.members.filter((member) => member.role === "fixer"),
    ).toHaveLength(1);
  });

  it("reads hand-edited or partial crews instead of failing", () => {
    expect(readCrew(null)).toBeNull();
    expect(readCrew({ path: "" })).toBeNull();
    const crew = readCrew({
      path: PROJECT,
      on: true,
      members: [{ role: "builder" }, { role: "builder" }, { role: "nope" }],
      limits: { runsPerDay: 9_999, roundsPerCard: 0 },
      cards: [{ id: "x", title: "Card", stage: "flying" }],
    })!;
    expect(crew.members).toEqual([{ role: "builder" }]);
    expect(crew.limits.runsPerDay).toBe(200);
    expect(crew.limits.roundsPerCard).toBe(1);
    expect(crew.cards).toEqual([]);
    expect(newCrew(PROJECT).limits.runsPerDay).toBe(CREW_DEFAULT_RUNS_PER_DAY);
  });

  it("keeps members of roles a later build adds when it saves", () => {
    localStorage.setItem(
      CREWS_KEY,
      JSON.stringify({
        version: 1,
        crews: {
          [PROJECT]: {
            path: PROJECT,
            members: [
              { role: "builder" },
              { role: "keeper", name: "Hedgehog" },
            ],
          },
        },
      }),
    );
    resetCrewsCache();
    expect(getCrew(PROJECT)!.members).toEqual([{ role: "builder" }]);
    updateCrew(PROJECT, (crew) => ({ ...crew, on: true }));
    const saved = JSON.parse(localStorage.getItem(CREWS_KEY)!);
    expect(Object.values(saved.crews)[0]).toMatchObject({
      on: true,
      members: [{ role: "builder" }, { role: "keeper", name: "Hedgehog" }],
    });
  });

  it("never overwrites a store from another version, and keeps a backup", () => {
    const later = JSON.stringify({ version: 2, crews: { x: { path: "/x" } } });
    localStorage.setItem(CREWS_KEY, later);
    resetCrewsCache();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(crewsSnapshot()).toEqual({});
    expect(crewsStoreUnreadable()).toBe(true);
    expect(localStorage.getItem(CREWS_BACKUP_KEY)).toBe(later);
    updateCrew(PROJECT, (crew) => ({ ...crew, on: true }));
    migrateBotsIntoCrews();
    // The other version's crews stay exactly as they were.
    expect(localStorage.getItem(CREWS_KEY)).toBe(later);
    // A broken store is kept too, and its first backup never replaced.
    localStorage.setItem(CREWS_KEY, "{not json");
    resetCrewsCache();
    updateCrew(PROJECT, (crew) => ({ ...crew, on: true }));
    expect(localStorage.getItem(CREWS_KEY)).toBe("{not json");
    expect(localStorage.getItem(CREWS_BACKUP_KEY)).toBe(later);
    vi.restoreAllMocks();
  });

  it("keeps crews this build can't read when it saves", () => {
    localStorage.setItem(
      CREWS_KEY,
      JSON.stringify({ version: 1, crews: { future: { kind: "overview" } } }),
    );
    resetCrewsCache();
    updateCrew(PROJECT, (crew) => ({ ...crew, on: true }));
    const saved = JSON.parse(localStorage.getItem(CREWS_KEY)!);
    expect(saved.crews.future).toEqual({ kind: "overview" });
  });
});

describe("crew chats are bot chats", () => {
  it("lists a crew member's chat with the bots', on or off", () => {
    updateCrew(PROJECT, (crew) => ({
      ...crew,
      on: true,
      members: [
        { role: "builder", sessionId: "builder-chat" },
        { role: "checker", sessionId: "checker-chat" },
      ],
      copy: {
        path: "/data/bots/crew-1",
        branch: "aven/bot/crew-1",
        root: PROJECT,
      },
    }));
    expect(isCrewChat("builder-chat")).toBe(true);
    expect(isBotChat("checker-chat")).toBe(true);
    expect(botChatIds().has("builder-chat")).toBe(true);
    expect(crewForChat("checker-chat")?.member.role).toBe("checker");
    expect(isBotCopyPath("/data/bots/crew-1/src/a.ts")).toBe(true);

    // Off, it is still the crew's chat: never an ordinary one (it refuses
    // to start instead, see crewChatPermissions).
    updateCrew(PROJECT, (crew) => ({ ...crew, on: false }));
    expect(isBotChat("builder-chat")).toBe(true);
    expect(crewForChat("builder-chat")?.crew.on).toBe(false);
  });
});

describe("cards and notes", () => {
  it("holds one card in the copy at a time and queues the rest in order", () => {
    let crew: Crew = newCrew(PROJECT);
    const first = queueCard(
      { id: "a", title: "A", brief: "A", from: "you", maxRounds: 3 },
      1,
    );
    const second = queueCard(
      { id: "b", title: "B", brief: "B", from: "you", maxRounds: 3 },
      2,
    );
    crew = withCard(withCard(crew, second), first);
    expect(queuedCards(crew).map((card) => card.id)).toEqual(["a", "b"]);
    expect(cardInCopy(crew)).toBeUndefined();
    crew = withCard(crew, startCard(first, 3));
    expect(cardInCopy(crew)?.id).toBe("a");
    expect(queuedCards(crew).map((card) => card.id)).toEqual(["b"]);
  });

  it("keeps your notes as standing guidance, and posts them to the feed", () => {
    let crew = withNote(newCrew(PROJECT), "  Use pnpm,\n not npm.  ", 5);
    expect(crew.notes).toHaveLength(1);
    expect(crew.notes[0].text).toBe("Use pnpm, not npm.");
    expect(crew.feed.at(-1)).toMatchObject({ kind: "note", who: "you" });
    expect(withNote(crew, "   ", 6)).toBe(crew);
    crew = withoutNote(crew, crew.notes[0].id);
    expect(crew.notes).toEqual([]);
  });

  it("persists a crew's feed and notes across a reload", () => {
    updateCrew(PROJECT, (crew) => withNote(crew, "Don't touch payments/.", 9));
    resetCrewsCache();
    expect(crewsSnapshot()).not.toEqual({});
    expect(getCrew(PROJECT)!.notes[0].text).toBe("Don't touch payments/.");
    expect(getCrew(PROJECT)!.feed[0].text).toBe("Don't touch payments/.");
  });
});
