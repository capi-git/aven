// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterBuild, afterCheck, queueCard, startCard } from "../lib/crewLoop";
import {
  getCrew,
  resetCrewsCache,
  updateCrew,
  withCard,
  withFeed,
  withIdea,
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
import { WorkBoard } from "./WorkBoard";

const actions = vi.hoisted(() => ({
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
      onConfirm,
    }: {
      title: string;
      onConfirm: () => void;
    }) =>
      react.createElement(
        "div",
        { "data-confirm-dialog": title },
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

const names = { builder: "Beetle", checker: "Owl" };

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
const columnOf = (id: string) =>
  card(id).closest<HTMLElement>("[data-board-column]")!.dataset.boardColumn;
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
  it("has one header with plain-count limits, a strip of bots and the Feed", async () => {
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
    expect(header.querySelector("[data-crew-limits]")?.textContent).toBe(
      "7 of 20 runs today · one card at a time · quiet 11 pm–8 am · pauses at 80% of your week",
    );
    expect(button(header, "Pause")).toBeTruthy();
    // One header: the plain board title isn't stacked above it.
    expect(container.querySelectorAll("header.work-board-header")).toHaveLength(
      1,
    );
    expect(
      [...container.querySelectorAll("[data-crew-tile]")].map(
        (tile) => (tile as HTMLElement).dataset.crewTile,
      ),
    ).toEqual(["builder", "checker", "security"]);
    const feed = container.querySelector<HTMLElement>("[data-crew-feed]")!;
    expect(feed.textContent).toContain("Beetle → Owl · round 1");
    expect(feed.textContent).toContain(
      "A switch in Settings and a theme store.",
    );
  });

  it("shows each crew card's holder, stage and round dots in the right column", async () => {
    const boards = await setUp((boards) => (crew) => {
      let next = withCard(crew, crewCardFor(boards[2], "fixing"));
      next = withCard(next, crewCardFor(boards[3], "ready"));
      next = withCard(next, crewCardFor(boards[5], "queued"));
      return next;
    });
    const fixing = card(boards[2].id);
    expect(fixing.dataset.crewStage).toBe("Fixing");
    expect(fixing.querySelector(".crew-card-stage")?.textContent).toBe(
      "Fixing · round 2 of 3",
    );
    expect(fixing.querySelector('[aria-label="Round 2 of 3"]')).toBeTruthy();
    expect(fixing.querySelector(".crew-card-line")?.textContent).toBe(
      "Owl asked for 2 fixes · 4m",
    );
    expect(button(fixing, "Watch")).toBeTruthy();
    // The Ready card sits in Review, whatever its saved column said.
    expect(columnOf(boards[3].id)).toBe("review");
    const ready = card(boards[3].id);
    expect(ready.querySelector(".crew-card-stage")?.textContent).toBe(
      "Ready · passed in round 1",
    );
    expect(ready.querySelector(".crew-card-change")?.textContent).toBe(
      "2 files +14 −3",
    );
    expect(button(ready, "Review")).toBeTruthy();
    expect(
      card(boards[5].id).querySelector(".crew-card-stage")?.textContent,
    ).toBe("Queued · next up");
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
          ".work-board-card-actions button:not([data-crew-give-more])",
        ),
      ].map((item) => item.textContent),
    ).toEqual(["Build", "Give to crew"]);
    // ▾ beside it chooses who builds and checks it.
    expect(
      mine.querySelector("[data-crew-give-more]")?.getAttribute("aria-label"),
    ).toBe(`Choose who builds “${boards[0].title}”`);
    const scouted = card(boards[1].id);
    expect(scouted.querySelector(".crew-card-line")?.textContent).toBe(
      "From Fox · small",
    );
    expect(
      [
        ...scouted.querySelectorAll(
          ".work-board-card-actions button:not([data-crew-give-more])",
        ),
      ].map((item) => item.textContent),
    ).toEqual(["Give to crew", "Not now"]);
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
      card(boards[2].id).querySelector("[data-crew-assigned]")?.textContent,
    ).toBe("Mole builds · Owl checks · high · 2 rounds");
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
      container.querySelector<HTMLElement>("[data-crew-feed-scroll]")!;
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
      expect(feed().scrollTop).toBe(700);
      await add("A handoff");
      expect(feed().scrollTop).toBe(800);
      await add("A verdict");
      expect(feed().scrollTop).toBe(900);
      expect(container.querySelector("[data-crew-feed-new]")).toBeNull();
    });

    it("doesn't jump while you read further up; N new takes you down", async () => {
      await setUp(() => (crew) => crew);
      await scrollTo(120);
      await add("One");
      await add("Two");
      expect(feed().scrollTop).toBe(120);
      const pill = container.querySelector<HTMLButtonElement>(
        "[data-crew-feed-new]",
      )!;
      expect(pill.textContent).toBe("2 new ↓");
      await act(async () => pill.click());
      expect(feed().scrollTop).toBe(
        metrics.scrollHeight - metrics.clientHeight,
      );
      expect(container.querySelector("[data-crew-feed-new]")).toBeNull();
      // Reading again, then back to the bottom by hand: the pill goes.
      await scrollTo(0);
      await add("Three");
      expect(container.querySelector("[data-crew-feed-new]")).not.toBeNull();
      await scrollTo(metrics.scrollHeight);
      expect(container.querySelector("[data-crew-feed-new]")).toBeNull();
    });

    it("folds a long entry to a few lines with Show more", async () => {
      await setUp(() => (crew) => crew);
      const long = `Owl's turn didn't finish: ${"Codex couldn't be locked down here. ".repeat(12)}`;
      await add(long);
      const entry = [
        ...container.querySelectorAll<HTMLElement>(".crew-feed-entry"),
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
        ...container.querySelectorAll<HTMLElement>(".crew-feed-entry"),
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
      const shown = () => container.querySelectorAll(".crew-feed-entry").length;
      expect(shown()).toBe(40);
      expect(feed().textContent).toContain("Entry 55");
      expect(feed().textContent).not.toContain("Entry 5\n");
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>("[data-crew-feed-earlier]")!
          .click(),
      );
      expect(shown()).toBeGreaterThanOrEqual(55);
      expect(container.querySelector("[data-crew-feed-earlier]")).toBeNull();
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
    expect(ready.querySelector(".crew-card-line")?.textContent).toContain(
      "Owl passed it · Security: passed",
    );
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
    expect(stuck.hasAttribute("data-needs-you")).toBe(true);
    expect(stuck.querySelector(".crew-card-stage")?.textContent).toBe(
      "Needs you · Stuck after 3 rounds",
    );
    expect(
      [...stuck.querySelectorAll(".work-board-card-actions button")].map(
        (item) => item.textContent,
      ),
    ).toEqual([
      "One more round",
      "Take over in a chat",
      "Back to Ideas",
      "Throw away",
    ]);
    await act(async () => button(stuck, "One more round")!.click());
    expect(actions.resumeCrewCard).toHaveBeenCalledWith(PROJECT, boards[4].id);
    await act(async () => button(stuck, "Back to Ideas")!.click());
    expect(actions.discardCrewCard).toHaveBeenCalledWith(
      PROJECT,
      boards[4].id,
      "ideas",
    );
    await act(async () => button(stuck, "Throw away")!.click());
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
    expect(asking.querySelector(".crew-card-stage")?.textContent).toBe(
      "Needs you · Beetle asked: Keep each note's colour?",
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
      fixing.querySelector<HTMLButtonElement>(".work-board-card-more")!.click(),
    );
    const menu = container.querySelector<HTMLElement>("[data-menu]")!;
    await act(async () => button(menu, "Pause this card")!.click());
    expect(actions.setCrewCardPaused).toHaveBeenCalledWith(
      PROJECT,
      boards[2].id,
      true,
    );
    await act(async () =>
      fixing.querySelector<HTMLButtonElement>(".work-board-card-more")!.click(),
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
    const hold = container.querySelector<HTMLElement>("[data-crew-hold]")!;
    expect(hold.dataset.crewHold).toBe("daily-cap");
    expect(hold.textContent).toContain("Today's 20 runs are used");
    expect(hold.textContent).toContain(
      "Empty state for notes waits in Building.",
    );
    await act(async () => button(hold, "Allow 10 more today")!.click());
    expect(getCrew(PROJECT)!.extra?.count).toBe(10);
  });

  it("keeps what you tell the crew as standing guidance", async () => {
    await setUp(() => (crew) => crew);
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Tell the crew"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Use pnpm, not npm.");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      input.form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(getCrew(PROJECT)!.notes.map((note) => note.text)).toEqual([
      "Use pnpm, not npm.",
    ]);
    expect(container.querySelector("[data-crew-feed]")!.textContent).toContain(
      "You told the crew · standing",
    );
  });

  it("is a plain board while the crew is off", async () => {
    await setUp(() => (crew) => ({ ...crew, on: false }));
    expect(container.querySelector("[data-crew-header]")).toBeNull();
    expect(container.querySelector("[data-crew-feed]")).toBeNull();
    expect(container.textContent).not.toContain("Give to crew");
  });
});
