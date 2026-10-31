// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { afterBuild, afterCheck, queueCard, startCard } from "../lib/crewLoop";
import {
  focusCrewTell,
  installCrewWorkspace,
  requestCrewReview,
} from "../lib/crewActions";
import {
  crewCard,
  getCrew,
  resetCrewsCache,
  setCrewsAllRunsPerDay,
  updateCrew,
  withCard,
  withFeed,
  withIdea,
  withNote,
  type Crew,
  type CrewCard,
} from "../lib/crews";
import {
  addFeatureCards,
  memoryFeatureCardBackend,
  setFeatureCardBackend,
  type FeatureCard,
} from "../lib/featureCards";
import { localDay, resetProjectBotsCache } from "../lib/projectBots";
import {
  installWorkBoardActions,
  publishWorkBoardFeed,
  resetWorkBoardFeed,
} from "../lib/workBoardFeed";
import { WorkBoard, cardMenuItems } from "./WorkBoard";

const actions = vi.hoisted(() => ({
  applyCrewBatch: vi.fn(async () => null as string | null),
  restackCrew: vi.fn(async () => null as string | null),
  // Up to a card: the setups stack their first card at "1…".
  reviewCrewBatch: vi.fn(async (_project: string, upTo?: string) => ({
    diff: {
      files: [
        {
          path: "src/a.ts",
          status: "modified",
          additions: 14,
          deletions: 3,
          binary: false,
        },
      ],
      additions: 14,
      deletions: 3,
      hash: "h-reviewed",
    },
    from: "a".repeat(40),
    to: (upTo ? "1" : "2").repeat(40),
    cards: [],
  })),
  applyCrewCard: vi.fn(async () => null as string | null),
  giveCardToCrew: vi.fn(async () => null as string | null),
  discardCrewCard: vi.fn(async () => null as string | null),
  resumeCrewCard: vi.fn(),
  notNowIdea: vi.fn(),
  stopCrewCard: vi.fn(async () => undefined),
  setCrewCardPaused: vi.fn(),
  openChat: vi.fn(),
}));
vi.mock("../lib/crewActions", async (original) => {
  const actual = await original<typeof import("../lib/crewActions")>();
  return {
    ...actual,
    applyCrewCard: actions.applyCrewCard,
    applyCrewBatch: actions.applyCrewBatch,
    restackCrew: actions.restackCrew,
    reviewCrewBatch: actions.reviewCrewBatch,
    giveCardToCrew: actions.giveCardToCrew,
    discardCrewCard: actions.discardCrewCard,
    resumeCrewCard: actions.resumeCrewCard,
    notNowIdea: actions.notNowIdea,
    stopCrewCard: actions.stopCrewCard,
    setCrewCardPaused: actions.setCrewCardPaused,
  };
});
vi.mock("../hooks/useProjectBots", () => ({ claudeWeeklyUsed: () => 40 }));
vi.mock("../chrome/ProjectMark", () => ({ ProjectMark: () => null }));
vi.mock("../chrome/ExplorerMenu", async () => {
  const react = await import("react");
  return {
    ExplorerMenu: ({
      items,
      onPick,
    }: {
      items: { kind: string; id?: string; label?: string }[];
      onPick: (id: string) => void;
    }) =>
      react.createElement(
        "div",
        { "data-menu": "" },
        items
          .filter((item) => item.kind === "item")
          .map((item) =>
            react.createElement(
              "button",
              { key: item.id, onClick: () => onPick(item.id!) },
              item.label,
            ),
          ),
      ),
  };
});
vi.mock("../chrome/ConfirmDialog", async () => {
  const react = await import("react");
  return {
    ConfirmDialog: ({
      title,
      body,
      onConfirm,
    }: {
      title: string;
      body: string;
      onConfirm: () => void;
    }) =>
      react.createElement(
        "div",
        { "data-confirm-dialog": title },
        react.createElement("p", null, body),
        react.createElement("button", { onClick: onConfirm }, "Confirm"),
      ),
  };
});

const PROJECT = "/work/aven-site";
const NOW = new Date(2026, 9, 29, 15, 0).getTime();

let root: Root;
let container: HTMLDivElement;

async function settle() {
  await act(async () => {
    for (let round = 0; round < 4; round += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// A crew made now: its members go by their roles.
const names = { builder: "Builder", checker: "Checker" };

function crewCardFor(
  board: FeatureCard,
  stage: "queued" | "fixing" | "ready" | "stuck" | "question",
): CrewCard {
  let card = queueCard(
    {
      id: board.id,
      title: board.title,
      brief: board.title,
      from: "you",
      maxRounds: 3,
    },
    NOW - 60_000,
  );
  if (stage === "queued") return card;
  card = { ...startCard(card, NOW - 50_000), base: "base" };
  const change = (hash: string) => ({
    base: "base",
    hash,
    files: 2,
    additions: 14,
    deletions: 3,
    paths: [{ path: "src/a.ts", additions: 14, deletions: 3 }],
  });
  if (stage === "question")
    return afterBuild(card, {
      handoff: {
        summary: "Half",
        howToCheck: [],
        ran: [],
        question: "Keep each note's colour?",
      },
      change: change("h1"),
      now: NOW - 40_000,
      names,
    }).card;
  card = afterBuild(card, {
    handoff: { summary: "Done", howToCheck: [], ran: [] },
    change: change("h1"),
    now: NOW - 40_000,
    names,
  }).card;
  const verdict = (mustFix: string[]) => ({
    pass: !mustFix.length,
    summary: "",
    mustFix: mustFix.map((text) => ({ text })),
    later: ["Follow the system setting"],
    ran: [{ command: "pnpm test", ok: true, note: "48 passed" }],
  });
  if (stage === "ready")
    return afterCheck(card, {
      verdict: verdict([]),
      edited: false,
      now: NOW - 30_000,
      names,
    }).card;
  card = afterCheck(card, {
    verdict: verdict(["Contrast", "Reload forgets"]),
    edited: false,
    now: NOW - 30_000,
    names,
  }).card;
  if (stage === "fixing")
    return {
      ...card,
      turn: {
        role: "builder",
        sessionId: "builder-chat",
        turnId: "t",
        sentAt: NOW - 240_000,
      },
    };
  return {
    ...card,
    stage: "stuck",
    stuck: { reason: "rounds", text: "Stuck after 3 rounds" },
  };
}

async function setUp(build: (boards: FeatureCard[]) => (crew: Crew) => Crew) {
  const boards = await addFeatureCards(PROJECT, [
    { title: "Pricing page", column: "idea" },
    { title: "Remember the last open note", column: "idea" },
    { title: "Dark mode toggle", column: "building" },
    { title: "Hero focus ring", column: "building" },
    { title: "Search inside note bodies", column: "building" },
    { title: "Empty state for notes", column: "building" },
  ]);
  updateCrew(PROJECT, (crew) =>
    build(boards)({
      ...crew,
      on: true,
      runs: { day: localDay(NOW), count: 7 },
    }),
  );
  publishWorkBoardFeed({ chats: [], statuses: {}, teams: [] });
  await act(async () =>
    root.render(createElement(WorkBoard, { project: PROJECT, visible: true })),
  );
  await settle();
  return boards;
}

const card = (id: string) =>
  container.querySelector<HTMLElement>(`[data-board-card="${id}"]`)!;
const button = (scope: Element, name: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent === name,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  resetProjectBotsCache();
  resetCrewsCache();
  setFeatureCardBackend(memoryFeatureCardBackend());
  resetWorkBoardFeed();
  installWorkBoardActions({
    openChat: vi.fn(),
    allow: vi.fn(),
    review: vi.fn(),
    ship: vi.fn(),
    watch: vi.fn(),
    compare: vi.fn(),
    preview: vi.fn(),
    openCommit: vi.fn(),
    openUrl: vi.fn(),
    build: vi.fn(() => "built"),
    draft: vi.fn(() => "drafted"),
  });
  for (const fn of Object.values(actions)) fn.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetWorkBoardFeed();
  setFeatureCardBackend(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the crew view: the Board with the crew on it", () => {
  it("has one header: marks, one sentence, Pause and ⋯; the limits and Activity in the footer", async () => {
    await setUp(
      () => (crew) =>
        withFeed(crew, {
          at: NOW - 1_000,
          kind: "handoff",
          who: "builder",
          to: "checker",
          round: 1,
          title: "Dark mode toggle",
          text: "A switch in Settings and a theme store.",
        }),
    );
    const header = container.querySelector<HTMLElement>("[data-crew-header]")!;
    expect(header.querySelector("h1")?.textContent).toBe("aven-site crew");
    expect(header.querySelector("[data-crew-sentence]")?.textContent).toBe(
      "Nothing to build. Tell the crew what to do, or add an idea.",
    );
    expect(button(header, "Pause")).toBeTruthy();
    // One header: no board title above it, no strip, no columns, no Feed box.
    expect(container.querySelector(".work-board-header")).toBeNull();
    expect(container.querySelector(".crew-strip")).toBeNull();
    expect(container.querySelector("[data-board-column]")).toBeNull();
    expect(container.querySelector("[data-crew-feed]")).toBeNull();
    // The members are its marks.
    expect(
      [...header.querySelectorAll<HTMLElement>("[data-crew-tile]")].map(
        (tile) => tile.dataset.crewTile,
      ),
    ).toEqual(["builder", "checker", "security"]);
    expect(
      container.querySelector("[data-crew-foot] [data-crew-limits]")
        ?.textContent,
    ).toBe("7 of 20 runs today · quiet 11 pm–8 am");
    // Activity opens the whole Feed.
    await act(async () =>
      button(
        container.querySelector("[data-crew-foot]")!,
        "Activity ›",
      )!.click(),
    );
    const feed = document.querySelector<HTMLElement>("[data-crew-feed]")!;
    expect(feed.textContent).toContain("Builder → Checker · round 1");
    expect(feed.textContent).toContain(
      "A switch in Settings and a theme store.",
    );
  });

  it("groups its cards as rows, each with its path through Build, Check, Security and You", async () => {
    const boards = await setUp((boards) => (crew) => {
      let next = withCard(crew, crewCardFor(boards[2], "fixing"));
      next = withCard(next, crewCardFor(boards[5], "queued"));
      return next;
    });
    const group = (label: string) =>
      container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
    const fixing = card(boards[2].id);
    expect(group("In progress")!.contains(fixing)).toBe(true);
    expect(fixing.querySelector(".crew-pipe-row-status")?.textContent).toBe(
      "Round 2 of 3 · Builder fixing: Contrast",
    );
    expect(fixing.querySelector(".crew-pipe-bar")).toBeTruthy();
    expect(
      [...fixing.querySelectorAll<HTMLElement>(".crew-pipe-step")].map(
        (step) => `${step.dataset.step}:${step.dataset.state}`,
      ),
    ).toEqual(["build:now", "check:todo", "security:todo", "you:todo"]);
    expect(button(fixing, "Watch")).toBeTruthy();
    const queued = card(boards[5].id);
    expect(group("Up next")!.contains(queued)).toBe(true);
    expect(queued.querySelector(".crew-pipe-row-status")?.textContent).toBe(
      "From you · waits for Dark mode toggle",
    );
    expect(button(queued, "Not now")).toBeTruthy();
    expect(container.querySelector("[data-crew-sentence]")?.textContent).toBe(
      "Building Dark mode toggle, round 2 of 3: Checker asked for 2 fixes.",
    );
    // Ideas, with Add an idea.
    expect(group("Ideas")!.textContent).toContain("Pricing page");
    expect(group("Ideas")!.querySelector(".work-board-add")).toBeTruthy();
  });

  it("Give to crew and Not now on ideas; a Scout idea says where it came from", async () => {
    const boards = await setUp(
      (boards) => (crew) =>
        withIdea(crew, boards[1].id, { at: 1, size: "small" }),
    );
    const mine = card(boards[0].id);
    expect(
      [
        ...mine.querySelectorAll(
          ".crew-pipe-row-actions button:not([data-crew-give-more]):not(.crew-pipe-more)",
        ),
      ].map((item) => item.textContent),
    ).toEqual(["Give to crew"]);
    // ▾ beside it chooses who builds and checks it.
    expect(
      mine.querySelector("[data-crew-give-more]")?.getAttribute("aria-label"),
    ).toBe(`Choose who builds “${boards[0].title}”`);
    const scouted = card(boards[1].id);
    expect(scouted.querySelector(".crew-pipe-row-status")?.textContent).toBe(
      "From Scout · small",
    );
    expect(button(scouted, "Not now")).toBeTruthy();
    await act(async () => button(mine, "Give to crew")!.click());
    expect(actions.giveCardToCrew).toHaveBeenCalledWith(PROJECT, {
      id: boards[0].id,
      title: "Pricing page",
    });
    await act(async () => button(scouted, "Not now")!.click());
    expect(actions.notNowIdea).toHaveBeenCalledWith(PROJECT, boards[1].id);
  });

  it("Give to crew ▾ chooses who builds and checks a card, and the card says so", async () => {
    const boards = await setUp((boards) => (crew) => ({
      ...withCard(
        crew,
        queueCard(
          {
            id: boards[2].id,
            title: boards[2].title,
            brief: boards[2].title,
            from: "you",
            maxRounds: 2,
            builderId: "builder-2",
            override: { effort: "high" },
          },
          NOW,
        ),
      ),
      members: [
        ...crew.members,
        { id: "builder-2", role: "builder", name: "Mole", critter: "hedgehog" },
      ],
      routes: [{ id: "r1", words: ["pricing"], to: "builder-2" }],
    }));
    // The queued card shows who it went to and what you set for it.
    expect(
      card(boards[2].id).querySelector(".crew-pipe-row-status")?.textContent,
    ).toBe("From you · Mole builds · Checker checks · high · 2 rounds");
    const idea = card(boards[0].id);
    await act(async () =>
      idea.querySelector<HTMLButtonElement>("[data-crew-give-more]")!.click(),
    );
    const chooser = document.querySelector<HTMLElement>(
      "[data-crew-give-chooser]",
    )!;
    expect(chooser).toBeTruthy();
    const selects = [...chooser.querySelectorAll("select")];
    // Auto names the Builder the rules pick: "pricing" sends it to Mole.
    expect(selects[0].options[0].textContent).toBe("Auto · Mole");
    expect([...selects[0].options].map((option) => option.value)).toEqual([
      "",
      "builder",
      "builder-2",
    ]);
    await act(async () => {
      selects[0].value = "builder";
      selects[0].dispatchEvent(new Event("change", { bubbles: true }));
    });
    const rounds = [...chooser.querySelectorAll("select")].at(-1)!;
    await act(async () => {
      rounds.value = "4";
      rounds.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button(chooser, "Give to crew")!.click());
    expect(actions.giveCardToCrew).toHaveBeenCalledWith(
      PROJECT,
      { id: boards[0].id, title: "Pricing page" },
      expect.any(Number),
      { builderId: "builder", maxRounds: 4 },
    );
  });

  describe("the Feed", () => {
    /** Scroll metrics for the Feed's scrolling area, which happy-dom doesn't lay out. */
    const metrics = { scrollHeight: 1_000, clientHeight: 300 };
    let top = 0;
    const isFeed = (element: HTMLElement) =>
      element.dataset?.crewFeedScroll !== undefined;
    beforeEach(() => {
      top = 0;
      metrics.scrollHeight = 1_000;
      for (const [name, value] of Object.entries({
        scrollHeight: {
          get(this: HTMLElement) {
            return isFeed(this) ? metrics.scrollHeight : 0;
          },
        },
        clientHeight: {
          get(this: HTMLElement) {
            return isFeed(this) ? metrics.clientHeight : 0;
          },
        },
        scrollTop: {
          get(this: HTMLElement) {
            return isFeed(this) ? top : 0;
          },
          set(this: HTMLElement, next: number) {
            if (isFeed(this))
              top = Math.max(
                0,
                Math.min(next, metrics.scrollHeight - metrics.clientHeight),
              );
          },
        },
      }))
        Object.defineProperty(HTMLElement.prototype, name, {
          configurable: true,
          ...value,
        });
    });
    afterEach(() => {
      for (const name of ["scrollHeight", "clientHeight", "scrollTop"])
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
          name
        ];
    });
    const feed = () =>
      document.querySelector<HTMLElement>("[data-crew-feed-scroll]")!;
    /** The Feed is in Activity, from the footer. */
    const openActivity = async () =>
      act(async () =>
        button(
          document.querySelector("[data-crew-foot]")!,
          "Activity ›",
        )!.click(),
      );
    const add = async (text: string, grow = 100) => {
      metrics.scrollHeight += grow;
      await act(async () => {
        updateCrew(PROJECT, (crew) =>
          withFeed(crew, { at: NOW, kind: "note", who: "aven", text }),
        );
      });
    };
    const scrollTo = async (next: number) =>
      act(async () => {
        feed().scrollTop = next;
        feed().dispatchEvent(new Event("scroll"));
      });

    it("opens at the newest entry and stays there while you're at the bottom", async () => {
      await setUp(() => (crew) => crew);
      await openActivity();
      expect(feed().scrollTop).toBe(700);
      await add("A handoff");
      expect(feed().scrollTop).toBe(800);
      await add("A verdict");
      expect(feed().scrollTop).toBe(900);
      expect(document.querySelector("[data-crew-feed-new]")).toBeNull();
    });

    it("doesn't jump while you read further up; N new takes you down", async () => {
      await setUp(() => (crew) => crew);
      await openActivity();
      await scrollTo(120);
      await add("One");
      await add("Two");
      expect(feed().scrollTop).toBe(120);
      const pill = document.querySelector<HTMLButtonElement>(
        "[data-crew-feed-new]",
      )!;
      expect(pill.textContent).toBe("2 new ↓");
      await act(async () => pill.click());
      expect(feed().scrollTop).toBe(
        metrics.scrollHeight - metrics.clientHeight,
      );
      expect(document.querySelector("[data-crew-feed-new]")).toBeNull();
      // Reading again, then back to the bottom by hand: the pill goes.
      await scrollTo(0);
      await add("Three");
      expect(document.querySelector("[data-crew-feed-new]")).not.toBeNull();
      await scrollTo(metrics.scrollHeight);
      expect(document.querySelector("[data-crew-feed-new]")).toBeNull();
    });

    it("folds a long entry to a few lines with Show more", async () => {
      await setUp(() => (crew) => crew);
      await openActivity();
      const long = `Owl's turn didn't finish: ${"Codex couldn't be locked down here. ".repeat(12)}`;
      await add(long);
      const entry = [
        ...document.querySelectorAll<HTMLElement>(".crew-feed-entry"),
      ].at(-1)!;
      const text = entry.querySelector<HTMLElement>(".crew-feed-words")!;
      expect(text.hasAttribute("data-folded")).toBe(true);
      const more = button(entry, "Show more")!;
      await act(async () => more.click());
      expect(text.hasAttribute("data-folded")).toBe(false);
      expect(button(entry, "Show less")).toBeTruthy();
      // A short one never folds.
      await add("Short");
      const short = [
        ...document.querySelectorAll<HTMLElement>(".crew-feed-entry"),
      ].at(-1)!;
      expect(short.querySelector("[data-folded]")).toBeNull();
      expect(button(short, "Show more")).toBeUndefined();
    });

    it("keeps its history: Show earlier brings older entries back", async () => {
      await setUp(() => (crew) => {
        let next = crew;
        for (let n = 1; n <= 55; n += 1)
          next = withFeed(next, {
            at: NOW - (60 - n) * 60_000,
            kind: "note",
            who: "aven",
            text: `Entry ${n}`,
          });
        return next;
      });
      await openActivity();
      const shown = () => document.querySelectorAll(".crew-feed-entry").length;
      expect(shown()).toBe(40);
      expect(feed().textContent).toContain("Entry 55");
      expect(feed().textContent).not.toContain("Entry 5\n");
      await act(async () =>
        document
          .querySelector<HTMLButtonElement>("[data-crew-feed-earlier]")!
          .click(),
      );
      expect(shown()).toBeGreaterThanOrEqual(55);
      expect(document.querySelector("[data-crew-feed-earlier]")).toBeNull();
    });
  });

  it("Apply on a Ready card applies it; Review opens what changed and what was checked", async () => {
    const boards = await setUp(
      (boards) => (crew) => withCard(crew, crewCardFor(boards[3], "ready")),
    );
    const ready = card(boards[3].id);
    await act(async () => button(ready, "Apply")!.click());
    expect(actions.applyCrewCard).toHaveBeenCalledWith(PROJECT, boards[3].id);
    await act(async () => button(ready, "Review")!.click());
    const sheet = document.querySelector<HTMLElement>(
      `[data-crew-ready="${boards[3].id}"]`,
    )!;
    expect(sheet.textContent).toContain("What changed · 2 files +14 −3");
    expect(sheet.textContent).toContain("pnpm test · 48 passed");
    expect(sheet.textContent).toContain("Follow the system setting");
    expect(button(sheet, "Add as idea")).toBeTruthy();
    expect(sheet.textContent).toContain(
      "Applies to your files only when you press Apply.",
    );
  });

  it("a Ready card that passed Security says so, with what it checked", async () => {
    const boards = await setUp((boards) => (crew) => {
      const ready = crewCardFor(boards[3], "ready");
      return withCard(crew, {
        ...ready,
        rounds: ready.rounds.map((round) =>
          round.n === ready.round
            ? {
                ...round,
                security: {
                  pass: true,
                  summary: "No secrets or injection.",
                  mustFix: [],
                  later: [],
                  ran: [
                    { command: "Read the change for secrets", ok: true },
                    { command: "Checked the new fetch for SSRF", ok: true },
                  ],
                },
              }
            : round,
        ),
      });
    });
    const ready = card(boards[3].id);
    expect(
      [...ready.querySelectorAll<HTMLElement>(".crew-pipe-step")].map(
        (step) => step.dataset.state,
      ),
    ).toEqual(["done", "done", "done", "now"]);
    await act(async () => button(ready, "Review")!.click());
    const sheet = document.querySelector<HTMLElement>(
      `[data-crew-ready="${boards[3].id}"]`,
    )!;
    expect(sheet.textContent).toContain("pnpm test · 48 passed");
    const security = sheet.querySelector<HTMLElement>(
      "[data-crew-security-check]",
    )!;
    expect(security.textContent).toContain("Security: passed");
    expect(security.textContent).toContain("Checked the new fetch for SSRF");
    expect(document.querySelector(".crew-sheet")?.textContent ?? "").toContain(
      "security review in round",
    );
  });

  it("offers a Stuck card's ways on, and asks before throwing it away", async () => {
    const boards = await setUp(
      (boards) => (crew) => withCard(crew, crewCardFor(boards[4], "stuck")),
    );
    const stuck = card(boards[4].id);
    // In progress, with why, waiting on you.
    expect(
      container.querySelector('[aria-label="In progress"]')!.contains(stuck),
    ).toBe(true);
    expect(stuck.hasAttribute("data-needs-you")).toBe(true);
    expect(stuck.querySelector(".crew-pipe-row-status")?.textContent).toBe(
      "Stuck after 3 rounds",
    );
    await act(async () => button(stuck, "One more round")!.click());
    expect(actions.resumeCrewCard).toHaveBeenCalledWith(PROJECT, boards[4].id);
    // The other ways on are in its ⋯.
    const more = () =>
      act(async () =>
        stuck.querySelector<HTMLButtonElement>(".crew-pipe-more")!.click(),
      );
    await more();
    expect(
      [...document.querySelectorAll("[data-menu] button")].map(
        (item) => item.textContent,
      ),
    ).toEqual([
      "Take over in a chat",
      "Back to Ideas",
      "Throw away",
      "Edit or delete…",
    ]);
    await act(async () =>
      button(document.querySelector("[data-menu]")!, "Back to Ideas")!.click(),
    );
    expect(actions.discardCrewCard).toHaveBeenCalledWith(
      PROJECT,
      boards[4].id,
      "ideas",
    );
    await more();
    await act(async () =>
      button(document.querySelector("[data-menu]")!, "Throw away")!.click(),
    );
    expect(actions.discardCrewCard).toHaveBeenCalledTimes(1);
    await act(async () =>
      button(
        document.querySelector("[data-confirm-dialog]")!,
        "Confirm",
      )!.click(),
    );
    expect(actions.discardCrewCard).toHaveBeenLastCalledWith(
      PROJECT,
      boards[4].id,
      "delete",
    );
  });

  it("answers the Builder's question on the card", async () => {
    const boards = await setUp(
      (boards) => (crew) => withCard(crew, crewCardFor(boards[2], "question")),
    );
    const asking = card(boards[2].id);
    expect(asking.querySelector(".crew-pipe-row-status")?.textContent).toBe(
      "Builder asked: Keep each note's colour?",
    );
    await act(async () => button(asking, "Answer")!.click());
    const box = asking.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(box, "Yes, keep them.");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button(asking, "Send")!.click());
    expect(actions.resumeCrewCard).toHaveBeenCalledWith(
      PROJECT,
      boards[2].id,
      "Yes, keep them.",
    );
  });

  it("pauses or stops a card from its menu", async () => {
    const boards = await setUp(
      (boards) => (crew) => withCard(crew, crewCardFor(boards[2], "fixing")),
    );
    const fixing = card(boards[2].id);
    await act(async () =>
      fixing.querySelector<HTMLButtonElement>(".crew-pipe-more")!.click(),
    );
    const menu = container.querySelector<HTMLElement>("[data-menu]")!;
    await act(async () => button(menu, "Pause this card")!.click());
    expect(actions.setCrewCardPaused).toHaveBeenCalledWith(
      PROJECT,
      boards[2].id,
      true,
    );
    await act(async () =>
      fixing.querySelector<HTMLButtonElement>(".crew-pipe-more")!.click(),
    );
    await act(async () =>
      button(container.querySelector("[data-menu]")!, "Stop now")!.click(),
    );
    expect(actions.stopCrewCard).toHaveBeenCalledWith(PROJECT, boards[2].id);
  });

  it("says why a limit holds the crew, with a way on", async () => {
    await setUp(
      (boards) => (crew) =>
        withCard(
          { ...crew, runs: { day: localDay(NOW), count: 20 } },
          crewCardFor(boards[5], "queued"),
        ),
    );
    expect(container.querySelector("[data-crew-sentence]")?.textContent).toBe(
      "Today's 20 runs are used: Empty state for notes waits.",
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="More for the crew"]')!
        .click(),
    );
    await act(async () =>
      button(
        container.querySelector("[data-crew-header] [data-menu]")!,
        "Allow 10 more today",
      )!.click(),
    );
    expect(getCrew(PROJECT)!.extra?.count).toBe(10);
  });

  /** Type in Tell the crew… and send it. */
  const tell = async (text: string) => {
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Tell the crew"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      input.form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    await settle();
  };
  /** The Feed's words: in Activity, from the footer. */
  const feedText = async () => {
    if (!document.querySelector("[data-crew-feed]"))
      await act(async () =>
        button(
          document.querySelector("[data-crew-foot]")!,
          "Activity ›",
        )!.click(),
      );
    return document.querySelector("[data-crew-feed]")!.textContent ?? "";
  };
  /** How the crew takes the next message: a card, a rule or a goal. */
  const mode = async (label: string) => {
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(".crew-pipe-ask-mode")!
        .click(),
    );
    await act(async () =>
      button(document.querySelector("[data-menu]")!, label)!.click(),
    );
  };

  it("keeps what you tell the crew as standing guidance with Remember for every card", async () => {
    await setUp(() => (crew) => crew);
    const word = () =>
      container.querySelector<HTMLElement>(".crew-pipe-ask-mode")!.dataset.mode;
    expect(word()).toBe("card");
    await mode("Remember for every card");
    expect(word()).toBe("rule");
    await tell("Use pnpm, not npm.");
    expect(getCrew(PROJECT)!.notes.map((note) => note.text)).toEqual([
      "Use pnpm, not npm.",
    ]);
    // No card for a rule, and the next message is a card again.
    expect(getCrew(PROJECT)!.cards).toEqual([]);
    expect(word()).toBe("card");
    expect(await feedText()).toContain("You told the crew · standing");
  });

  it("makes a goal the crew keeps going towards, from the box or ⋯", async () => {
    await setUp(() => (crew) => crew);
    await mode("Make it a goal");
    await tell("Build the whole Pom app");
    expect(getCrew(PROJECT)!.goal).toMatchObject({
      text: "Build the whole Pom app",
    });
    expect(getCrew(PROJECT)!.cards).toEqual([]);
    const goal = container.querySelector<HTMLElement>("[data-crew-goal]")!;
    expect(goal.dataset.crewGoal).toBe("on");
    expect(goal.textContent).toBe(
      "Goal Build the whole Pom app · the crew keeps going",
    );
    expect(container.querySelector("[data-crew-sentence]")?.textContent).toBe(
      "Planning the next card for the goal.",
    );
    // A goal it stopped at: Keep going picks it up again.
    await act(async () =>
      updateCrew(PROJECT, (crew) => ({
        ...crew,
        goal: {
          ...crew.goal!,
          done: { at: NOW, text: "Nothing left to plan.", met: false },
        },
      })),
    );
    await act(async () =>
      button(
        container.querySelector("[data-crew-goal]")!,
        "Keep going",
      )!.click(),
    );
    expect(getCrew(PROJECT)!.goal?.done).toBeUndefined();
    // ⋯ → Clear the goal.
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="More for the crew"]')!
        .click(),
    );
    await act(async () =>
      button(
        container.querySelector("[data-crew-header] [data-menu]")!,
        "Clear the goal",
      )!.click(),
    );
    expect(getCrew(PROJECT)!.goal).toBeUndefined();
  });

  it("gives the crew what you tell it as a card to build", async () => {
    await setUp(() => (crew) => crew);
    await tell("build a timer screen");
    const crew = getCrew(PROJECT)!;
    expect(crew.notes).toEqual([]);
    expect(crew.cards).toHaveLength(1);
    expect(crew.cards[0]).toMatchObject({
      title: "Build a timer screen",
      stage: "queued",
      from: "you",
    });
    // Up next, with its path ahead of it, and in the Feed.
    const given = card(crew.cards[0].id);
    expect(
      container.querySelector('[aria-label="Up next"]')!.contains(given),
    ).toBe(true);
    expect(given.querySelector(".crew-pipe-row-status")?.textContent).toBe(
      "From you · next up",
    );
    expect(container.querySelector("[data-crew-sentence]")?.textContent).toBe(
      "Starting Build a timer screen.",
    );
    expect(await feedText()).toContain(
      "You gave the crew “Build a timer screen”",
    );
  });

  it("answers a nudge with nothing to build instead of making a vague card", async () => {
    // "go" was a standing note before Tell the crew… made cards: it stays.
    await setUp(() => (crew) => withNote(crew, "go", NOW - 60_000));
    await tell("go");
    const crew = getCrew(PROJECT)!;
    expect(crew.cards).toEqual([]);
    expect(crew.notes.map((note) => note.text)).toEqual(["go"]);
    expect(crew.feed.at(-1)).toMatchObject({
      who: "aven",
      text: "Tell the crew what to build, or add an idea.",
    });
    // Only the note you kept is standing, not the "go" you just sent.
    expect((await feedText()).match(/· standing/g)).toHaveLength(1);
    expect(
      [...document.querySelectorAll(".crew-feed-unpin")].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Stop telling the crew this"]);
  });

  it("a nudge tries a stopped card again", async () => {
    const boards = await setUp(
      (boards) => (crew) =>
        withCard(crew, {
          ...crewCardFor(boards[4], "stuck"),
          stuck: { reason: "stopped", text: "You stopped it" },
        }),
    );
    await tell("keep going");
    const crew = getCrew(PROJECT)!;
    expect(crew.cards).toHaveLength(1);
    expect(crewCard(crew, boards[4].id)?.stage).toBe("building");
    expect(crew.feed.at(-1)?.text).toBe(`Trying “${boards[4].title}” again`);
  });

  it("says when the crew has nothing to build, with a Scout to add", async () => {
    const openSettings = vi.fn();
    const uninstall = installCrewWorkspace({
      openChat: vi.fn(),
      openCrew: vi.fn(),
      openSettings,
      stop: vi.fn(async () => undefined),
    });
    try {
      await setUp(() => (crew) => crew);
      const sentence = () =>
        container.querySelector<HTMLElement>("[data-crew-sentence]")!;
      expect(sentence().textContent).toBe(
        "Nothing to build. Tell the crew what to do, or add an idea. Add a Scout to suggest ideas",
      );
      await act(async () =>
        button(sentence(), "Add a Scout to suggest ideas")!.click(),
      );
      expect(openSettings).toHaveBeenCalledWith(PROJECT, "add");
      // A member's mark opens its settings.
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>('[data-crew-tile="checker"]')!
          .click(),
      );
      expect(openSettings).toHaveBeenLastCalledWith(PROJECT, "checker");
      // With a Scout, no link; with work, another sentence.
      await act(async () =>
        updateCrew(PROJECT, (crew) => ({
          ...crew,
          members: [...crew.members, { id: "scout", role: "scout" }],
        })),
      );
      expect(sentence().textContent).toBe(
        "Nothing to build. Tell the crew what to do, or add an idea.",
      );
      await act(async () =>
        updateCrew(PROJECT, (crew) =>
          withCard(
            crew,
            queueCard(
              {
                id: "c1",
                title: "Timer",
                brief: "x",
                from: "you",
                maxRounds: 3,
              },
              NOW,
            ),
          ),
        ),
      );
      expect(sentence().textContent).toBe("Starting Timer.");
    } finally {
      uninstall();
    }
  });

  it("lets you take a Queued card back to Ideas with Not now", async () => {
    const boards = await setUp(
      (boards) => (crew) => withCard(crew, crewCardFor(boards[5], "queued")),
    );
    const queued = card(boards[5].id);
    await act(async () => button(queued, "Not now")!.click());
    expect(actions.discardCrewCard).toHaveBeenCalledWith(
      PROJECT,
      boards[5].id,
      "ideas",
    );
  });

  it("Delete on a card the crew has throws its crew card away too", async () => {
    const boards = await setUp(
      (boards) => (crew) => withCard(crew, crewCardFor(boards[5], "queued")),
    );
    await act(async () =>
      card(boards[5].id)
        .querySelector<HTMLButtonElement>(".crew-pipe-more")!
        .click(),
    );
    await act(async () =>
      button(container.querySelector("[data-menu]")!, "Delete")!.click(),
    );
    const dialog = document.querySelector<HTMLElement>(
      '[data-confirm-dialog="Delete this card?"]',
    )!;
    expect(dialog.textContent).toContain("It leaves the crew's queue too.");
    await act(async () => button(dialog, "Confirm")!.click());
    await settle();
    expect(crewCard(getCrew(PROJECT)!, boards[5].id)?.stage).toBe("discarded");
    expect(
      container.querySelector(`[data-board-card="${boards[5].id}"]`),
    ).toBeNull();
  });

  it("offers no Move to… for a card the crew places by its stage", () => {
    const board = {
      id: "b1",
      title: "Dark mode toggle",
      column: "building",
    } as Parameters<typeof cardMenuItems>[0];
    const live = crewCardFor(
      { id: "b1", title: "Dark mode toggle" } as FeatureCard,
      "fixing",
    );
    const labels = (held?: CrewCard) =>
      cardMenuItems(board, held).flatMap((item) =>
        item.kind === "item" ? [item.label] : [],
      );
    expect(labels(live).some((label) => label.startsWith("Move to"))).toBe(
      false,
    );
    expect(labels(live)).toContain("Delete");
    // A card the crew is done with moves like any other.
    expect(labels({ ...live, stage: "applied" })).toContain("Move to Ideas");
    expect(labels()).toContain("Move to Ideas");
  });

  it("never lifts a crew's row when you drag it", async () => {
    const boards = await setUp(
      (boards) => (crew) => withCard(crew, crewCardFor(boards[2], "fixing")),
    );
    const pointer = (type: string, clientX: number) =>
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientX,
        clientY: 50,
      });
    const row = card(boards[2].id);
    await act(async () => {
      row
        .querySelector(".crew-pipe-row-title")!
        .dispatchEvent(pointer("pointerdown", 50));
      window.dispatchEvent(pointer("pointermove", 60));
      window.dispatchEvent(pointer("pointermove", 200));
      window.dispatchEvent(pointer("pointerup", 200));
    });
    expect(row.hasAttribute("data-dragging")).toBe(false);
  });

  it("says when the all-crews ceiling holds the crew", async () => {
    setCrewsAllRunsPerDay(5);
    await setUp(
      (boards) => (crew) => withCard(crew, crewCardFor(boards[5], "queued")),
    );
    expect(container.querySelector("[data-crew-sentence]")?.textContent).toBe(
      "All crews' 5 runs today are used: Empty state for notes waits.",
    );
  });

  it("asks before throwing a Ready card away from its sheet", async () => {
    const boards = await setUp(
      (boards) => (crew) => withCard(crew, crewCardFor(boards[3], "ready")),
    );
    await act(async () => button(card(boards[3].id), "Review")!.click());
    const sheet = document.querySelector<HTMLElement>(
      `[data-crew-ready="${boards[3].id}"]`,
    )!;
    await act(async () =>
      sheet
        .querySelector<HTMLButtonElement>('[aria-label="More for this card"]')!
        .click(),
    );
    await act(async () =>
      button(document.querySelector("[data-menu]")!, "Throw away")!.click(),
    );
    expect(actions.discardCrewCard).not.toHaveBeenCalled();
    const confirm = document.querySelector<HTMLElement>(
      "[data-crew-throw-confirm]",
    )!;
    expect(confirm.textContent).toContain("is thrown away");
    await act(async () => button(confirm, "Throw away")!.click());
    expect(actions.discardCrewCard).toHaveBeenCalledWith(
      PROJECT,
      boards[3].id,
      "delete",
    );
  });

  it("shows why a Ready card couldn't go back to Ideas", async () => {
    actions.discardCrewCard.mockResolvedValueOnce("The copy is busy.");
    const boards = await setUp(
      (boards) => (crew) => withCard(crew, crewCardFor(boards[3], "ready")),
    );
    await act(async () => button(card(boards[3].id), "Review")!.click());
    const sheet = () =>
      document.querySelector<HTMLElement>(
        `[data-crew-ready="${boards[3].id}"]`,
      );
    await act(async () =>
      sheet()!
        .querySelector<HTMLButtonElement>('[aria-label="More for this card"]')!
        .click(),
    );
    await act(async () =>
      button(document.querySelector("[data-menu]")!, "Back to Ideas")!.click(),
    );
    await settle();
    expect(sheet()?.querySelector('[role="alert"]')?.textContent).toBe(
      "The copy is busy.",
    );
  });

  it("asks before turning the crew off from its header", async () => {
    await setUp(() => (crew) => crew);
    const header = container.querySelector<HTMLElement>("[data-crew-header]")!;
    await act(async () =>
      header
        .querySelector<HTMLButtonElement>('[aria-label="More for the crew"]')!
        .click(),
    );
    await act(async () =>
      button(
        header.querySelector("[data-menu]")!,
        "Turn the crew off",
      )!.click(),
    );
    expect(getCrew(PROJECT)!.on).toBe(true);
    const dialog = document.querySelector<HTMLElement>(
      '[data-confirm-dialog="Turn the crew off?"]',
    )!;
    await act(async () => button(dialog, "Confirm")!.click());
    await settle();
    expect(getCrew(PROJECT)!.on).toBe(false);
  });

  it("puts the cursor in Tell the crew when asked from elsewhere", async () => {
    await setUp(() => (crew) => crew);
    await act(async () => focusCrewTell(PROJECT));
    await act(
      async () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(document.activeElement).toBe(
      container.querySelector('input[aria-label="Tell the crew"]'),
    );
  });

  it("warns that Delete throws away the crew's Ready change, even while the crew is off", async () => {
    const boards = await setUp((boards) => (crew) => ({
      ...withCard(crew, crewCardFor(boards[3], "ready")),
      on: false,
    }));
    // A plain board: no crew face on the card, yet the crew still has it.
    expect(container.querySelector("[data-crew-header]")).toBeNull();
    await act(async () =>
      card(boards[3].id)
        .querySelector<HTMLButtonElement>(".work-board-card-more")!
        .click(),
    );
    await act(async () =>
      button(container.querySelector("[data-menu]")!, "Delete")!.click(),
    );
    const dialog = document.querySelector<HTMLElement>(
      '[data-confirm-dialog="Delete this card?"]',
    )!;
    expect(dialog.textContent).toContain(
      "The crew's Ready change is thrown away too.",
    );
    // An ordinary card's Delete says nothing about the crew.
    await act(async () =>
      card(boards[0].id)
        .querySelector<HTMLButtonElement>(".work-board-card-more")!
        .click(),
    );
    await act(async () =>
      button(container.querySelector("[data-menu]")!, "Delete")!.click(),
    );
    expect(
      document.querySelector('[data-confirm-dialog="Delete this card?"]')!
        .textContent,
    ).not.toContain("crew");
  });

  it("shows the crew's branch as one batch: Review, Apply all, and a way past a conflict", async () => {
    const boards = await setUp((boards) => (crew) => {
      const stack = (board: FeatureCard, parent: string, commit: string) => ({
        ...crewCardFor(board, "ready"),
        stacked: { commit, parent },
      });
      let next = withCard(
        crew,
        stack(boards[3], "a".repeat(40), "1".repeat(40)),
      );
      next = withCard(next, stack(boards[4], "1".repeat(40), "2".repeat(40)));
      return { ...next, stack: { base: "a".repeat(40) } };
    });
    const batch = container.querySelector<HTMLElement>("[data-crew-batch]")!;
    expect(
      container.querySelector('[aria-label="Ready for you"]')!.contains(batch),
    ).toBe(true);
    expect(batch.querySelector(".crew-pipe-row-title")?.textContent).toBe(
      "2 cards ready on the crew's branch",
    );
    expect(batch.querySelector(".crew-pipe-row-status")?.textContent).toBe(
      `${boards[3].title} · ${boards[4].title} · 1 file · checked`,
    );
    // Its cards aren't rows of their own.
    expect(card(boards[3].id)).toBeNull();
    expect(container.querySelector("[data-crew-sentence]")?.textContent).toBe(
      "2 cards wait for you.",
    );
    await settle();
    // Apply all lands exactly the range the row read: its last commit and
    // fingerprint, never whatever is on the branch by the time it lands.
    await act(async () => button(batch, "Apply all")!.click());
    expect(actions.applyCrewBatch).toHaveBeenCalledWith(PROJECT, {
      to: "2".repeat(40),
      hash: "h-reviewed",
    });
    // Your files moved on: Update onto your files replays the branch.
    await act(async () =>
      updateCrew(PROJECT, (crew) => ({
        ...crew,
        stack: {
          ...crew.stack!,
          conflict:
            "Your files changed where the crew worked, so nothing was applied. Update the crew's branch onto your files, then Apply again.",
        },
      })),
    );
    await act(async () =>
      button(
        container.querySelector("[data-crew-batch]")!,
        "Update onto your files",
      )!.click(),
    );
    expect(actions.restackCrew).toHaveBeenCalledWith(PROJECT);
    // Review: the combined change, each card, Apply up to one of them.
    await act(async () =>
      button(container.querySelector("[data-crew-batch]")!, "Review")!.click(),
    );
    await settle();
    const sheet = document.querySelector<HTMLElement>(
      "[data-crew-batch-review]",
    )!;
    expect(sheet.textContent).toContain("Each card, checked on its own");
    expect(sheet.textContent).toContain(boards[3].title);
    await act(async () => button(sheet, "Apply up to here")!.click());
    await settle();
    expect(actions.reviewCrewBatch).toHaveBeenLastCalledWith(
      PROJECT,
      boards[3].id,
    );
    // The sheet's Apply lands exactly the change it showed.
    await act(async () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".crew-sheet-actions button",
        ),
      ]
        .at(-1)!
        .click(),
    );
    expect(actions.applyCrewBatch).toHaveBeenLastCalledWith(PROJECT, {
      to: "1".repeat(40),
      hash: "h-reviewed",
      reviewed: true,
    });
  });

  it("names every file Review would land, with links, programs and binary files", async () => {
    const files = Array.from({ length: 45 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      status: "added" as const,
      additions: 1,
      deletions: 0,
      binary: false,
      oldMode: "000000",
      newMode: "100644",
    }));
    files.push(
      {
        path: "keys",
        status: "added",
        additions: 0,
        deletions: 0,
        binary: false,
        oldMode: "000000",
        newMode: "120000",
        linkTarget: "/Users/me/.ssh",
      } as never,
      {
        path: "scripts/run.sh",
        status: "modified",
        additions: 0,
        deletions: 0,
        binary: false,
        oldMode: "100644",
        newMode: "100755",
      } as never,
      {
        path: "logo.png",
        status: "added",
        additions: 0,
        deletions: 0,
        binary: true,
        oldMode: "000000",
        newMode: "100644",
      } as never,
    );
    const usual = actions.reviewCrewBatch.getMockImplementation()!;
    actions.reviewCrewBatch.mockImplementation(
      async () =>
        ({
          diff: { files, additions: 45, deletions: 0, hash: "h-all" },
          from: "a".repeat(40),
          to: "1".repeat(40),
          cards: [],
        }) as never,
    );
    onTestFinished(() => {
      actions.reviewCrewBatch.mockImplementation(usual);
    });
    await setUp((boards) => (crew) => ({
      ...withCard(crew, {
        ...crewCardFor(boards[3], "ready"),
        stacked: { commit: "1".repeat(40), parent: "a".repeat(40) },
      }),
      stack: { base: "a".repeat(40) },
    }));
    await settle();
    await act(async () =>
      button(container.querySelector("[data-crew-batch]")!, "Review")!.click(),
    );
    await settle();
    const list = document.querySelector<HTMLElement>(
      "[data-crew-batch-files]",
    )!;
    expect(list.querySelectorAll("li")).toHaveLength(48);
    expect(list.textContent).toContain("src/file-44.ts");
    expect(list.textContent).toContain("keys");
    expect(list.textContent).toContain("a link to /Users/me/.ssh");
    expect(list.textContent).toContain("runs as a program");
    expect(list.textContent).toContain("logo.png");
    expect(list.textContent).toContain("binary");
  });

  it("sends a replayed batch's Apply through Review, and opens Review from the Inbox", async () => {
    await setUp((boards) => (crew) => ({
      ...withCard(crew, {
        ...crewCardFor(boards[3], "ready"),
        stacked: {
          commit: "1".repeat(40),
          parent: "a".repeat(40),
          hash: "r",
          replayed: true,
        },
      }),
      stack: { base: "a".repeat(40) },
    }));
    await settle();
    const batch = container.querySelector<HTMLElement>("[data-crew-batch]")!;
    expect(batch.textContent).toContain(
      "replayed onto your files, not re-checked",
    );
    expect(button(batch, "Apply all")).toBeUndefined();
    await act(async () => button(batch, "Review to apply")!.click());
    await settle();
    expect(document.querySelector("[data-crew-batch-review]")).not.toBeNull();
  });

  it("never applies the previous selection while the next one is read", async () => {
    const C1 = "1".repeat(40);
    const C2 = "2".repeat(40);
    let release: (() => void) | null = null;
    const usual = actions.reviewCrewBatch.getMockImplementation()!;
    actions.reviewCrewBatch.mockImplementation((async (
      _project: string,
      upTo?: string,
    ) => {
      // Up to one card: read slowly, so the old review would still show.
      if (upTo) await new Promise<void>((resolve) => (release = resolve));
      return {
        diff: {
          files: [],
          additions: 0,
          deletions: 0,
          hash: upTo ? "h-one" : "h-all",
        },
        from: "a".repeat(40),
        to: upTo ? C1 : C2,
        cards: [],
      };
    }) as never);
    onTestFinished(() => {
      actions.reviewCrewBatch.mockImplementation(usual);
    });
    await setUp((boards) => (crew) => {
      let next = withCard(crew, {
        ...crewCardFor(boards[3], "ready"),
        stacked: { commit: C1, parent: "a".repeat(40) },
      });
      next = withCard(next, {
        ...crewCardFor(boards[4], "ready"),
        stacked: { commit: C2, parent: C1 },
      });
      return { ...next, stack: { base: "a".repeat(40) } };
    });
    await settle();
    await act(async () =>
      button(container.querySelector("[data-crew-batch]")!, "Review")!.click(),
    );
    await settle();
    const sheet = () =>
      document.querySelector<HTMLElement>("[data-crew-batch-review]")!;
    const applyButton = () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".crew-sheet-actions button",
        ),
      ].at(-1)!;
    expect(applyButton().disabled).toBe(false);
    await act(async () => button(sheet(), "Apply up to here")!.click());
    await settle();
    // Still reading the selection: the whole batch's review is gone.
    expect(applyButton().disabled).toBe(true);
    await act(async () => applyButton().click());
    expect(actions.applyCrewBatch).not.toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ to: C2 }),
    );
    await act(async () => release!());
    await settle();
    expect(applyButton().disabled).toBe(false);
    await act(async () => applyButton().click());
    expect(actions.applyCrewBatch).toHaveBeenLastCalledWith(PROJECT, {
      to: C1,
      hash: "h-one",
      reviewed: true,
    });
  });

  it("doesn't open Review by itself later when the Inbox asked with nothing to review", async () => {
    await setUp(() => (crew) => crew);
    await act(async () => requestCrewReview(PROJECT));
    await settle();
    expect(document.querySelector("[data-crew-batch-review]")).toBeNull();
    // A batch arrives later: it waits for your Review, never opens by itself.
    await act(async () =>
      updateCrew(PROJECT, (crew) => ({
        ...withCard(crew, {
          ...crewCardFor(
            {
              id: "late",
              title: "Late",
              column: "review",
              chatIds: [],
              createdAt: 1,
              updatedAt: 1,
              movedAt: 1,
            } as FeatureCard,
            "ready",
          ),
          stacked: { commit: "1".repeat(40), parent: "a".repeat(40) },
        }),
        stack: { base: "a".repeat(40) },
      })),
    );
    await settle();
    expect(document.querySelector("[data-crew-batch]")).not.toBeNull();
    expect(document.querySelector("[data-crew-batch-review]")).toBeNull();
  });

  it("opens the batch's Review when the Inbox asks", async () => {
    await setUp((boards) => (crew) => ({
      ...withCard(crew, {
        ...crewCardFor(boards[3], "ready"),
        stacked: { commit: "1".repeat(40), parent: "a".repeat(40) },
      }),
      stack: { base: "a".repeat(40) },
    }));
    expect(document.querySelector("[data-crew-batch-review]")).toBeNull();
    await act(async () => requestCrewReview(PROJECT));
    await settle();
    expect(document.querySelector("[data-crew-batch-review]")).not.toBeNull();
  });

  it("is a plain board while the crew is off", async () => {
    await setUp(() => (crew) => ({ ...crew, on: false }));
    expect(container.querySelector("[data-crew-header]")).toBeNull();
    expect(container.querySelector("[data-crew-feed]")).toBeNull();
    expect(container.textContent).not.toContain("Give to crew");
  });
});
