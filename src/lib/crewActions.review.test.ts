// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askAvosForChanges,
  crewBatch,
  openCrewBatchPr,
  stopCrewTry,
  tryCrewBatch,
} from "./crewActions";
import { queueCard, startCard } from "./crewLoop";
import {
  crewCard,
  getCrew,
  resetCrewsCache,
  updateCrew,
  withCard,
  type Crew,
  type CrewCard,
} from "./crews";
import {
  addFeatureCards,
  featureBoardState,
  memoryFeatureCardBackend,
  setFeatureCardBackend,
} from "./featureCards";
import { resetProjectBotsCache } from "./projectBots";

/*
 * Avos's Review, beside its chat: the batch sent as a pull request (by Aven,
 * with exactly the reviewed change, never by an agent), and your words
 * asking for changes, which become a card that builds on top of the batch.
 */

const host = vi.hoisted(() => ({
  range: vi.fn(),
  applyRange: vi.fn(),
  publishRange: vi.fn(),
  serve: vi.fn(),
  serveStop: vi.fn(),
  discard: vi.fn(),
  restack: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("./projectBotCopy", async (original) => {
  const actual = await original<typeof import("./projectBotCopy")>();
  return { ...actual, botCopyHost: { ...actual.botCopyHost, ...host } };
});
vi.mock("./fs", () => ({ notifyGitChanged: vi.fn() }));

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

const PATH = "/Users/me/aven-site";
const COPY = "/data/bots/aven-site-crew";
const BRANCH = "aven/bot/crew-1";
const NOW = new Date(2026, 9, 29, 12).getTime();
const BASE = "a".repeat(40);
const C1 = "1".repeat(40);
const C2 = "2".repeat(40);

const range = (paths: string[], hash: string) => ({
  files: paths.map((path) => ({
    path,
    status: "modified",
    additions: 2,
    deletions: 1,
    binary: false,
  })),
  additions: paths.length * 2,
  deletions: paths.length,
  hash,
});

/** A card that passed every check, stacked on `parent` as `commit`. */
function stacked(
  id: string,
  title: string,
  parent: string,
  commit: string,
): CrewCard {
  return {
    ...startCard(
      queueCard({ id, title, brief: title, from: "you", maxRounds: 3 }, 1),
      2,
    ),
    stage: "ready",
    holder: undefined,
    base: parent,
    stacked: { commit, parent, hash: `own-${commit.slice(0, 1)}` },
    inbox: {
      kind: "review",
      title,
      summary: title,
      status: "open",
      postedAt: 3,
    },
  };
}

/** What Apply checks for each card: its commit and its own fingerprint. */
const own = (...commits: string[]) =>
  commits.map((commit) => ({ commit, hash: `own-${commit.slice(0, 1)}` }));

async function crewWithBatch(
  extra: (cards: CrewCard[]) => CrewCard[] = (c) => c,
) {
  const boards = await addFeatureCards(PATH, [
    { title: "Timer screen", column: "review" },
    { title: "Settings page", column: "review" },
  ]);
  const cards = extra([
    stacked(boards[0].id, "Timer screen", BASE, C1),
    stacked(boards[1].id, "Settings page", C1, C2),
  ]);
  updateCrew(PATH, (crew) =>
    cards.reduce<Crew>((next, card) => withCard(next, card), {
      ...crew,
      on: true,
      copy: { path: COPY, branch: BRANCH, root: PATH },
      stack: { base: BASE },
    }),
  );
  return boards.map((board) => board.id);
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  resetCrewsCache();
  setFeatureCardBackend(memoryFeatureCardBackend());
  for (const fn of Object.values(host)) fn.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCrewsCache();
  setFeatureCardBackend(null);
});

describe("sending Avos's work as a pull request", () => {
  it("sends exactly the reviewed change, and the cards leave the branch with its link", async () => {
    const ids = await crewWithBatch();
    host.range.mockResolvedValue(range(["a.ts", "b.ts"], "h-all"));
    host.publishRange.mockResolvedValue("https://github.com/me/site/pull/7");
    expect(await openCrewBatchPr(PATH, { to: C2, hash: "h-all" }, NOW)).toEqual(
      { url: "https://github.com/me/site/pull/7" },
    );
    expect(host.publishRange).toHaveBeenCalledWith(
      PATH,
      COPY,
      BASE,
      C2,
      "h-all",
      own(C1, C2),
      expect.objectContaining({
        title: "Timer screen and 1 more",
        branch: expect.stringMatching(
          /^avos\/timer-screen-and-1-more-[a-z0-9]+$/,
        ),
      }),
    );
    // Nothing lands in your files: no apply ran.
    expect(host.applyRange).not.toHaveBeenCalled();
    const crew = getCrew(PATH)!;
    expect(ids.map((id) => crewCard(crew, id)!.pr)).toEqual([
      "https://github.com/me/site/pull/7",
      "https://github.com/me/site/pull/7",
    ]);
    expect(crewBatch(crew)).toBeNull();
    expect(crew.stack).toBeUndefined();
    expect(crew.feed.at(-1)?.text).toBe(
      "Opened a pull request for 2 cards: Timer screen · Settings page",
    );
    expect(featureBoardState(PATH).cards.map((card) => card.column)).toEqual([
      "shipped",
      "shipped",
    ]);
  });

  it("sends up to a chosen card; the rest stay on the branch", async () => {
    const [timer, settings] = await crewWithBatch();
    host.range.mockResolvedValue(range(["a.ts"], "h-one"));
    host.publishRange.mockResolvedValue("https://github.com/me/site/pull/8");
    await openCrewBatchPr(PATH, { to: C1, hash: "h-one" }, NOW);
    const crew = getCrew(PATH)!;
    expect(crewCard(crew, timer)!.pr).toBe("https://github.com/me/site/pull/8");
    expect(crewCard(crew, settings)!.stage).toBe("ready");
    expect(crew.stack).toEqual({ base: C1 });
  });

  it("refuses a change that isn't the one you reviewed", async () => {
    const ids = await crewWithBatch();
    host.range.mockResolvedValue(range(["a.ts"], "h-now"));
    expect(
      await openCrewBatchPr(PATH, { to: C2, hash: "h-seen" }, NOW),
    ).toEqual({
      error: "Avos's branch changed since you looked. Review it again.",
    });
    expect(host.publishRange).not.toHaveBeenCalled();
    expect(crewCard(getCrew(PATH)!, ids[0])!.stage).toBe("ready");
  });

  it("never sends settings or hooks that could run as you", async () => {
    await crewWithBatch();
    host.range.mockResolvedValue(range([".husky/pre-commit", "a.ts"], "h"));
    const sent = await openCrewBatchPr(PATH, { to: C2, hash: "h" }, NOW);
    expect(sent).toMatchObject({
      error: expect.stringContaining(
        "could run commands as you (.husky/pre-commit)",
      ),
    });
    expect(host.publishRange).not.toHaveBeenCalled();
  });

  it("keeps the cards on the branch when the pull request can't open", async () => {
    const ids = await crewWithBatch();
    host.range.mockResolvedValue(range(["a.ts"], "h"));
    host.publishRange.mockRejectedValue(new Error("No GitHub remote"));
    expect(await openCrewBatchPr(PATH, { to: C2, hash: "h" }, NOW)).toEqual({
      error: "Couldn't open the pull request: No GitHub remote",
    });
    const crew = getCrew(PATH)!;
    expect(ids.map((id) => crewCard(crew, id)!.stage)).toEqual([
      "ready",
      "ready",
    ]);
    expect(crewCard(crew, ids[0])!.pr).toBeUndefined();
  });
});

describe("asking Avos for changes", () => {
  it("makes a card from your words that says what it changes, and keeps your words in the chat", async () => {
    await crewWithBatch();
    expect(
      await askAvosForChanges(
        PATH,
        "Make the Pro plan stand out a bit more",
        ["Timer screen", "Settings page"],
        NOW,
      ),
    ).toBeNull();
    const crew = getCrew(PATH)!;
    const card = crew.cards.find(
      (item) => item.title === "Make the Pro plan stand out a bit more",
    );
    expect(card).toBeDefined();
    expect(card!.brief).toContain(
      "This asks for changes to “Timer screen”, “Settings page”, which wait on Avos's branch for review",
    );
    // Your words, as you wrote them, are your message in the chat.
    expect(crew.messages?.at(-1)?.text).toBe(
      "Make the Pro plan stand out a bit more",
    );
    // The batch itself is untouched: the new card builds on top of it.
    expect(crewBatch(crew)!.cards).toHaveLength(2);
  });
});

describe("trying Avos's work", () => {
  it("runs the copy for exactly the reviewed change, and stops it", async () => {
    await crewWithBatch();
    host.serve.mockResolvedValue({ url: "http://127.0.0.1:5190" });
    host.serveStop.mockResolvedValue(undefined);
    expect(await tryCrewBatch(PATH, { to: C2, hash: "h-all" })).toEqual({
      url: "http://127.0.0.1:5190",
    });
    expect(host.serve).toHaveBeenCalledWith(
      COPY,
      BASE,
      C2,
      "h-all",
      own(C1, C2),
    );
    await stopCrewTry(PATH);
    expect(host.serveStop).toHaveBeenCalledWith(COPY);
  });

  it("says why the copy couldn't run, and isn't asked for a change that isn't there", async () => {
    await crewWithBatch();
    host.serve.mockRejectedValue(
      new Error(
        "Avos is working in its copy. Try it again once that work is checked.",
      ),
    );
    expect(await tryCrewBatch(PATH, { to: C2, hash: "h" })).toEqual({
      error:
        "Avos is working in its copy. Try it again once that work is checked.",
    });
    host.serve.mockClear();
    expect(await tryCrewBatch(PATH, { to: "9".repeat(40), hash: "h" })).toEqual(
      { error: "Avos's branch changed since you looked. Review it again." },
    );
    expect(host.serve).not.toHaveBeenCalled();
  });
});
