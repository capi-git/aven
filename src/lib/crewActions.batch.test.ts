// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REVIEW_FIRST,
  applyCrewBatch,
  applyCrewCard,
  crewBatch,
  discardCrewCard,
  dropStackedCard,
  restackCrew,
  reviewCrewBatch,
} from "./crewActions";
import { openCrewInboxItems } from "./crewInbox";
import { queueCard, startCard } from "./crewLoop";
import {
  claimCrewJob,
  crewCard,
  crewsSnapshot,
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
import { jobIsLive, resetProjectBotsCache } from "./projectBots";

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
    expect(
      await applyCrewBatch(PATH, { to: C2, hash: "h-all" }, NOW),
    ).toBeNull();
    // Each card is checked to be the change its checks passed, too.
    expect(host.applyRange).toHaveBeenCalledWith(
      PATH,
      COPY,
      BASE,
      C2,
      "h-all",
      own(C1, C2),
    );
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
    expect(
      await applyCrewBatch(PATH, { to: C1, hash: "h-one" }, NOW),
    ).toBeNull();
    expect(host.applyRange).toHaveBeenCalledWith(
      PATH,
      COPY,
      BASE,
      C1,
      "h-one",
      own(C1),
    );
    const crew = getCrew(PATH)!;
    expect(crewCard(crew, timer)!.stage).toBe("applied");
    expect(crewCard(crew, settings)!.stage).toBe("ready");
    expect(crew.stack).toEqual({ base: C1 });
    expect(crewBatch(crew)!.cards.map((card) => card.id)).toEqual([settings]);
    host.range.mockResolvedValue(range(["b.ts"], "h-two"));
    expect(
      await applyCrewBatch(PATH, { to: C2, hash: "h-two" }, NOW),
    ).toBeNull();
    expect(host.applyRange).toHaveBeenLastCalledWith(
      PATH,
      COPY,
      C1,
      C2,
      "h-two",
      own(C2),
    );
    expect(getCrew(PATH)!.stack).toBeUndefined();
  });

  it("refuses a change that isn't the one you reviewed", async () => {
    const ids = await crewWithBatch();
    host.range.mockResolvedValue(range(["a.ts", "b.ts"], "h-now"));
    expect(await applyCrewBatch(PATH, { to: C2, hash: "h-seen" }, NOW)).toBe(
      "The crew's branch changed since you looked. Review it again.",
    );
    expect(host.applyRange).not.toHaveBeenCalled();
    expect(crewCard(getCrew(PATH)!, ids[0])!.stage).toBe("ready");
  });

  it("never applies settings or hooks that could run as you", async () => {
    await crewWithBatch();
    host.range.mockResolvedValue(
      range([".husky/pre-commit", ".mcp.j\u017fon", "a.ts"], "h"),
    );
    const why = await applyCrewBatch(PATH, { to: C2, hash: "h" }, NOW);
    // ".mcp.jſon" is ".mcp.json" on a Mac.
    expect(why).toContain(
      "could run commands as you (.husky/pre-commit, .mcp.j\u017fon)",
    );
    expect(host.applyRange).not.toHaveBeenCalled();
  });

  it("changes nothing when your files conflict, and offers to update the branch", async () => {
    const ids = await crewWithBatch();
    host.range.mockResolvedValue(range(["a.ts"], "h"));
    host.applyRange.mockRejectedValue(
      new Error("These changes conflict with edits in your project: a.ts"),
    );
    const why = await applyCrewBatch(PATH, { to: C2, hash: "h" }, NOW);
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

describe("Apply lands only what you saw", () => {
  it("never applies without the last commit and fingerprint you saw", async () => {
    await crewWithBatch();
    host.range.mockResolvedValue(range(["a.ts", "b.ts"], "h-all"));
    // An Apply that can't say what it saw (as the row's and the Inbox's
    // once did) lands nothing.
    for (const shown of [
      {},
      { hash: "h-all" },
      { to: C2 },
      { to: "", hash: "" },
    ])
      expect(await applyCrewBatch(PATH, shown as never, NOW)).toBe(
        REVIEW_FIRST,
      );
    expect(host.applyRange).not.toHaveBeenCalled();
  });

  it("never lands a card that stacked after you looked", async () => {
    const ids = await crewWithBatch();
    const [, , third] = await addFeatureCards(PATH, [
      { title: "Haptics", column: "review" },
    ]).then((cards) => [...ids, cards[0]!.id]);
    // What the row showed: two cards, up to C2. A third stacks before the click.
    updateCrew(PATH, (crew) =>
      withCard(crew, stacked(third!, "Haptics", C2, C3)),
    );
    host.range.mockResolvedValue(range(["a.ts", "b.ts"], "h-two"));
    host.applyRange.mockResolvedValue(range(["a.ts", "b.ts"], ""));
    expect(
      await applyCrewBatch(PATH, { to: C2, hash: "h-two" }, NOW),
    ).toBeNull();
    expect(host.range).toHaveBeenCalledWith(COPY, BASE, C2);
    expect(host.applyRange).toHaveBeenCalledWith(
      PATH,
      COPY,
      BASE,
      C2,
      "h-two",
      own(C1, C2),
    );
    expect(crewCard(getCrew(PATH)!, third!)!.stage).toBe("ready");
  });

  it("sends the Inbox's and a card's own Apply to the batch's Review", async () => {
    const [, settings] = await crewWithBatch();
    const item = openCrewInboxItems(crewsSnapshot())[0]!;
    expect(item.batch).toBe(true);
    expect(await applyCrewCard(item.project, item.card.id, NOW)).toBe(
      REVIEW_FIRST,
    );
    expect(await applyCrewCard(PATH, settings, NOW)).toBe(REVIEW_FIRST);
    expect(host.range).not.toHaveBeenCalled();
    expect(host.applyRange).not.toHaveBeenCalled();
  });

  it("lands a replayed card only from Review", async () => {
    const [timer, settings] = await crewWithBatch();
    updateCrew(PATH, (crew) =>
      withCard(crew, {
        ...crewCard(crew, settings)!,
        stacked: { commit: C2, parent: C1, hash: "replayed", replayed: true },
      }),
    );
    host.range.mockResolvedValue(range(["a.ts", "b.ts"], "h-all"));
    host.applyRange.mockResolvedValue(range(["a.ts", "b.ts"], ""));
    expect(await applyCrewBatch(PATH, { to: C2, hash: "h-all" }, NOW)).toBe(
      REVIEW_FIRST,
    );
    // Up to the card before it, nothing replayed: fine.
    host.range.mockResolvedValue(range(["a.ts"], "h-one"));
    expect(
      await applyCrewBatch(PATH, { to: C1, hash: "h-one" }, NOW),
    ).toBeNull();
    expect(crewCard(getCrew(PATH)!, timer)!.stage).toBe("applied");
    host.range.mockResolvedValue(range(["b.ts"], "h-rest"));
    expect(
      await applyCrewBatch(
        PATH,
        { to: C2, hash: "h-rest", reviewed: true },
        NOW,
      ),
    ).toBeNull();
    expect(host.applyRange).toHaveBeenLastCalledWith(
      PATH,
      COPY,
      C1,
      C2,
      "h-rest",
      [{ commit: C2, hash: "replayed" }],
    );
  });
});

describe("updating the branch onto your files", () => {
  it("replays every card, each its own commit again", async () => {
    const [timer, settings] = await crewWithBatch();
    host.restack.mockResolvedValue({
      base: C3,
      commits: ["4".repeat(40), "5".repeat(40)],
      hashes: ["r4", "r5"],
    });
    expect(await restackCrew(PATH, NOW)).toBeNull();
    expect(host.restack).toHaveBeenCalledWith(PATH, COPY, BRANCH, BASE, [
      C1,
      C2,
    ]);
    const crew = getCrew(PATH)!;
    expect(crew.stack).toEqual({ base: C3 });
    // Replayed, not checked again: each with its new fingerprint.
    expect(crewCard(crew, timer)!.stacked).toEqual({
      commit: "4".repeat(40),
      parent: C3,
      hash: "r4",
      replayed: true,
    });
    expect(crewCard(crew, settings)!.stacked).toEqual({
      commit: "5".repeat(40),
      parent: "4".repeat(40),
      hash: "r5",
      replayed: true,
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
      hash: "own-1",
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

  it("waits while the crew is at work in its copy", async () => {
    await crewWithBatch();
    updateCrew(PATH, (crew) => ({
      ...crew,
      job: { owner: "other", since: NOW, heartbeat: NOW },
    }));
    expect(await restackCrew(PATH, NOW)).toBe(
      "The crew is at work in its copy. Try again once its turn ends.",
    );
    expect(
      await dropStackedCard(
        PATH,
        crewBatch(getCrew(PATH))!.cards[1]!.id,
        "ideas",
        NOW,
      ),
    ).toBe("The crew is at work in its copy. Try again once its turn ends.");
    expect(host.restack).not.toHaveBeenCalled();
    expect(host.discard).not.toHaveBeenCalled();
  });
});

describe("the crew's copy is held while the branch moves", () => {
  it("holds the crew's job for a whole restack, so nothing starts in the copy", async () => {
    await crewWithBatch();
    host.restack.mockImplementation(async () => {
      // Mid-restack: the runner can't take the copy.
      expect(jobIsLive(getCrew(PATH)!.job, NOW)).toBe(true);
      expect(claimCrewJob(PATH, "runner", NOW)).toBe(false);
      return {
        base: C3,
        commits: ["4".repeat(40), "5".repeat(40)],
        hashes: ["r4", "r5"],
      };
    });
    expect(await restackCrew(PATH, NOW)).toBeNull();
    expect(host.restack).toHaveBeenCalled();
    // Let go once it's done.
    expect(getCrew(PATH)!.job).toBeUndefined();
    expect(claimCrewJob(PATH, "runner", NOW)).toBe(true);
  });

  it("holds it while a card comes off the branch, and lets go when that fails", async () => {
    const [, settings] = await crewWithBatch();
    host.discard.mockImplementation(async () => {
      expect(claimCrewJob(PATH, "runner", NOW)).toBe(false);
      throw new Error("The crew's copy moved since its last card.");
    });
    expect(await dropStackedCard(PATH, settings, "ideas", NOW)).toBeTruthy();
    expect(getCrew(PATH)!.job).toBeUndefined();
  });
});

describe("taking a card off the branch", () => {
  it("takes the top card off, back to the card before it", async () => {
    const [timer, settings] = await crewWithBatch();
    host.discard.mockResolvedValue(undefined);
    updateCrew(PATH, (crew) => ({
      ...crew,
      stack: {
        base: BASE,
        conflict: "Your files changed where the crew worked",
      },
    }));
    expect(await discardCrewCard(PATH, settings, "ideas", NOW)).toBeNull();
    // Only while the branch is still at that card.
    expect(host.discard).toHaveBeenCalledWith(COPY, C1, BRANCH, C2);
    const crew = getCrew(PATH)!;
    expect(crewCard(crew, settings)!.stage).toBe("discarded");
    expect(crewBatch(crew)!.cards.map((card) => card.id)).toEqual([timer]);
    // What conflicted may have been that card: Apply finds out again.
    expect(crew.stack).toEqual({ base: BASE });
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
    expect(host.discard).toHaveBeenLastCalledWith(COPY, BASE, BRANCH, C1);
  });
});

describe("a goal card you threw away", () => {
  it("is remembered by the goal, so it isn't planned again", async () => {
    const [, settings] = await crewWithBatch((cards) =>
      cards.map((card) => ({ ...card, goal: true as const })),
    );
    updateCrew(PATH, (crew) => ({
      ...crew,
      goal: { text: "Build the whole Pom app", at: 1 },
    }));
    host.discard.mockResolvedValue(undefined);
    expect(await discardCrewCard(PATH, settings, "delete", NOW)).toBeNull();
    expect(getCrew(PATH)!.goal?.dropped).toEqual(["Settings page"]);
  });
});
