// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  allowMoreRunsToday,
  applyCrewCard,
  deleteBoardCard,
  discardCrewCard,
  focusCrewTell,
  giveCardToCrew,
  notNowIdea,
  pickCrewModels,
  resumeCrewCard,
  setCrewPaused,
  setCrewQuietHours,
  stopCrewCard,
  takeCrewTell,
  tellCrew,
  turnOnCrew,
} from "./crewActions";
import { crewInboxCard, openCrewInboxItems } from "./crewInbox";
import { CrewRunner } from "./crewRunner";
import type { Session } from "./session";
import { afterBuild, afterCheck, queueCard, startCard } from "./crewLoop";
import {
  cardInCopy,
  crewCard,
  crewsSnapshot,
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
import { crewCardMenu } from "./crewView";
import { nextCardToStart } from "./crewLimits";

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
  it("applies by the fingerprint and ships the card, leaving the copy to the next card", async () => {
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
    // Apply never resets the copy: the next card syncs it itself, under its
    // own turn, so this can't race a card already started.
    expect(host.sync).not.toHaveBeenCalled();
  });

  it("never applies settings or hooks that could run as you; you can take it over", async () => {
    const id = await crewWithReadyCard();
    updateCrew(PATH, (crew) => {
      const card = crewCard(crew, id)!;
      return withCard(crew, {
        ...card,
        fix: {
          ...card.fix!,
          paths: [
            { path: "src/theme.ts", additions: 1, deletions: 0 },
            { path: ".Claude/settings.local.json", additions: 3, deletions: 0 },
            { path: ".husky/pre-commit", additions: 1, deletions: 0 },
          ],
        },
      });
    });
    host.apply.mockClear();
    const problem = await applyCrewCard(PATH, id, NOON);
    expect(problem).toBe(
      "Aven didn't apply this fix: it changes settings or hooks that could run commands as you (.Claude/settings.local.json, .husky/pre-commit). Take it over in a chat to apply that part yourself.",
    );
    expect(host.apply).not.toHaveBeenCalled();
    const card = crewCard(getCrew(PATH)!, id)!;
    expect(card).toMatchObject({ stage: "ready", error: problem });
    expect(crewCardMenu(card).map((action) => action.label)).toEqual([
      "Take over in a chat",
    ]);
  });

  // crews-review/apply-refresh: two Apply clicks must never land a change
  // nobody checked.
  it("never re-stamps a change that moved after its check: it waits for another check", async () => {
    const id = await crewWithReadyCard();
    let copyHash = "unchecked";
    host.apply.mockImplementation(
      async (_cwd: string, _copy: string, _base: string, hash: string) => {
        if (hash !== copyHash)
          throw new Error("The fix changed since you looked.");
        return { files: [], additions: 0, deletions: 0 };
      },
    );
    host.diff.mockResolvedValue({
      files: [
        {
          path: "src/evil.ts",
          status: "modified",
          additions: 99,
          deletions: 0,
          binary: false,
        },
      ],
      additions: 99,
      deletions: 0,
      hash: copyHash,
    });
    // Click 1: refused, and the card says why instead of claiming a pass.
    expect(await applyCrewCard(PATH, id, NOON)).toBe(
      "The change moved after Checker's check, so it wasn't applied. One more round checks it again.",
    );
    const card = crewCard(getCrew(PATH)!, id)!;
    expect(card.stage).toBe("stuck");
    expect(card.stuck).toEqual({
      reason: "changed",
      text: "The change moved after Checker's check, so it wasn't applied",
    });
    expect(card.fix).toBeUndefined();
    expect(card.holder).toBe("checker");
    // Its Ready card left the Inbox; a Needs you card says what happened.
    const inbox = openCrewInboxItems(crewsSnapshot());
    expect(inbox).toHaveLength(1);
    expect(inbox[0].card.stage).toBe("stuck");
    expect(inbox[0].review.summary).not.toMatch(/Passed/);
    expect(inbox[0].review.summary).toMatch(/moved after Checker's check/);
    expect(featureBoardState(PATH).cards[0].column).toBe("building");
    // Click 2 lands nothing.
    expect(await applyCrewCard(PATH, id, NOON + 1)).toBe(
      "This card is no longer ready.",
    );
    expect(host.apply).toHaveBeenCalledTimes(1);
    // One more round checks the copy as it is now.
    copyHash = "still-unchecked";
    resumeCrewCard(PATH, id, undefined, NOON + 2);
    expect(crewCard(getCrew(PATH)!, id)).toMatchObject({
      stage: "checking",
      holder: "checker",
    });
  });

  // crews-review/apply-sync-race: Apply must never reset the copy under a
  // card the runner already gave to the Builder.
  it("leaves the copy alone while the runner starts the next card", async () => {
    const log: string[] = [];
    const [ready, next] = await addFeatureCards(PATH, [
      { title: "Ready one", column: "review" },
      { title: "Next one", column: "building" },
    ]);
    updateCrew(PATH, (crew) =>
      withCard(
        withCard(
          {
            ...crew,
            on: true,
            onAt: 1,
            copy: { path: COPY, branch: "aven/bot/crew-1", root: PATH },
          },
          readyCard(ready.id),
        ),
        queueCard(
          {
            id: next.id,
            title: "Next one",
            brief: "y",
            from: "you",
            maxRounds: 3,
          },
          5,
        ),
      ),
    );
    host.apply.mockResolvedValue({ files: [], additions: 0, deletions: 0 });
    host.sync.mockImplementation(async () => {
      log.push("apply: reset the copy");
      return { root: PATH, base: "b3", uncommitted: false, untracked: false };
    });
    const session = {
      id: "s-builder",
      blocks: [],
      busy: false,
    } as unknown as Session;
    const runner = new CrewRunner({
      owner: "me",
      now: () => NOON,
      setTimer: (run, ms) => setTimeout(run, ms) as unknown as number,
      clearTimer: (id) => clearTimeout(id),
      sessions: () => [session],
      ensureChat: async () => session,
      send: () => {
        log.push("runner: sent the next card");
        return true;
      },
      stopChat: () => {},
      copy: {
        prepare: async (_cwd, _key, branch) => ({
          path: COPY,
          branch,
          root: PATH,
          gitDir: `${PATH}/.git`,
        }),
        sync: async () => {
          log.push("runner: sync for the next card");
          return {
            root: PATH,
            base: "b2",
            uncommitted: false,
            untracked: false,
          };
        },
        diff: async () => ({
          files: [],
          additions: 0,
          deletions: 0,
          hash: "e",
        }),
        sources: async () => [],
        planted: async () => [],
      },
      weeklyUsed: () => null,
      fixerRuns: () => 0,
      fixerBranch: () => undefined,
      board: {
        cards: async () => [],
        move: () => undefined,
        add: async () => [],
      },
      name: () => "Bot",
      onWorking: () => {},
    });
    runner.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await applyCrewCard(PATH, ready.id, NOON)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    runner.stop();
    expect(log).toEqual([
      "runner: sync for the next card",
      "runner: sent the next card",
    ]);
    expect(crewCard(getCrew(PATH)!, next.id)!.base).toBe("b2");
  });

  it("won't apply while the crew is still working", async () => {
    const id = await crewWithReadyCard();
    updateCrew(PATH, (crew) => ({
      ...crew,
      job: { owner: "other", since: NOON, heartbeat: NOON },
    }));
    expect(await applyCrewCard(PATH, id, NOON + 1_000)).toBe(
      "The crew is still working. Apply once it finishes.",
    );
    expect(host.apply).not.toHaveBeenCalled();
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

describe("a card the crew has, gone from the Board", () => {
  it("Delete throws a queued card away so the crew never builds it", async () => {
    updateCrew(PATH, (crew) => ({ ...crew, on: true }));
    const [board] = await addFeatureCards(PATH, [{ title: "Pricing page" }]);
    await giveCardToCrew(PATH, board, NOON);
    expect(await deleteBoardCard(PATH, board.id)).toBeNull();
    expect(featureBoardState(PATH).cards).toEqual([]);
    const crew = getCrew(PATH)!;
    expect(crewCard(crew, board.id)!.stage).toBe("discarded");
    expect(nextCardToStart(crew)).toBeNull();
  });

  it("Delete frees the copy a Stuck card held", async () => {
    const id = await crewWithReadyCard();
    updateCrew(PATH, (crew) =>
      withCard(crew, {
        ...crewCard(crew, id)!,
        stage: "stuck",
        stuck: { reason: "rounds", text: "Stuck after 3 rounds" },
      }),
    );
    host.discard.mockResolvedValue(undefined);
    expect(await deleteBoardCard(PATH, id)).toBeNull();
    expect(host.discard).toHaveBeenCalledWith(
      COPY,
      "base-1",
      "aven/bot/crew-1",
    );
    expect(cardInCopy(getCrew(PATH)!)).toBeUndefined();
    expect(featureBoardState(PATH).cards).toEqual([]);
  });

  it("Delete of an ordinary card just deletes it", async () => {
    const [board] = await addFeatureCards(PATH, [{ title: "Pricing page" }]);
    expect(await deleteBoardCard(PATH, board.id)).toBeNull();
    expect(featureBoardState(PATH).cards).toEqual([]);
    expect(host.discard).not.toHaveBeenCalled();
  });
});

describe("stopping and trying again", () => {
  it("Stop now leaves the member that took its turn no longer Working", async () => {
    updateCrew(PATH, (crew) => ({
      ...withCard(
        { ...crew, on: true },
        {
          ...startCard(
            queueCard(
              {
                id: "c1",
                title: "Dark mode",
                brief: "x",
                from: "you",
                maxRounds: 3,
              },
              1,
            ),
            2,
          ),
          turn: {
            role: "builder",
            sessionId: "b-chat",
            turnId: "t",
            sentAt: 3,
          },
        },
      ),
      members: [
        {
          id: "builder",
          role: "builder",
          sessionId: "b-chat",
          doing: { at: 3, text: "Building Dark mode · round 1" },
        },
        { id: "checker", role: "checker" },
      ],
    }));
    await stopCrewCard(PATH, "c1", NOON);
    const crew = getCrew(PATH)!;
    expect(crewCard(crew, "c1")!.stuck?.reason).toBe("stopped");
    expect(crew.members[0].doing).toBeUndefined();
  });

  it("logs Try again as trying the card again, not as another round", () => {
    updateCrew(PATH, (crew) =>
      withCard(
        { ...crew, on: true },
        {
          ...startCard(
            queueCard(
              {
                id: "c1",
                title: "Dark mode",
                brief: "x",
                from: "you",
                maxRounds: 3,
              },
              1,
            ),
            2,
          ),
          stage: "stuck",
          stuck: { reason: "failed", text: "Beetle's turn didn't finish" },
        },
      ),
    );
    resumeCrewCard(PATH, "c1", undefined, NOON);
    expect(getCrew(PATH)!.feed.at(-1)?.text).toBe("Trying “Dark mode” again");
  });
});

describe("Tell the crew… from elsewhere", () => {
  it("is taken once, by that crew's Feed", () => {
    focusCrewTell(`${PATH}/`);
    expect(takeCrewTell("/Users/me/other")).toBe(false);
    expect(takeCrewTell(PATH)).toBe(true);
    expect(takeCrewTell(PATH)).toBe(false);
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

describe("a check that failed because Codex couldn't be locked down", () => {
  it("goes again on Try again, with the Checker on Claude", async () => {
    const [board] = await addFeatureCards(PATH, [
      { title: "Dark mode", column: "building" },
    ]);
    let card = startCard(
      queueCard(
        {
          id: board.id,
          title: "Dark mode",
          brief: "x",
          from: "you",
          maxRounds: 3,
        },
        1,
      ),
      2,
    );
    card = afterBuild(
      { ...card, base: "base-1" },
      {
        handoff: { summary: "Done", howToCheck: [], ran: [] },
        change: {
          base: "base-1",
          hash: "h",
          files: 1,
          additions: 1,
          deletions: 0,
          paths: [],
        },
        now: 3,
      },
    ).card;
    // As the user's card failed in the earlier build's words.
    card = {
      ...card,
      stage: "stuck",
      holder: "checker",
      stuck: {
        reason: "failed",
        text: "Owl's turn didn't finish: Codex couldn't start with its tools switched off (plugin github@openai-curated, plugin codex-app-tools@openai-bundled)",
      },
    };
    updateCrew(PATH, (crew) =>
      withCard(
        {
          ...crew,
          on: true,
          members: [
            { id: "builder", role: "builder", model: "claude:opus" },
            {
              id: "checker",
              role: "checker",
              harness: "codex",
              model: "codex:gpt",
            },
          ],
        },
        card,
      ),
    );
    resumeCrewCard(PATH, board.id, undefined, NOON);
    const crew = getCrew(PATH)!;
    expect(crewCard(crew, board.id)).toMatchObject({
      stage: "checking",
      holder: "checker",
      round: 1,
    });
    expect(
      crew.members.find((member) => member.role === "checker")?.fallback
        ?.harness,
    ).toBe("claude");
    expect(
      crew.feed.some((entry) => entry.text.includes("checking with Claude")),
    ).toBe(true);
  });
});
