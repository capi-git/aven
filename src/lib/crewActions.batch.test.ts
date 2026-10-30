// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCrewBatch,
  applyCrewCard,
  crewBatch,
  discardCrewCard,
  dropStackedCard,
  restackCrew,
  reviewCrewBatch,
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
 * The batch on the crew's branch: cards that passed every check, each a
 * commit, applied to your files together (or up to one of them) by exactly
 * the reviewed combined change. Your files never change any other way.
 */

const host = vi.hoisted(() => ({
  range: vi.fn(),
  applyRange: vi.fn(),
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
const C3 = "3".repeat(40);

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
    stacked: { commit, parent },
  };
}

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

describe("the batch on the crew's branch", () => {
  it("lists the stacked cards in order, from where the batch starts", async () => {
    const [timer, settings] = await crewWithBatch();
    const batch = crewBatch(getCrew(PATH))!;
    expect(batch.from).toBe(BASE);
    expect(batch.cards.map((card) => card.id)).toEqual([timer, settings]);
  });

  it("reviews the combined change, and up to one card", async () => {
    const [timer] = await crewWithBatch();
    host.range.mockResolvedValue(range(["a.ts", "b.ts"], "h-all"));
    const review = await reviewCrewBatch(PATH);
    expect(host.range).toHaveBeenLastCalledWith(COPY, BASE, C2);
    expect(review).toMatchObject({ from: BASE, to: C2 });
    await reviewCrewBatch(PATH, timer);
    expect(host.range).toHaveBeenLastCalledWith(COPY, BASE, C1);
  });

  it("Apply all lands exactly the reviewed combined change, and nothing else", async () => {
    const ids = await crewWithBatch();
    host.range.mockResolvedValue(range(["a.ts", "b.ts"], "h-all"));
    host.applyRange.mockResolvedValue(range(["a.ts", "b.ts"], ""));
    expect(await applyCrewBatch(PATH, { hash: "h-all" }, NOW)).toBeNull();
    expect(host.applyRange).toHaveBeenCalledWith(PATH, COPY, BASE, C2, "h-all");
    expect(host.apply).not.toHaveBeenCalled();
    const crew = getCrew(PATH)!;
    expect(ids.map((id) => crewCard(crew, id)!.stage)).toEqual([
      "applied",
      "applied",
    ]);
    // Everything applied: the next card starts from your files again.
    expect(crew.stack).toBeUndefined();
    expect(crew.feed.at(-1)?.text).toBe(
      "Applied 2 cards to your files: Timer screen · Settings page",
    );
    expect(featureBoardState(PATH).cards.map((card) => card.column)).toEqual([
      "shipped",
      "shipped",
    ]);
  });

  it("applies up to a chosen card; the rest stay on the branch from there", async () => {
    const [timer, settings] = await crewWithBatch();
    host.range.mockResolvedValue(range(["a.ts"], "h-one"));
    host.applyRange.mockResolvedValue(range(["a.ts"], ""));
    expect(await applyCrewBatch(PATH, { upTo: timer }, NOW)).toBeNull();
    expect(host.applyRange).toHaveBeenCalledWith(PATH, COPY, BASE, C1, "h-one");
    const crew = getCrew(PATH)!;
    expect(crewCard(crew, timer)!.stage).toBe("applied");
    expect(crewCard(crew, settings)!.stage).toBe("ready");
    expect(crew.stack).toEqual({ base: C1 });
    expect(crewBatch(crew)!.cards.map((card) => card.id)).toEqual([settings]);
    // A stacked card's own Apply is the batch up to it.
    host.range.mockResolvedValue(range(["b.ts"], "h-two"));
    expect(await applyCrewCard(PATH, settings, NOW)).toBeNull();
    expect(host.applyRange).toHaveBeenLastCalledWith(
      PATH,
      COPY,
      C1,
      C2,
      "h-two",
    );
    expect(getCrew(PATH)!.stack).toBeUndefined();
  });

  it("refuses a change that isn't the one you reviewed", async () => {
    const ids = await crewWithBatch();
    host.range.mockResolvedValue(range(["a.ts", "b.ts"], "h-now"));
    expect(await applyCrewBatch(PATH, { hash: "h-seen" }, NOW)).toBe(
      "The crew's branch changed since you looked. Review it again.",
    );
    expect(host.applyRange).not.toHaveBeenCalled();
    expect(crewCard(getCrew(PATH)!, ids[0])!.stage).toBe("ready");
  });

  it("never applies settings or hooks that could run as you", async () => {
    await crewWithBatch();
    host.range.mockResolvedValue(range([".husky/pre-commit", "a.ts"], "h"));
    const why = await applyCrewBatch(PATH, {}, NOW);
    expect(why).toContain("could run commands as you (.husky/pre-commit)");
    expect(host.applyRange).not.toHaveBeenCalled();
  });

  it("changes nothing when your files conflict, and offers to update the branch", async () => {
    const ids = await crewWithBatch();
    host.range.mockResolvedValue(range(["a.ts"], "h"));
    host.applyRange.mockRejectedValue(
      new Error("These changes conflict with edits in your project: a.ts"),
    );
    const why = await applyCrewBatch(PATH, {}, NOW);
    expect(why).toBe(
      "Your files changed where the crew worked, so nothing was applied. Update the crew's branch onto your files, then Apply again.",
    );
    const crew = getCrew(PATH)!;
    expect(crew.stack?.conflict).toBe(why);
    expect(ids.map((id) => crewCard(crew, id)!.stage)).toEqual([
      "ready",
      "ready",
    ]);
  });
});

describe("updating the branch onto your files", () => {
  it("replays every card, each its own commit again", async () => {
    const [timer, settings] = await crewWithBatch();
    host.restack.mockResolvedValue({
      base: C3,
      commits: ["4".repeat(40), "5".repeat(40)],
    });
    expect(await restackCrew(PATH, NOW)).toBeNull();
    expect(host.restack).toHaveBeenCalledWith(PATH, COPY, BRANCH, BASE, [
      C1,
      C2,
    ]);
    const crew = getCrew(PATH)!;
    expect(crew.stack).toEqual({ base: C3 });
    expect(crewCard(crew, timer)!.stacked).toEqual({
      commit: "4".repeat(40),
      parent: C3,
    });
    expect(crewCard(crew, settings)!.stacked).toEqual({
      commit: "5".repeat(40),
      parent: "4".repeat(40),
    });
  });

  it("keeps the branch as it was when a card no longer fits", async () => {
    const [timer] = await crewWithBatch();
    host.restack.mockRejectedValue(
      new Error("Your files changed where the crew worked (card 1 of 2): a.ts"),
    );
    const why = await restackCrew(PATH, NOW);
    expect(why).toContain(
      "Your files changed where the crew worked (card 1 of 2)",
    );
    expect(why).toContain("Nothing was lost");
    const crew = getCrew(PATH)!;
    expect(crew.stack).toMatchObject({ base: BASE, conflict: why });
    expect(crewCard(crew, timer)!.stacked).toEqual({
      commit: C1,
      parent: BASE,
    });
  });

  it("waits while a card builds on top of the branch", async () => {
    await crewWithBatch((cards) => [
      ...cards,
      {
        ...startCard(
          queueCard(
            {
              id: "wip",
              title: "Haptics",
              brief: "x",
              from: "you",
              maxRounds: 3,
            },
            1,
          ),
          2,
        ),
        base: C2,
      },
    ]);
    expect(await restackCrew(PATH, NOW)).toBe(
      "“Haptics” builds on top of the crew's branch. Finish it or throw it away first.",
    );
    expect(host.restack).not.toHaveBeenCalled();
  });
});

describe("taking a card off the branch", () => {
  it("takes the top card off, back to the card before it", async () => {
    const [timer, settings] = await crewWithBatch();
    host.discard.mockResolvedValue(undefined);
    expect(await discardCrewCard(PATH, settings, "ideas", NOW)).toBeNull();
    expect(host.discard).toHaveBeenCalledWith(COPY, C1, BRANCH);
    const crew = getCrew(PATH)!;
    expect(crewCard(crew, settings)!.stage).toBe("discarded");
    expect(crewBatch(crew)!.cards.map((card) => card.id)).toEqual([timer]);
    expect(
      featureBoardState(PATH).cards.find((card) => card.id === settings)
        ?.column,
    ).toBe("idea");
  });

  it("never takes a card off from under another", async () => {
    const [timer] = await crewWithBatch();
    expect(await dropStackedCard(PATH, timer, "ideas", NOW)).toBe(
      "Only the last card on the crew's branch can come off it.",
    );
    expect(host.discard).not.toHaveBeenCalled();
  });

  it("clears the batch when its last card comes off", async () => {
    const [timer, settings] = await crewWithBatch();
    host.discard.mockResolvedValue(undefined);
    await dropStackedCard(PATH, settings, "delete", NOW);
    await dropStackedCard(PATH, timer, "delete", NOW);
    expect(getCrew(PATH)!.stack).toBeUndefined();
    expect(host.discard).toHaveBeenLastCalledWith(COPY, BASE, BRANCH);
  });
});
