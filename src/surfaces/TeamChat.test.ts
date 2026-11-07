// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offersRestack } from "../hooks/useTeamPipeline";
import { afterBuild, afterCheck, queueCard, startCard } from "../lib/crewLoop";
import { installCrewWorkspace } from "../lib/crewActions";
import {
  getCrew,
  resetCrewsCache,
  updateCrew,
  withCard,
  withFeed,
  withMessage,
  withoutMember,
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
import {
  TEAM_VIEW_KEY,
  resetTeamViewCache,
  setTeamView,
  teamView,
} from "../lib/teamView";
import { TOO_LONG_FOR_EVERYONE } from "../lib/crewActions";
import { setCrewLiveReply } from "../lib/crewLiveReply";
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
  openChat: vi.fn(async (): Promise<string | null> => null),
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
      copy: { path: "/copies/pom", branch: "aven/crew/pom", root: PROJECT },
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
      echo: "gave-timer",
    });
    next = withFeed(next, {
      id: "gave-timer",
      at: NOW - 20 * 60_000,
      kind: "note",
      who: "you",
      cardId: boards[0]!.id,
      title: "Timer screen",
      text: "You gave Avos “Timer screen”",
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

/** A scroller you've scrolled up in: 1000px of posts, 200px tall, at its top. */
function scrolledUp(element: HTMLElement) {
  let top = 0;
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: () => 1000,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => 200,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
  element.dispatchEvent(new Event("scroll"));
  return () => top;
}

/**
 * A scroller laid out as posts 50px tall in a 200px window, scrolled to its
 * top. Like WebKit, it doesn't keep your place when posts are added above.
 */
function layout(element: HTMLElement) {
  let top = 0;
  const height = () =>
    40 + 50 * element.querySelectorAll("[data-team-post]").length;
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: height,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => 200,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(value, height() - 200));
    },
  });
  element.dispatchEvent(new Event("scroll"));
  return { top: () => top, bottom: () => height() - 200 };
}

const thread = () => chat().querySelector<HTMLElement>("[data-team-thread]")!;
const pick = (id: string) =>
  act(async () =>
    container
      .querySelector<HTMLButtonElement>(`[data-avos-helper="${id}"]`)!
      .click(),
  );

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
  // The chat is always beside the panel; the roster is its Teammates tab.
  setTeamView(PROJECT, "chat");
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
  it("opens on the chat with Avos's profile beside it: no tabs, and no header over the chat", async () => {
    localStorage.removeItem(TEAM_VIEW_KEY);
    resetTeamViewCache();
    await setUp();
    expect(chat()).not.toBeNull();
    expect(container.querySelector("[data-team-board]")).toBeNull();
    expect(container.querySelector('[role="tab"]')).toBeNull();
    // A wide pane: the profile names Avos, so nothing over the chat does.
    expect(container.querySelector("[data-avos-bar]")).toBeNull();
    const profile = container.querySelector<HTMLElement>("[data-crew-header]")!;
    expect(profile.tagName).toBe("ASIDE");
    expect(profile.querySelector("h1")?.textContent).toBe("Avos");
    expect(
      profile.querySelector("[data-crew-sentence]")?.textContent,
    ).toBeTruthy();
    // Only what it has: no jobs or notes yet, so only who's helping.
    expect(
      [...profile.querySelectorAll("[data-avos-profile] h2")].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(["Helpers"]);
  });

  it("an old saved Changes, Notes or Sub agents view opens on the chat", async () => {
    localStorage.setItem(
      TEAM_VIEW_KEY,
      JSON.stringify({ [PROJECT.toLowerCase()]: "notes" }),
    );
    resetTeamViewCache();
    await setUp();
    expect(teamView(PROJECT)).toBe("chat");
    expect(chat().closest<HTMLElement>(".avos-body")!.hidden).toBe(false);
  });

  it("lists who's helping in Avos's profile: its dots while it works, nothing at rest, and a helper shows its posts", async () => {
    await setUp();
    const profile = container.querySelector<HTMLElement>("[data-crew-header]")!;
    const helpers = [
      ...profile.querySelectorAll<HTMLElement>("[data-avos-helper]"),
    ];
    expect(
      helpers.map((helper) => [
        helper.querySelector(".avos-profile-helper-name")?.textContent,
        helper.dataset.state,
        // Its own screen says it works: no dots box beside it.
        helper.querySelector<HTMLElement>(".agent-mark")?.dataset.agent,
        !!helper.querySelector(".helm-work-dots"),
        helper.querySelector(".avos-profile-helper-word")?.textContent ?? null,
      ]),
    ).toEqual([
      ["Builder", "resting", "resting", false, null],
      ["Designer", "resting", "resting", false, null],
      ["Checker", "working", "working", false, null],
      ["Security", "resting", "resting", false, null],
      ["Scout", "resting", "resting", false, null],
    ]);
    // What it's doing, under its name, while it works.
    expect(
      profile.querySelector(
        '[data-avos-helper="checker"] .avos-profile-helper-line',
      )?.textContent,
    ).toBe("Checking Timer screen · round 2");
    // The Checker's Bot types while it works, in the Checker's colour.
    const checker = profile.querySelector<HTMLElement>(
      '[data-avos-helper="checker"] .agent-mark',
    );
    expect(checker?.dataset.agent).toBe("working");
    expect(checker?.dataset.tone).toBe("purple");
    // Picking a helper shows its posts; Avos's message on what needs you
    // is for the whole chat, so it waits until you show everyone again.
    await pick("checker");
    expect(
      [...chat().querySelectorAll<HTMLElement>("[data-team-post]")].map(
        (post) => post.dataset.teamPost,
      ),
    ).toEqual(["checker"]);
    expect(chat().querySelector("[data-avos-for-you]")).toBeNull();
  });

  it("folds the profile into one header on a narrow pane, and Avos's name opens the rest in a sheet", async () => {
    const own = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    );
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("avos-screen") ? 560 : 0;
      },
    });
    try {
      await setUp();
      expect(container.querySelector("aside[data-crew-header]")).toBeNull();
      const bar = container.querySelector<HTMLElement>("[data-avos-bar]")!;
      expect(bar.querySelector(".avos-bar-name")?.textContent).toBe("Avos");
      expect(bar.querySelector(".avos-bar-line")?.textContent).toBeTruthy();
      expect(bar.querySelector('[aria-label="More for Avos"]')).not.toBeNull();
      await act(async () =>
        bar
          .querySelector<HTMLButtonElement>('[aria-label="Avos\'s profile"]')!
          .click(),
      );
      const sheet = document.querySelector<HTMLElement>(".avos-profile-sheet")!;
      expect(
        sheet.querySelector('[data-avos-profile="helpers"]'),
      ).not.toBeNull();
      // A helper there shows its posts, and the sheet goes.
      await act(async () =>
        sheet
          .querySelector<HTMLButtonElement>('[data-avos-helper="checker"]')!
          .click(),
      );
      expect(document.querySelector(".avos-profile-sheet")).toBeNull();
      expect(
        [...chat().querySelectorAll<HTMLElement>("[data-team-post]")].map(
          (post) => post.dataset.teamPost,
        ),
      ).toEqual(["checker"]);
    } finally {
      if (own) Object.defineProperty(HTMLElement.prototype, "clientWidth", own);
      else
        delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });

  it("reads the Feed as posts, with handoffs, your message and who's working now", async () => {
    await setUp();
    const thread = chat().querySelector<HTMLElement>("[data-team-thread]")!;
    const posts = [
      ...thread.querySelectorAll<HTMLElement>("[data-team-post]"),
    ].map((post) => post.dataset.teamPost);
    // The Feed's own "You gave Avos…" is your message.
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
      // Its working screen says it's still at it: no "…", no dots box.
    ).toBe("Checking Timer screen · round 2");
    expect(
      thread.querySelector<HTMLElement>(
        '[data-team-live="checker"] .agent-mark',
      )?.dataset.agent,
    ).toBe("working");
    expect(
      thread.querySelector('[data-team-live="checker"] .helm-work-dots'),
    ).toBeNull();
    expect(thread.textContent).not.toMatch(/[{}[\]]"/);
  });

  it("says what's ready as Avos's last message, and Apply all lands exactly the reviewed range", async () => {
    await setUp();
    const forYou = thread().querySelector<HTMLElement>("[data-avos-for-you]")!;
    // After everything else in the chat, as Avos's own message.
    expect(thread().lastElementChild).toBe(forYou);
    // Its words alone, as its other answers read: no mark or name.
    expect(forYou.querySelector(".team-post-head")).toBeNull();
    expect(forYou.querySelector(".agent-mark")).toBeNull();
    expect(forYou.querySelector(".team-post-text")?.textContent).toBe(
      "This is ready for you to look at.",
    );
    const ready = forYou.querySelector<HTMLElement>(
      '[data-avos-need="batch"]',
    )!;
    expect(ready.querySelector(".avos-ask-text b")?.textContent).toBe(
      "Settings page",
    );
    expect(ready.querySelector(".avos-ask-text span")?.textContent).toBe(
      "Designer · 1 file · checked",
    );
    expect(
      [...ready.querySelectorAll("button")].map((item) => item.textContent),
    ).toEqual(["Review", "Apply all"]);
    // Said once: not pinned over the chat, nor beside it.
    expect(container.querySelectorAll('[data-avos-need="batch"]')).toHaveLength(
      1,
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
      offersRestack("Update Avos's branch onto your files, then Apply."),
    ).toBe(true);
    expect(offersRestack("Something else went wrong")).toBe(false);
  });

  it("writes to everyone with no menu, and keeps the box's words on a problem", async () => {
    await setUp();
    // No choice of what a message is: Avos works it out (a team from before
    // Avos, with no Lead, takes it as a card).
    expect(chat().querySelector(".team-compose-mode")).toBeNull();
    await type("Add haptics when a timer ends");
    await press("Enter");
    expect(actions.tellTeam).toHaveBeenCalledWith(
      PROJECT,
      "Add haptics when a timer ends",
      "card",
    );
    expect(box().value).toBe("");
    actions.tellTeam.mockResolvedValueOnce("Turn the team on first.");
    await type("Use pnpm");
    await press("Enter");
    expect(chat().querySelector(".team-compose-problem")?.textContent).toBe(
      "Turn the team on first.",
    );
    expect(box().value).toBe("Use pnpm");
  });

  it("shows what a teammate is writing to you as it's written", async () => {
    await setUp();
    const live = () =>
      chat().querySelector('[data-team-live="checker"] .team-post-text')
        ?.textContent;
    expect(live()).toBe("Checking Timer screen · round 2");
    act(() => setCrewLiveReply(PROJECT, "checker", "The ring looks right"));
    expect(live()).toBe("The ring looks right");
    act(() => setCrewLiveReply(PROJECT, "checker", null));
    expect(live()).toBe("Checking Timer screen · round 2");
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

  it("shows one helper's posts when you pick it, writes to it, and opens its chat", async () => {
    await setUp();
    await pick("checker");
    const posts = [
      ...chat().querySelectorAll<HTMLElement>("[data-team-post]"),
    ].map((post) => post.dataset.teamPost);
    expect(posts).toEqual(["checker"]);
    expect(box().placeholder).toBe("Write to Checker…");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-team-open-chat]")!
        .click(),
    );
    expect(workspace.openChat).toHaveBeenCalledWith(PROJECT, "checker");
    // Everyone again.
    await act(async () =>
      button(
        container.querySelector("[data-team-showing]")!,
        "Show all",
      )!.click(),
    );
    expect(box().placeholder).toBe("Write to Avos, or @ a helper…");
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

  it("never sends to everyone a message meant for a teammate who left", async () => {
    await setUp();
    await pick("designer");
    await type("Can the ring use the project's colour?");
    // Designer leaves (from its page, or another window) while you write.
    await act(async () =>
      updateCrew(PROJECT, (crew) => withoutMember(crew, "designer")),
    );
    await press("Enter");
    expect(actions.tellTeam).not.toHaveBeenCalled();
    expect(actions.tellTeammate).not.toHaveBeenCalled();
    expect(chat().querySelector(".team-compose-problem")?.textContent).toBe(
      "Designer isn't helping Avos any more. Pick someone else or write to Avos.",
    );
    expect(box().value).toBe("Can the ring use the project's colour?");
    expect(chat().querySelector(".team-compose-to")?.textContent).toBe(
      "@Designer",
    );
    // Only you take it back to everyone.
    await act(async () =>
      chat().querySelector<HTMLButtonElement>(".team-compose-to")!.click(),
    );
    await press("Enter");
    expect(actions.tellTeam).toHaveBeenCalledWith(
      PROJECT,
      "Can the ring use the project's colour?",
      "card",
    );
  });

  it("asks you to answer only a card that still waits, in a sheet of its own", async () => {
    await setUp((crew, boards) => {
      const stuck = (id: string, stage: "stuck" | "applied") => ({
        ...crew.cards.find((card) => card.id === boards[0]!.id)!,
        id,
        stage,
        turn: undefined,
        holder: "builder" as const,
        stuck: { reason: "question" as const, text: "Count down?" },
      });
      let next = withCard(
        withCard(crew, stuck(boards[0]!.id, "stuck")),
        stuck("long-done", "applied"),
      );
      for (const [cardId, at] of [
        ["long-done", NOW - 50 * 60_000],
        [boards[0]!.id, NOW - 60_000],
      ] as const)
        next = withFeed(next, {
          at,
          kind: "stuck",
          who: "builder",
          member: "builder",
          cardId,
          title: "Timer screen",
          text: "Count down?",
        });
      return next;
    });
    const asks = [
      ...chat().querySelectorAll<HTMLElement>('[data-team-post="builder"]'),
    ].filter((post) => post.textContent?.includes("Count down?"));
    expect(asks.map((post) => post.hasAttribute("data-needs-you"))).toEqual([
      false,
      true,
    ]);
    expect(button(asks[0]!, "Answer on its card")).toBeUndefined();
    // Its question opens in a sheet of its own, with the box to answer it.
    await act(async () => button(asks[1]!, "Answer on its card")!.click());
    const sheet = document.querySelector<HTMLElement>("[data-avos-answer]")!;
    expect(sheet).not.toBeNull();
    expect(
      sheet.querySelector('textarea[aria-label="Your answer"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-team-board]")).toBeNull();
    // Avos asks for it in its message too, with its question and Answer.
    const ask = container.querySelector<HTMLElement>(
      '[data-avos-need^="stuck:"]',
    )!;
    expect(ask.querySelector(".avos-ask-text b")?.textContent).toBe(
      "Timer screen",
    );
    expect(ask.querySelector(".avos-ask-text span")?.textContent).toBe(
      "Count down?",
    );
    expect(button(ask, "Answer")).toBeDefined();
    // Which view Avos opens on stays your choice.
    expect(teamView(PROJECT)).toBe("chat");
  });

  it("counts as new only the posts the view shows", async () => {
    await setUp();
    await pick("checker");
    scrolledUp(thread());
    const post = (who: "builder" | "checker", text: string) =>
      act(async () =>
        updateCrew(PROJECT, (crew) =>
          withFeed(crew, {
            at: NOW,
            kind: "note",
            who,
            member: who,
            text,
          }),
        ),
      );
    await post("builder", "Builder here");
    expect(chat().querySelector(".team-thread-new")).toBeNull();
    await post("checker", "Checker here");
    expect(chat().querySelector(".team-thread-new")?.textContent).toBe(
      "1 new ↓",
    );
  });

  it("shows what you just wrote, even while you read further up", async () => {
    await setUp();
    const top = scrolledUp(thread());
    await act(async () =>
      updateCrew(PROJECT, (crew) =>
        withMessage(crew, { at: NOW, text: "One more thing", as: "rule" }),
      ),
    );
    expect(top()).toBe(1000);
    expect(chat().querySelector(".team-thread-new")).toBeNull();
  });

  it("keeps what you type while a message sends, and gives a failed one back", async () => {
    await setUp();
    let finish = (_why: string | null) => {};
    actions.tellTeam.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
        }),
    );
    await type("First");
    await press("Enter");
    // The box is free at once.
    expect(box().value).toBe("");
    await type("Second");
    await act(async () => finish(null));
    expect(box().value).toBe("Second");
    // A message that doesn't go comes back, if the box is empty.
    actions.tellTeam.mockResolvedValueOnce("Turn the team on first.");
    await press("Enter");
    expect(box().value).toBe("Second");
    expect(chat().querySelector(".team-compose-problem")?.textContent).toBe(
      "Turn the team on first.",
    );
  });

  it("closes the @ list once the caret leaves the @word, and takes out exactly that word", async () => {
    await setUp();
    await type("@Bu");
    expect(chat().querySelector("[data-team-mention]")).not.toBeNull();
    // The caret moves back, before the @: Enter sends, it doesn't pick.
    await act(async () => box().setSelectionRange(0, 0));
    await press("Enter");
    expect(actions.tellTeammate).not.toHaveBeenCalled();
    expect(actions.tellTeam).toHaveBeenCalledWith(PROJECT, "@Bu", "card");
    // Picked with the mouse after the caret moved: the @word goes, once.
    await type("Hi @Bu");
    await act(async () => box().setSelectionRange(0, 0));
    await act(async () =>
      chat()
        .querySelector<HTMLElement>('[data-team-mention] [role="option"]')!
        .click(),
    );
    expect(box().value).toBe("Hi ");
    expect(chat().querySelector(".team-compose-to")?.textContent).toBe(
      "@Builder",
    );
  });

  it("won't cut a long message to fit a card: it asks you to shorten it", async () => {
    await setUp();
    await pick("checker");
    const long = "y".repeat(600);
    await type(long);
    await act(async () =>
      chat().querySelector<HTMLButtonElement>(".team-compose-to")!.click(),
    );
    await press("Enter");
    expect(actions.tellTeam).not.toHaveBeenCalled();
    expect(chat().querySelector(".team-compose-problem")?.textContent).toBe(
      TOO_LONG_FOR_EVERYONE,
    );
    expect(box().value).toBe(long);
  });

  it("draws a thread with a moment no Date can show", async () => {
    await setUp((crew) => ({
      ...crew,
      feed: [
        ...crew.feed,
        { id: "far", at: 1e16, kind: "note", who: "aven", text: "Far off" },
      ],
    }));
    expect(chat()).not.toBeNull();
    expect(thread().textContent).not.toContain("Far off");
    expect(getCrew(PROJECT)).toBeDefined();
  });

  it("fades posts that scroll up under Ready for you, with no colour of its own", () => {
    const css = readFileSync("src/surfaces/TeamChat.css", "utf8");
    const at = css.indexOf(".team-thread-scroll {");
    const rule = css.slice(at, css.indexOf("}", at));
    expect(rule).toContain(
      "mask-image: linear-gradient(to bottom, transparent, #000 22px)",
    );
    expect(rule).toContain("-webkit-mask-image");
    // The first post starts below the fade.
    expect(rule).toContain("padding: 20px 0 10px");
  });

  it("brings a nudge you send into view, with what it led to, and counts none of it as unseen", async () => {
    await setUp();
    const view = layout(thread());
    // A nudge: its Feed lines land first ("keep going", then what it did),
    // then your message, which stands for the first of them.
    await act(async () =>
      updateCrew(PROJECT, (crew) =>
        withFeed(
          withFeed(crew, {
            id: "nudge-words",
            at: NOW,
            kind: "note",
            who: "you",
            text: "keep going",
          }),
          { at: NOW, kind: "note", who: "you", text: "You resumed Avos" },
        ),
      ),
    );
    await act(async () =>
      updateCrew(PROJECT, (crew) =>
        withMessage(crew, { at: NOW, text: "keep going", echo: "nudge-words" }),
      ),
    );
    expect(view.top()).toBe(view.bottom());
    expect(chat().querySelector(".team-thread-new")).toBeNull();
    const last = [...thread().querySelectorAll("[data-team-post]")]
      .slice(-2)
      .map((post) => post.textContent);
    expect(last[0]).toContain("keep going");
    expect(last[1]).toContain("You resumed Avos");
  });

  it("stays at the very bottom when you write in a thread longer than it shows", async () => {
    await setUp((crew) => {
      let next = crew;
      for (let index = 0; index < 80; index += 1)
        next = withFeed(next, {
          at: NOW - 90 * 60_000 + index,
          kind: "note",
          who: "scout",
          member: "scout",
          text: `Old ${index}`,
        });
      return next;
    });
    const view = layout(thread());
    await act(async () =>
      updateCrew(PROJECT, (crew) =>
        withMessage(crew, { at: NOW, text: "One more thing", as: "rule" }),
      ),
    );
    // The window slid to it: no older post was added above.
    expect(thread().querySelectorAll("[data-team-post]")).toHaveLength(60);
    expect(view.top()).toBe(view.bottom());
  });

  it("picks from the whole @word, wherever the caret is in it", async () => {
    await setUp();
    await type("hello @Bu");
    await act(async () => box().setSelectionRange(8, 8));
    await press("Enter");
    expect(box().value).toBe("hello ");
    expect(chat().querySelector(".team-compose-to")?.textContent).toBe(
      "@Builder",
    );
    await act(async () =>
      chat().querySelector<HTMLButtonElement>(".team-compose-to")!.click(),
    );
    // Right after the @: still the word you typed, not Everyone.
    await type("@Che");
    await act(async () => box().setSelectionRange(1, 1));
    await act(async () =>
      box().dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(
      [
        ...chat().querySelectorAll(
          '[data-team-mention] [role="option"] .team-mention-name',
        ),
      ].map((option) => option.textContent),
    ).toEqual(["Checker"]);
    await press("Enter");
    expect(box().value).toBe("");
    expect(chat().querySelector(".team-compose-to")?.textContent).toBe(
      "@Checker",
    );
  });

  it("keeps who a message is for while it's on its way, and gives both back if it fails", async () => {
    await setUp();
    let finish = (_why: string | null) => {};
    actions.tellTeammate.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
        }),
    );
    await pick("designer");
    await type("Only review the ring, change nothing");
    await press("Enter");
    expect(box().value).toBe("");
    // Backspace in the emptied box doesn't drop Designer mid-send.
    await press("Backspace");
    expect(chat().querySelector(".team-compose-to")?.textContent).toBe(
      "@Designer",
    );
    await act(async () => finish("Couldn't reach Designer's chat"));
    expect(box().value).toBe("Only review the ring, change nothing");
    expect(chat().querySelector(".team-compose-to")?.textContent).toBe(
      "@Designer",
    );
    await press("Enter");
    expect(actions.tellTeammate).toHaveBeenLastCalledWith(
      PROJECT,
      "designer",
      "Only review the ring, change nothing",
    );
    expect(actions.tellTeam).not.toHaveBeenCalled();
  });

  it("can't open a teammate's chat before Avos's first card, and says why", async () => {
    await setUp((crew) => {
      const next = { ...crew };
      delete next.copy;
      return next;
    });
    await pick("checker");
    const open = container.querySelector<HTMLButtonElement>(
      "[data-team-open-chat]",
    )!;
    expect(open.disabled).toBe(true);
    expect(open.title).toBe("Checker's chat starts with Avos's first card.");
    expect(container.querySelector("[data-team-open-note]")?.textContent).toBe(
      "Checker's chat starts with Avos's first card.",
    );
    // Once it can open, a chat that still doesn't says why, under its name.
    await act(async () =>
      updateCrew(PROJECT, (crew) => ({
        ...crew,
        copy: { path: "/copies/pom", branch: "aven/crew/pom", root: PROJECT },
      })),
    );
    expect(container.querySelector("[data-team-open-note]")).toBeNull();
    workspace.openChat.mockResolvedValueOnce("Couldn't open Checker's chat.");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-team-open-chat]")!
        .click(),
    );
    expect(container.querySelector("[data-team-open-note]")?.textContent).toBe(
      "Couldn't open Checker's chat.",
    );
  });

  it("opens a helper's chat and settings from its posts, and ⋯ holds only Pause and Settings", async () => {
    await setUp();
    const checker = container.querySelector<HTMLButtonElement>(
      '[data-crew-header] [data-avos-helper="checker"]',
    )!;
    // What it's doing, when you point at it.
    expect(checker.title).toBe("Checking Timer screen · round 2");
    await pick("checker");
    const showing = chat().querySelector<HTMLElement>("[data-team-showing]")!;
    await act(async () => button(showing, "Open chat")!.click());
    expect(workspace.openChat).toHaveBeenCalledWith(PROJECT, "checker");
    await act(async () => button(showing, "Settings")!.click());
    expect(workspace.openSettings).toHaveBeenCalledWith(PROJECT, "checker");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="More for Avos"]')!
        .click(),
    );
    expect(
      [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Pause Avos", "Settings…"]);
    await act(async () =>
      button(document.querySelector('[role="menu"]')!, "Settings…")!.click(),
    );
    expect(workspace.openSettings).toHaveBeenLastCalledWith(PROJECT);
  });

  it("shows what Avos remembers in its profile, and all of it in Notes, with Forget", async () => {
    await setUp((crew) => ({
      ...crew,
      members: crew.members.map((member) =>
        member.id === "checker"
          ? { ...member, memory: "Tests live in src/__tests__." }
          : member,
      ),
      notes: [{ id: "n1", at: NOW - 60_000, text: "Use pnpm, not npm" }],
    }));
    const remembers = container.querySelector<HTMLElement>(
      '[data-avos-profile="remembers"]',
    )!;
    expect(
      [...remembers.querySelectorAll("p.avos-profile-row")].map(
        (row) => row.textContent,
      ),
    ).toEqual(["Use pnpm, not npm", "Tests live in src/__tests__."]);
    await act(async () =>
      remembers
        .querySelector<HTMLButtonElement>("[data-avos-all-notes]")!
        .click(),
    );
    const notes = document.querySelector<HTMLElement>("[data-avos-notes]")!;
    expect(
      [...notes.querySelectorAll(".team-notes-heading")].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(["Your rules", "What it learned"]);
    expect(notes.textContent).toContain("Tests live in src/__tests__.");
    const rule = notes.querySelector<HTMLElement>("[data-avos-rule]")!;
    expect(rule.textContent).toContain("Use pnpm, not npm");
    await act(async () => button(rule, "Forget")!.click());
    expect(getCrew(PROJECT)!.notes).toEqual([]);
  });
});
