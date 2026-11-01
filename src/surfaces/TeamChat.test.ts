// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offersRestack } from "../hooks/useTeamPipeline";
import { afterBuild, afterCheck, queueCard, startCard } from "../lib/crewLoop";
import { installCrewWorkspace } from "../lib/crewActions";
import {
  resetCrewsCache,
  updateCrew,
  withCard,
  withFeed,
  withMessage,
  type Crew,
  type CrewCard,
} from "../lib/crews";
import { memoryStorage } from "../lib/devSmoke";
import {
  addFeatureCards,
  memoryFeatureCardBackend,
  setFeatureCardBackend,
  type FeatureCard,
} from "../lib/featureCards";
import { localDay, resetProjectBotsCache } from "../lib/projectBots";
import { TEAM_VIEW_KEY, resetTeamViewCache, teamView } from "../lib/teamView";
import {
  installWorkBoardActions,
  publishWorkBoardFeed,
  resetWorkBoardFeed,
} from "../lib/workBoardFeed";
import { WorkBoard } from "./WorkBoard";

const actions = vi.hoisted(() => ({
  applyCrewBatch: vi.fn(async () => null as string | null),
  restackCrew: vi.fn(async () => null as string | null),
  reviewCrewBatch: vi.fn(async () => ({
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
    to: "2".repeat(40),
    cards: [],
  })),
  tellTeam: vi.fn(async () => null as string | null),
  tellTeammate: vi.fn(async () => null as string | null),
}));
vi.mock("../lib/crewActions", async (original) => {
  const actual = await original<typeof import("../lib/crewActions")>();
  return { ...actual, ...actions };
});
vi.mock("../hooks/useProjectBots", () => ({ claudeWeeklyUsed: () => 40 }));
vi.mock("../chrome/ProjectMark", () => ({ ProjectMark: () => null }));

const PROJECT = "/work/pom";
const NOW = new Date(2026, 10, 1, 15, 0).getTime();
const names = { builder: "Builder", checker: "Checker" };

let root: Root;
let container: HTMLDivElement;
const workspace = {
  openChat: vi.fn(),
  openCrew: vi.fn(),
  openSettings: vi.fn(),
  stop: vi.fn(async () => undefined),
};
let uninstall: () => void;

async function settle() {
  await act(async () => {
    for (let round = 0; round < 4; round += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function readyCard(board: FeatureCard, parent: string, commit: string) {
  let card: CrewCard = {
    ...startCard(
      queueCard(
        {
          id: board.id,
          title: board.title,
          brief: board.title,
          from: "you",
          maxRounds: 3,
        },
        NOW - 60_000,
      ),
      NOW - 50_000,
    ),
    base: "base",
    builderId: "designer",
  };
  card = afterBuild(card, {
    handoff: { summary: "Done", howToCheck: [], ran: [] },
    change: {
      base: "base",
      hash: "h1",
      files: 3,
      additions: 14,
      deletions: 3,
      paths: [],
    },
    now: NOW - 40_000,
    names,
  }).card;
  card = afterCheck(card, {
    verdict: { pass: true, summary: "", mustFix: [], later: [], ran: [] },
    edited: false,
    now: NOW - 30_000,
    names,
  }).card;
  return { ...card, stacked: { commit, parent } };
}

/** Pom's team: five teammates, a card in check round 2, one ready card. */
async function setUp(
  more: (crew: Crew, boards: FeatureCard[]) => Crew = (c) => c,
) {
  const boards = await addFeatureCards(PROJECT, [
    { title: "Timer screen", column: "building" },
    { title: "Settings page", column: "review" },
  ]);
  updateCrew(PROJECT, (crew) => {
    let next: Crew = {
      ...crew,
      on: true,
      onAt: NOW - 3_600_000,
      runs: { day: localDay(NOW), count: 6 },
      members: [
        ...crew.members,
        {
          id: "designer",
          role: "builder",
          label: "Designer",
          critter: "designer",
        },
        { id: "scout", role: "scout" },
      ],
    };
    const timer: CrewCard = {
      ...startCard(
        queueCard(
          {
            id: boards[0]!.id,
            title: "Timer screen",
            brief: "Timer screen",
            from: "you",
            maxRounds: 3,
          },
          NOW - 600_000,
        ),
        NOW - 500_000,
      ),
      stage: "checking",
      holder: "checker",
      round: 2,
      turn: {
        role: "checker",
        sessionId: "s-checker",
        turnId: "t",
        sentAt: NOW - 60_000,
      },
    };
    next = withCard(next, timer);
    next = withCard(
      next,
      readyCard(boards[1]!, "a".repeat(40), "2".repeat(40)),
    );
    next = { ...next, stack: { base: "a".repeat(40) } };
    next = withFeed(next, {
      at: NOW - 30 * 60_000,
      kind: "idea",
      who: "scout",
      member: "scout",
      text: "Scout added 2 ideas: Haptics on finish · Keep the time",
    });
    next = withMessage(next, {
      at: NOW - 20 * 60_000,
      text: "Build a timer screen: start, pause, and a ring.",
      as: "card",
    });
    next = withFeed(next, {
      at: NOW - 20 * 60_000,
      kind: "note",
      who: "you",
      cardId: boards[0]!.id,
      title: "Timer screen",
      text: "You gave the team “Timer screen”",
    });
    next = withFeed(next, {
      at: NOW - 10 * 60_000,
      kind: "handoff",
      who: "builder",
      member: "builder",
      to: "checker",
      cardId: boards[0]!.id,
      title: "Timer screen",
      round: 1,
      text: "TimerView, the ring and a small store. 4 files, tests pass.",
    });
    next = withFeed(next, {
      at: NOW - 8 * 60_000,
      kind: "verdict",
      who: "checker",
      member: "checker",
      to: "builder",
      cardId: boards[0]!.id,
      title: "Timer screen",
      round: 1,
      text: "2 must-fix: the label is hard to read; the time resets",
    });
    return more(next, boards);
  });
  publishWorkBoardFeed({ chats: [], statuses: {}, teams: [] });
  await act(async () =>
    root.render(createElement(WorkBoard, { project: PROJECT, visible: true })),
  );
  await settle();
  return boards;
}

const chat = () => container.querySelector<HTMLElement>("[data-team-chat]")!;
const button = (scope: Element, name: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent === name,
  );
const box = () =>
  container.querySelector<HTMLTextAreaElement>(".team-compose-input")!;

async function type(text: string) {
  await act(async () => {
    const field = box();
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(field, text);
    field.setSelectionRange(text.length, text.length);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(key: string) {
  await act(async () => {
    box().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  resetCrewsCache();
  resetTeamViewCache();
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
  for (const fn of [...Object.values(actions), ...Object.values(workspace)])
    fn.mockClear();
  uninstall = installCrewWorkspace(workspace);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  uninstall();
  resetWorkBoardFeed();
  setFeatureCardBackend(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the team chat", () => {
  it("opens on Chat, and remembers Cards for this project", async () => {
    await setUp();
    expect(chat()).not.toBeNull();
    const header = container.querySelector<HTMLElement>("[data-crew-header]")!;
    expect(header.querySelector("h1")?.textContent).toBe("pom team");
    const cards = [
      ...header.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ].find((item) => item.textContent?.startsWith("Cards"))!;
    // The ready card and the one in check.
    expect(cards.textContent).toBe("Cards · 2");
    await act(async () => cards.click());
    expect(chat()).toBeNull();
    expect(container.querySelector("[data-crew-pipeline]")).not.toBeNull();
    expect(teamView(PROJECT)).toBe("cards");
    expect(localStorage.getItem(TEAM_VIEW_KEY)).toContain("cards");
  });

  it("lists Everyone, then each teammate with what it's doing, then Add teammate", async () => {
    await setUp();
    const rows = [...chat().querySelectorAll<HTMLElement>(".team-roster-item")];
    expect(
      rows.map(
        (row) => row.querySelector(".team-roster-name")?.textContent ?? "",
      ),
    ).toEqual([
      "Everyone",
      "Builder",
      "Designer",
      "Checker",
      "Security",
      "Scout",
      "Add teammate",
    ]);
    const checker = chat().querySelector<HTMLElement>(
      '[data-team-member="checker"]',
    )!;
    expect(checker.querySelector(".team-roster-line")?.textContent).toBe(
      "Checking Timer screen · round 2",
    );
    expect(checker.querySelector(".team-roster-when")?.textContent).toBe("now");
    // Its mark sweeps while it works; colour is the project's own.
    expect(checker.querySelector(".dot-mark")?.getAttribute("data-state")).toBe(
      "working",
    );
    expect(
      chat().querySelector('[data-team-member="security"] .team-roster-line')
        ?.textContent,
    ).toBe("Free");
    await act(async () =>
      chat().querySelector<HTMLButtonElement>("[data-team-add]")!.click(),
    );
    expect(workspace.openSettings).toHaveBeenCalledWith(PROJECT, "add");
  });

  it("reads the Feed as posts, with handoffs, your message and who's working now", async () => {
    await setUp();
    const thread = chat().querySelector<HTMLElement>("[data-team-thread]")!;
    const posts = [
      ...thread.querySelectorAll<HTMLElement>("[data-team-post]"),
    ].map((post) => post.dataset.teamPost);
    // The Feed's own "You gave the team…" is your message.
    expect(posts).toEqual(["scout", "you", "builder", "checker"]);
    expect(thread.querySelector(".team-day-label")?.textContent).toBe("Today");
    expect(
      thread.querySelector('[data-team-post="you"] .team-you-bubble')
        ?.textContent,
    ).toBe("Build a timer screen: start, pause, and a ring.");
    expect(
      [...thread.querySelectorAll("[data-team-handoff]")].map(
        (chip) => chip.textContent,
      ),
    ).toEqual(["Handed to Checker", "Back to Builder · round 2"]);
    expect(
      thread.querySelector('[data-team-live="checker"] .team-post-text')
        ?.textContent,
    ).toBe("Checking Timer screen · round 2…");
    expect(thread.textContent).not.toMatch(/[{}[\]]"/);
  });

  it("pins Ready for you on top, and Apply all lands exactly what Cards' row would", async () => {
    await setUp();
    const ready = chat().querySelector<HTMLElement>(
      '[data-team-ready="batch"]',
    )!;
    expect(ready.querySelector(".team-ready-line b")?.textContent).toBe(
      "Settings page",
    );
    expect(ready.querySelector(".team-ready-line span")?.textContent).toBe(
      "Designer · 1 file · checked",
    );
    await settle();
    await act(async () => button(ready, "Apply all")!.click());
    expect(actions.applyCrewBatch).toHaveBeenCalledWith(PROJECT, {
      to: "2".repeat(40),
      hash: "h-reviewed",
    });
    // Review opens the batch's own Review.
    await act(async () => button(ready, "Review")!.click());
    await settle();
    expect(document.querySelector("[data-crew-batch-review]")).not.toBeNull();
  });

  it("offers Update onto your files after a conflict, in old words too", () => {
    expect(
      offersRestack(
        "Your files changed where the crew worked, so nothing was applied. Update the crew's branch onto your files, then Apply again.",
      ),
    ).toBe(true);
    expect(
      offersRestack("Update the team's branch onto your files, then Apply."),
    ).toBe(true);
    expect(offersRestack("Something else went wrong")).toBe(false);
  });

  it("writes to everyone as a card by default, or a rule, and keeps the box's words on a problem", async () => {
    await setUp();
    await type("Add haptics when a timer ends");
    await press("Enter");
    expect(actions.tellTeam).toHaveBeenCalledWith(
      PROJECT,
      "Add haptics when a timer ends",
      "card",
    );
    expect(box().value).toBe("");
    // A rule for every card, from the small Card ▾ choice.
    await act(async () =>
      chat().querySelector<HTMLButtonElement>(".team-compose-mode")!.click(),
    );
    await act(async () =>
      button(document.body, "Remember for every card")!.click(),
    );
    expect(box().placeholder).toBe("A rule for every card, like “Use pnpm”…");
    actions.tellTeam.mockResolvedValueOnce("Turn the team on first.");
    await type("Use pnpm");
    await press("Enter");
    expect(actions.tellTeam).toHaveBeenLastCalledWith(
      PROJECT,
      "Use pnpm",
      "rule",
    );
    expect(chat().querySelector(".team-compose-problem")?.textContent).toBe(
      "Turn the team on first.",
    );
    expect(box().value).toBe("Use pnpm");
  });

  it("@ picks one teammate from the keyboard, and sends only to its chat", async () => {
    await setUp();
    await type("Please look at @ch");
    const list = () =>
      chat().querySelector<HTMLElement>('[role="listbox"][data-team-mention]');
    expect(
      [...list()!.querySelectorAll('[role="option"]')].map(
        (option) => option.querySelector(".team-mention-name")?.textContent,
      ),
    ).toEqual(["Checker"]);
    expect(box().getAttribute("aria-expanded")).toBe("true");
    await press("Enter");
    expect(list()).toBeNull();
    expect(box().value).toBe("Please look at ");
    expect(chat().querySelector(".team-compose-to")?.textContent).toBe(
      "@Checker",
    );
    await type("Please look at the ring in light mode");
    await press("Enter");
    expect(actions.tellTeammate).toHaveBeenCalledWith(
      PROJECT,
      "checker",
      "Please look at the ring in light mode",
    );
    expect(actions.tellTeam).not.toHaveBeenCalled();
    // Arrow keys move through the list; Escape closes it.
    await type("@");
    await press("ArrowDown");
    expect(
      list()!
        .querySelector('[aria-selected="true"]')
        ?.querySelector(".team-mention-name")?.textContent,
    ).toBe("Builder");
    await press("Escape");
    expect(list()).toBeNull();
  });

  it("shows one teammate's posts when you pick it, writes to it, and opens its chat", async () => {
    await setUp();
    await act(async () =>
      chat()
        .querySelector<HTMLButtonElement>(
          '[data-team-member="checker"] .team-roster-row',
        )!
        .click(),
    );
    const posts = [
      ...chat().querySelectorAll<HTMLElement>("[data-team-post]"),
    ].map((post) => post.dataset.teamPost);
    expect(posts).toEqual(["checker"]);
    expect(box().placeholder).toBe("Write to Checker…");
    await act(async () =>
      chat().querySelector<HTMLButtonElement>("[data-team-open-chat]")!.click(),
    );
    expect(workspace.openChat).toHaveBeenCalledWith(PROJECT, "checker");
    // Everyone again.
    await act(async () =>
      chat()
        .querySelector<HTMLButtonElement>(".team-roster-item .team-roster-row")!
        .click(),
    );
    expect(box().placeholder).toBe("Write to the team, or @ one teammate…");
  });

  it("keeps a long thread fast: the newest posts, and Show earlier for more", async () => {
    await setUp((crew) => {
      let next = crew;
      for (let index = 0; index < 150; index += 1)
        next = withFeed(next, {
          at: NOW - 5 * 60_000 + index,
          kind: "note",
          who: "aven",
          text: `Line ${index}`,
        });
      return next;
    });
    const shown = () => chat().querySelectorAll("[data-team-post]").length;
    expect(shown()).toBe(60);
    await act(async () => button(chat(), "Show earlier")!.click());
    expect(shown()).toBe(120);
  });
});
