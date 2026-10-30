import { describe, expect, it } from "vitest";
import { afterBuild, afterCheck, queueCard, startCard } from "./crewLoop";
import { crewPipeline, type PipelineBoardCard } from "./crewPipeline";
import { newCrew, type Crew, type CrewCard } from "./crews";
import { crewBoardInfo } from "./crewView";
import { localDay } from "./projectBots";

const NOW = new Date(2026, 9, 29, 15).getTime();
const DAY = 24 * 60 * 60_000;
const names: Record<string, string> = {
  builder: "Beetle",
  checker: "Owl",
  security: "Hedgehog",
  scout: "Fox",
};
const name = (who: string) => names[who] ?? who;

const change = (hash: string, paths: string[]) => ({
  base: "b".repeat(40),
  hash,
  files: paths.length,
  additions: paths.length * 3,
  deletions: 1,
  paths: paths.map((path) => ({ path, additions: 3, deletions: 1 })),
});

function queued(id: string, title: string, extra: Partial<CrewCard> = {}) {
  return {
    ...queueCard(
      { id, title, brief: title, from: "you", maxRounds: 3 },
      NOW - DAY,
    ),
    ...extra,
  };
}

/** A card the Checker sent back once: round 2, back with the Builder. */
function fixing(id: string, title: string): CrewCard {
  let card: CrewCard = {
    ...startCard(queued(id, title), NOW - 30_000),
    base: "b".repeat(40),
  };
  card = afterBuild(card, {
    handoff: { summary: "Built", howToCheck: [], ran: [] },
    change: change("h1", ["src/timer.ts"]),
    now: NOW - 20_000,
  }).card;
  card = afterCheck(card, {
    verdict: {
      pass: false,
      summary: "",
      mustFix: [
        { text: "Light-mode contrast on the label" },
        { text: "Reload forgets the time" },
      ],
      later: [],
      ran: [],
    },
    edited: false,
    now: NOW - 10_000,
  }).card;
  return {
    ...card,
    builderId: "builder",
    turn: { role: "builder", sessionId: "b", turnId: "t", sentAt: NOW - 5_000 },
  };
}

function stacked(
  id: string,
  title: string,
  parent: string,
  commit: string,
): CrewCard {
  return {
    ...startCard(queued(id, title), NOW - DAY),
    stage: "ready",
    holder: undefined,
    rounds: [
      {
        n: 1,
        verdict: { pass: true, summary: "", mustFix: [], later: [], ran: [] },
        security: { pass: true, summary: "", mustFix: [], later: [], ran: [] },
      },
    ],
    fix: change(`f-${id}`, [`src/${id}.ts`, "src/shared.ts"]),
    stacked: { commit, parent },
  };
}

function crewOf(cards: CrewCard[], patch: Partial<Crew> = {}): Crew {
  return {
    ...newCrew("/Users/me/pom"),
    on: true,
    cards,
    runs: { day: localDay(NOW), count: 4 },
    ...patch,
  };
}

function board(
  crew: Crew,
  extra: PipelineBoardCard[] = [],
): PipelineBoardCard[] {
  return [
    ...crew.cards.map((card): PipelineBoardCard => ({
      id: card.id,
      title: card.title,
      column: card.stage === "ready" ? "review" : "building",
      at: NOW,
      actions: [],
      crew: crewBoardInfo(card, { builder: "Beetle", checker: "Owl" }),
    })),
    ...extra,
  ];
}

const A = "1".repeat(40);
const B = "2".repeat(40);
const BASE = "a".repeat(40);

describe("the Pipeline", () => {
  it("says what the crew is doing and what needs you, in one sentence", () => {
    const crew = crewOf(
      [
        stacked("settings", "Settings page", BASE, A),
        fixing("timer", "Timer screen"),
        queued("pause", "Pause and resume a session"),
      ],
      { stack: { base: BASE } },
    );
    const view = crewPipeline({ crew, cards: board(crew), now: NOW, name });
    expect(view.sentence).toBe(
      "Building Timer screen, round 2 of 3: Owl asked for 2 fixes. One card waits for you.",
    );
    expect(view.focus).toBe("Timer screen");
    expect(view.idle).toBe(false);
  });

  it("groups cards as Ready for you, In progress, Up next and Ideas", () => {
    const crew = crewOf(
      [
        stacked("settings", "Settings page", BASE, A),
        stacked("widget", "Home screen widget", A, B),
        fixing("timer", "Timer screen"),
        queued("pause", "Pause and resume a session"),
        { ...queued("old", "Old"), stage: "applied", endedAt: NOW - DAY },
      ],
      { stack: { base: BASE } },
    );
    const view = crewPipeline({
      crew,
      cards: board(crew, [
        {
          id: "haptics",
          title: "Haptics on finish",
          column: "idea",
          at: NOW,
          actions: [],
          crew: {
            roles: [],
            actions: [{ id: "give", label: "Give to crew", primary: true }],
          },
        },
        {
          id: "chat-card",
          title: "Run Pom in the Pom folder",
          column: "review",
          at: NOW,
          line: "index.html",
          actions: [
            { kind: "review", sessionId: "s", cwd: "/Users/me/pom" },
            { kind: "ship", sessionId: "s", cwd: "/Users/me/pom" },
          ],
        },
        {
          id: "shipped",
          title: "Sign-up form",
          column: "shipped",
          at: NOW - DAY,
          actions: [],
        },
      ]),
      now: NOW,
      name,
    });
    // The branch's cards are one batch row.
    expect(view.batch).toMatchObject({
      title: "2 cards ready on the crew's branch",
      status:
        "Settings page · Home screen widget · 3 files · checked and secured",
      cards: [
        { id: "settings", title: "Settings page" },
        { id: "widget", title: "Home screen widget" },
      ],
    });
    expect(view.batch!.steps.map((step) => step.state)).toEqual([
      "done",
      "done",
      "done",
      "now",
    ]);
    // A chat's work to review stays reachable, with its own buttons.
    expect(view.ready).toEqual([
      expect.objectContaining({
        id: "chat-card",
        status: "index.html",
        boardActions: [
          { kind: "review", sessionId: "s", cwd: "/Users/me/pom" },
          { kind: "ship", sessionId: "s", cwd: "/Users/me/pom" },
        ],
      }),
    ]);
    expect(view.inProgress.map((row) => row.id)).toEqual(["timer"]);
    const timer = view.inProgress[0]!;
    expect(timer.status).toBe(
      "Round 2 of 3 · Beetle fixing: Light-mode contrast on the label",
    );
    expect(timer.progress).toBeGreaterThan(0.3);
    expect(timer.progress).toBeLessThan(0.5);
    expect(
      timer.steps!.map((step) => [step.id, step.state, step.who?.id]),
    ).toEqual([
      ["build", "now", "builder"],
      ["check", "todo", undefined],
      ["security", "todo", undefined],
      ["you", "todo", undefined],
    ]);
    expect(view.upNext).toEqual([
      expect.objectContaining({
        id: "pause",
        status: "From you · waits for Timer screen",
      }),
    ]);
    expect(view.ideas).toEqual([
      expect.objectContaining({
        id: "haptics",
        status: "Idea · not given yet",
        actions: [{ id: "give", label: "Give to crew", primary: true }],
      }),
    ]);
    expect(view.shipped).toEqual(["Old", "Sign-up form"]);
    expect(view.limits).toBe("4 of 20 runs today · quiet 11 pm–8 am");
  });

  it("puts a Stuck card in In progress, with why, waiting on you", () => {
    const stuck: CrewCard = {
      ...fixing("timer", "Timer screen"),
      turn: undefined,
      stage: "stuck",
      stuck: { reason: "failed", text: "Beetle's turn didn't finish: boom" },
    };
    const crew = crewOf([stuck]);
    const view = crewPipeline({ crew, cards: board(crew), now: NOW, name });
    expect(view.inProgress[0]).toMatchObject({
      status: "Beetle's turn didn't finish: boom",
      needsYou: true,
    });
    expect(view.inProgress[0]!.progress).toBeUndefined();
    expect(view.inProgress[0]!.steps![0]!.state).toBe("stuck");
    expect(view.inProgress[0]!.actions[0]).toEqual({
      id: "more",
      label: "Try again",
      primary: true,
    });
    expect(view.sentence).toBe(
      "Timer screen needs you: Beetle's turn didn't finish: boom.",
    );
  });

  it("says nothing to build when idle, and offers a Scout when there's none", () => {
    const crew = crewOf([]);
    const view = crewPipeline({ crew, cards: [], now: NOW, name });
    expect(view.idle).toBe(true);
    expect(view.sentence).toBe(
      "Nothing to build. Tell the crew what to do, or add an idea.",
    );
    expect(view.offerScout).toBe(true);
    const withScout = crewOf([], {
      members: [...crew.members, { id: "scout", role: "scout" }],
    });
    expect(
      crewPipeline({ crew: withScout, cards: [], now: NOW, name }).offerScout,
    ).toBe(false);
  });

  it("shows the goal, and a crew planning towards it isn't idle", () => {
    const crew = crewOf([], {
      goal: { text: "Build the whole Pom app", at: NOW },
    });
    const view = crewPipeline({ crew, cards: [], now: NOW, name });
    expect(view.goal).toEqual({ text: "Build the whole Pom app", state: "on" });
    expect(view.idle).toBe(false);
    expect(view.sentence).toBe("Planning the next card for the goal.");
    const met = crewOf([], {
      goal: {
        text: "Build the whole Pom app",
        at: NOW,
        done: { at: NOW, text: "It's complete.", met: true },
      },
    });
    expect(crewPipeline({ crew: met, cards: [], now: NOW, name }).goal).toEqual(
      {
        text: "Build the whole Pom app",
        state: "met",
        why: "It's complete.",
      },
    );
  });

  it("says why a limit holds the card that waits", () => {
    const crew = crewOf([queued("pause", "Pause and resume")]);
    const view = crewPipeline({
      crew,
      cards: board(crew),
      now: NOW,
      name,
      hold: "Quiet hours, 11 pm–8 am",
    });
    expect(view.sentence).toBe(
      "Quiet hours, 11 pm–8 am: Pause and resume waits.",
    );
  });

  it("marks Security skipped when the crew has none", () => {
    const crew = crewOf([fixing("timer", "Timer screen")], {
      members: [
        { id: "builder", role: "builder" },
        { id: "checker", role: "checker" },
      ],
    });
    const view = crewPipeline({ crew, cards: board(crew), now: NOW, name });
    expect(view.inProgress[0]!.steps![2]).toMatchObject({
      id: "security",
      state: "skip",
    });
  });
});
