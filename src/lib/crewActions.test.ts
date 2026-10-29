// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  allowMoreRunsToday,
  applyCrewCard,
  discardCrewCard,
  giveCardToCrew,
  notNowIdea,
  pickCrewModels,
  resumeCrewCard,
  setCrewPaused,
  setCrewQuietHours,
  tellCrew,
  turnOnCrew,
} from "./crewActions";
import { crewInboxCard } from "./crewInbox";
import { afterBuild, afterCheck, queueCard, startCard } from "./crewLoop";
import {
  crewCard,
  getCrew,
  resetCrewsCache,
  updateCrew,
  withCard,
  withIdea,
  type CrewCard,
} from "./crews";
import {
  addFeatureCards,
  featureBoardState,
  memoryFeatureCardBackend,
  setFeatureCardBackend,
} from "./featureCards";
import { localDay, resetProjectBotsCache } from "./projectBots";

const host = vi.hoisted(() => ({
  apply: vi.fn(),
  diff: vi.fn(),
  sync: vi.fn(),
  discard: vi.fn(),
}));
vi.mock("./projectBotCopy", async (original) => {
  const actual = await original<typeof import("./projectBotCopy")>();
  return {
    ...actual,
    botCopyHost: { ...actual.botCopyHost, ...host },
  };
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
const COPY = "/data/bots/aven-site-crew-1";
const NOON = new Date(2026, 9, 29, 12).getTime();

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  resetCrewsCache();
  setFeatureCardBackend(memoryFeatureCardBackend());
  for (const fn of Object.values(host)) fn.mockReset();
  host.sync.mockResolvedValue({
    root: PATH,
    base: "next-base",
    uncommitted: false,
    untracked: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProjectBotsCache();
  resetCrewsCache();
  setFeatureCardBackend(null);
});

function readyCard(id: string): CrewCard {
  let card = startCard(
    queueCard(
      { id, title: "Dark mode toggle", brief: "x", from: "you", maxRounds: 3 },
      1,
    ),
    2,
  );
  card = { ...card, base: "base-1" };
  card = afterBuild(card, {
    handoff: { summary: "Done", howToCheck: [], ran: [] },
    change: {
      base: "base-1",
      hash: "reviewed-hash",
      files: 2,
      additions: 14,
      deletions: 3,
      paths: [{ path: "src/theme.ts", additions: 9, deletions: 2 }],
    },
    now: 3,
  }).card;
  card = afterCheck(card, {
    verdict: { pass: true, summary: "", mustFix: [], later: [], ran: [] },
    edited: false,
    now: 4,
  }).card;
  return { ...card, inbox: crewInboxCard(card, 4) };
}

async function crewWithReadyCard() {
  const [board] = await addFeatureCards(PATH, [
    { title: "Dark mode toggle", column: "review" },
  ]);
  updateCrew(PATH, (crew) =>
    withCard(
      {
        ...crew,
        on: true,
        copy: { path: COPY, branch: "aven/bot/crew-1", root: PATH },
      },
      readyCard(board.id),
    ),
  );
  return board.id;
}

describe("Apply lands exactly the reviewed change", () => {
  it("applies by the fingerprint, ships the card and syncs the copy", async () => {
    const id = await crewWithReadyCard();
    host.apply.mockResolvedValue({ files: [], additions: 0, deletions: 0 });
    expect(await applyCrewCard(PATH, id, NOON)).toBeNull();
    expect(host.apply).toHaveBeenCalledWith(
      PATH,
      COPY,
      "base-1",
      "reviewed-hash",
    );
    const card = crewCard(getCrew(PATH)!, id)!;
    expect(card.stage).toBe("applied");
    expect(card.inbox?.status).toBe("done");
    expect(featureBoardState(PATH).cards[0].column).toBe("shipped");
    expect(host.sync).toHaveBeenCalledWith(PATH, COPY, "aven/bot/crew-1");
  });

  it("refuses a change that moved since you looked, and records the new one", async () => {
    const id = await crewWithReadyCard();
    host.apply.mockRejectedValue(
      new Error("The fix changed since you looked."),
    );
    host.diff.mockResolvedValue({
      files: [
        {
          path: "src/theme.ts",
          status: "modified",
          additions: 10,
          deletions: 2,
          binary: false,
        },
      ],
      additions: 10,
      deletions: 2,
      hash: "newer-hash",
    });
    expect(await applyCrewCard(PATH, id, NOON)).toBe(
      "The change moved since you looked. Review it again, then apply.",
    );
    const card = crewCard(getCrew(PATH)!, id)!;
    expect(card.stage).toBe("ready");
    expect(card.fix?.hash).toBe("newer-hash");
    expect(featureBoardState(PATH).cards[0].column).toBe("review");
  });

  it("keeps the card when your files conflict, and says why", async () => {
    const id = await crewWithReadyCard();
    host.apply.mockRejectedValue(
      new Error("These changes conflict with edits in your project."),
    );
    expect(await applyCrewCard(PATH, id, NOON)).toBe(
      "These changes conflict with edits in your files. Save or undo those edits, then try again.",
    );
    expect(crewCard(getCrew(PATH)!, id)!.stage).toBe("ready");
  });

  it("won't apply a card that isn't Ready", async () => {
    const id = await crewWithReadyCard();
    updateCrew(PATH, (crew) =>
      withCard(crew, { ...crewCard(crew, id)!, stage: "stuck" }),
    );
    expect(await applyCrewCard(PATH, id, NOON)).toBe(
      "This card is no longer ready.",
    );
    expect(host.apply).not.toHaveBeenCalled();
  });
});

describe("card actions", () => {
  it("gives a card to the crew: Queued in Building", async () => {
    updateCrew(PATH, (crew) => ({ ...crew, on: true }));
    const [board] = await addFeatureCards(PATH, [
      { title: "Pricing page", note: "Three tiers." },
    ]);
    expect(await giveCardToCrew(PATH, board, NOON)).toBeNull();
    const card = crewCard(getCrew(PATH)!, board.id)!;
    expect(card).toMatchObject({
      stage: "queued",
      from: "you",
      brief: "Pricing page\n\nThree tiers.",
      maxRounds: 3,
    });
    expect(featureBoardState(PATH).cards[0].column).toBe("building");
  });

  it("asks you to turn the crew on first", async () => {
    expect(await giveCardToCrew(PATH, { id: "x", title: "X" }, NOON)).toBe(
      "Turn the crew on first.",
    );
  });

  it("Not now keeps a Scout idea from starting by itself", () => {
    updateCrew(PATH, (crew) =>
      withIdea({ ...crew, on: true }, "idea-1", { at: 1, size: "small" }),
    );
    notNowIdea(PATH, "idea-1");
    expect(getCrew(PATH)!.ideas?.["idea-1"].declined).toBe(true);
  });

  it("Back to Ideas throws the work away and frees the copy", async () => {
    const id = await crewWithReadyCard();
    host.discard.mockResolvedValue(undefined);
    expect(await discardCrewCard(PATH, id, "ideas", NOON)).toBeNull();
    expect(host.discard).toHaveBeenCalledWith(
      COPY,
      "base-1",
      "aven/bot/crew-1",
    );
    expect(crewCard(getCrew(PATH)!, id)!.stage).toBe("discarded");
    expect(crewCard(getCrew(PATH)!, id)!.inbox?.status).toBe("dismissed");
    expect(featureBoardState(PATH).cards[0].column).toBe("idea");
  });

  it("Send back takes a Ready card to the Builder for another round with your note", async () => {
    const id = await crewWithReadyCard();
    resumeCrewCard(PATH, id, "Use the theme token.", NOON);
    const card = crewCard(getCrew(PATH)!, id)!;
    expect(card).toMatchObject({
      stage: "building",
      round: 2,
      note: "Use the theme token.",
    });
    expect(card.fix).toBeUndefined();
    expect(card.inbox?.status).toBe("done");
  });
});

describe("crew controls", () => {
  it("pauses and resumes, saying so in the feed", () => {
    setCrewPaused(PATH, true, NOON);
    expect(getCrew(PATH)!.paused).toBe(true);
    setCrewPaused(PATH, false, NOON);
    expect(getCrew(PATH)!.paused).toBeUndefined();
    expect(getCrew(PATH)!.feed.map((entry) => entry.text)).toEqual([
      "You paused the crew",
      "You resumed the crew",
    ]);
  });

  it("lets you change quiet hours and allow more runs today", () => {
    setCrewQuietHours(PATH, { on: true, start: 22 * 60, end: 7 * 60 });
    expect(getCrew(PATH)!.limits.quiet).toEqual({
      on: true,
      start: 1320,
      end: 420,
    });
    allowMoreRunsToday(PATH, NOON);
    allowMoreRunsToday(PATH, NOON);
    expect(getCrew(PATH)!.extra).toEqual({ day: localDay(NOON), count: 20 });
  });

  it("keeps what you tell the crew as a standing note", () => {
    tellCrew(PATH, "Use pnpm, not npm.", NOON);
    expect(getCrew(PATH)!.notes.map((note) => note.text)).toEqual([
      "Use pnpm, not npm.",
    ]);
  });

  it("turns on with the Checker on another model", () => {
    const models = pickCrewModels({
      codex: true,
      claudeModels: ["claude:opus", "claude:sonnet", "claude:haiku"],
      preferredClaude: "claude:opus",
      preferredCodex: "codex:gpt",
    });
    expect(models).toEqual({
      builder: { harness: "claude", model: "claude:opus" },
      checker: { harness: "codex", model: "codex:gpt" },
      scout: { harness: "claude", model: "claude:haiku" },
    });
    expect(
      pickCrewModels({
        codex: false,
        claudeModels: ["claude:opus", "claude:sonnet"],
        preferredClaude: "claude:opus",
      }).checker,
    ).toEqual({ harness: "claude", model: "claude:sonnet" });
    turnOnCrew(PATH, models, NOON);
    const crew = getCrew(PATH)!;
    expect(crew.on).toBe(true);
    expect(
      crew.members.find((member) => member.role === "checker"),
    ).toMatchObject({
      harness: "codex",
      model: "codex:gpt",
    });
  });
});
