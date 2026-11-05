import { describe, expect, it } from "vitest";
import { afterBuild, afterCheck, queueCard, startCard } from "./crewLoop";
import {
  crewPipeline,
  reviewFileNotes,
  type PipelineBoardCard,
} from "./crewPipeline";
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

describe("what the team's header says", () => {
  it("says what the team is doing and what waits for you, in one sentence", () => {
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
      "Building Timer screen, round 2 of 3. One thing waits for you.",
    );
    expect(view.focus).toBe("Timer screen");
    expect(view.idle).toBe(false);
  });

  it("quotes what the Researcher reads and the Designer mocks up", () => {
    const solo = (id: string, title: string, kind: "research" | "mockup") =>
      startCard(queued(id, title, { kind, maxRounds: 1 }), NOW - 30_000);
    const reading = crewOf([solo("why", "Why timers help focus", "research")], {
      members: [{ id: "lens", role: "researcher" }],
    });
    expect(
      crewPipeline({ crew: reading, cards: board(reading), now: NOW, name })
        .sentence,
    ).toBe("researcher is reading: “Why timers help focus”.");
    const drawing = crewOf([solo("ring", "A ring that fills", "mockup")], {
      members: [{ id: "brush", role: "designer" }],
    });
    expect(
      crewPipeline({ crew: drawing, cards: board(drawing), now: NOW, name })
        .sentence,
    ).toBe("designer is mocking up: “A ring that fills”.");
  });

  it("names the idea it starts next when nothing is queued", () => {
    const crew = crewOf([]);
    const next: PipelineBoardCard = {
      id: "dark",
      title: "Dark mode",
      column: "idea",
      at: NOW,
      actions: [],
      crew: { roles: [], label: "Next", actions: [] },
    };
    const view = crewPipeline({ crew, cards: [next], now: NOW, name });
    expect(view.sentence).toBe("Starting Dark mode.");
    expect(view.focus).toBe("Dark mode");
    expect(view.idle).toBe(false);
  });

  it("says a Stuck card with work holds everything, and a goal waits on it", () => {
    const stuck: CrewCard = {
      ...fixing("timer", "Timer screen"),
      turn: undefined,
      stage: "stuck",
      stuck: { reason: "failed", text: "Beetle's turn didn't finish: boom" },
    };
    const crew = crewOf([stuck], {
      goal: { text: "Build the whole Pom app", at: NOW },
    });
    const view = crewPipeline({ crew, cards: board(crew), now: NOW, name });
    expect(view.sentence).toBe(
      "Timer screen needs you: Beetle's turn didn't finish: boom. Nothing else starts until you sort it out.",
    );
    // Not "Avos keeps going": it waits for you.
    expect(view.goal).toEqual({
      text: "Build the whole Pom app",
      state: "waits",
      why: "waits for you",
    });
    // A question keeps its own mark, with no full stop after it.
    const asked = crewOf([
      {
        ...stuck,
        stuck: {
          reason: "question",
          text: "Should the ring count down or fill up?",
        },
      },
    ]);
    expect(
      crewPipeline({ crew: asked, cards: board(asked), now: NOW, name })
        .sentence,
    ).toBe(
      "Timer screen needs you: Should the ring count down or fill up? Nothing else starts until you sort it out.",
    );
  });

  it("goes on past a card that changed nothing, and counts it as waiting for you", () => {
    const nothing = afterBuild(
      {
        ...startCard(queued("dup", "Brain dump fix"), NOW - 9_000),
        base: BASE,
      },
      {
        handoff: { summary: "Already done", howToCheck: [], ran: [] },
        change: null,
        now: NOW - 5_000,
      },
    ).card;
    const crew = crewOf([nothing, queued("next", "Keep Dr. in one item")], {
      goal: { text: "Finish Pom", at: NOW },
    });
    const view = crewPipeline({ crew, cards: board(crew), now: NOW, name });
    expect(view.sentence).toBe(
      "Starting Keep Dr. in one item. One thing waits for you.",
    );
    expect(view.goal?.state).toBe("on");
  });

  it("says ideas wait for you when none builds by itself", () => {
    const crew = crewOf([]);
    const waiting: PipelineBoardCard = {
      id: "issue",
      title: "Fix issue 12",
      column: "idea",
      at: NOW,
      actions: [],
      crew: {
        roles: [],
        line: "From outside · waits for you",
        actions: [{ id: "give", label: "Build it", primary: true }],
      },
    };
    expect(
      crewPipeline({ crew, cards: [waiting], now: NOW, name }).sentence,
    ).toBe("1 idea waits for you to press Build it.");
  });

  it("doesn't call a Scout idea for tomorrow one that waits for you", () => {
    const tomorrow: PipelineBoardCard = {
      id: "scout",
      title: "A Scout idea",
      column: "idea",
      at: NOW,
      actions: [],
      crew: {
        roles: ["scout"],
        later: true,
        actions: [{ id: "give", label: "Build it", primary: true }],
      },
    };
    expect(
      crewPipeline({ crew: crewOf([]), cards: [tomorrow], now: NOW, name })
        .sentence,
    ).toBe("Today's Scout ideas are used up. The next one builds tomorrow.");
  });

  it("says a limit holds an idea or the goal, with nothing queued", () => {
    const next: PipelineBoardCard = {
      id: "dark",
      title: "Dark mode",
      column: "idea",
      at: NOW,
      actions: [],
      crew: { roles: [], label: "Next", actions: [] },
    };
    const crew = crewOf([], { goal: { text: "Finish Pom", at: NOW } });
    const view = crewPipeline({
      crew,
      cards: [next],
      now: NOW,
      name,
      hold: "Today's 20 runs are used",
    });
    expect(view.sentence).toBe("Today's 20 runs are used: Dark mode waits.");
    expect(view.goal?.state).toBe("waits");
  });

  it("says nothing to build when idle, and offers a Scout when there's none", () => {
    const crew = crewOf([]);
    const view = crewPipeline({ crew, cards: [], now: NOW, name });
    expect(view.idle).toBe(true);
    expect(view.sentence).toBe(
      "Nothing to build. Add an idea and Avos builds it.",
    );
    expect(view.offerScout).toBe(true);
    const withScout = crewOf([], {
      members: [...crew.members, { id: "scout", role: "scout" }],
    });
    expect(
      crewPipeline({ crew: withScout, cards: [], now: NOW, name }).offerScout,
    ).toBe(false);
  });

  it("shows the goal, and a team planning towards it isn't idle", () => {
    const crew = crewOf([], {
      goal: { text: "Build the whole Pom app", at: NOW },
    });
    const view = crewPipeline({ crew, cards: [], now: NOW, name });
    expect(view.goal).toEqual({ text: "Build the whole Pom app", state: "on" });
    expect(view.idle).toBe(false);
    expect(view.sentence).toBe("Planning the next card for the goal.");
    // Paused: the goal says so, not that Avos keeps going.
    expect(
      crewPipeline({
        crew: { ...crew, paused: true },
        cards: [],
        now: NOW,
        name,
      }).goal,
    ).toEqual({
      text: "Build the whole Pom app",
      state: "waits",
      why: "paused",
    });
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

  it("says checked and secured only when every card had both, with the branch's own file count", () => {
    const secured = stacked("settings", "Settings page", BASE, A);
    const unsecured: CrewCard = {
      ...stacked("widget", "Home screen widget", A, B),
      rounds: [
        {
          n: 1,
          verdict: { pass: true, summary: "", mustFix: [], later: [], ran: [] },
        },
      ],
    };
    const crew = crewOf([secured, unsecured], { stack: { base: BASE } });
    // The file count is the branch's, as Review reads it; none until then.
    expect(
      crewPipeline({ crew, cards: board(crew), now: NOW, name }).batch!.status,
    ).toBe("Settings page · Home screen widget · checked");
    const view = crewPipeline({
      crew,
      cards: board(crew),
      now: NOW,
      name,
      batchFiles: 7,
    });
    expect(view.batch!.status).toBe(
      "Settings page · Home screen widget · 7 files · checked",
    );
    expect(view.batch!.reviewFirst).toBe(false);
    // Replayed onto your files by a restack: not checked again since.
    const replayed = crewOf(
      [
        secured,
        {
          ...stacked("widget", "Home screen widget", A, B),
          stacked: { commit: B, parent: A, hash: "h", replayed: true },
        },
      ],
      { stack: { base: BASE } },
    );
    const again = crewPipeline({
      crew: replayed,
      cards: board(replayed),
      now: NOW,
      name,
    }).batch!;
    expect(again.status).toBe(
      "Settings page · Home screen widget · replayed onto your files, not re-checked",
    );
    expect(again.reviewFirst).toBe(true);
  });

  it("stops starting cards once enough wait on the branch, and says why", () => {
    const crew = crewOf(
      [
        stacked("settings", "Settings page", BASE, A),
        stacked("widget", "Home screen widget", A, B),
        queued("pause", "Pause and resume"),
      ],
      {
        stack: { base: BASE },
        limits: { ...newCrew("/Users/me/pom").limits, readyCap: 2 },
      },
    );
    expect(
      crewPipeline({ crew, cards: board(crew), now: NOW, name }).sentence,
    ).toBe("2 cards wait for you: review them to keep going.");
  });

  it("names what a file does besides its lines: links, programs, binary", () => {
    expect(
      reviewFileNotes({
        binary: false,
        oldMode: "000000",
        newMode: "120000",
        linkTarget: "/Users/me/.ssh",
      }),
    ).toEqual(["a link to /Users/me/.ssh"]);
    expect(
      reviewFileNotes({ binary: false, oldMode: "100644", newMode: "100755" }),
    ).toEqual(["runs as a program"]);
    expect(
      reviewFileNotes({ binary: true, oldMode: "000000", newMode: "100644" }),
    ).toEqual(["binary"]);
    expect(
      reviewFileNotes({ binary: false, oldMode: "100644", newMode: "100644" }),
    ).toEqual([]);
  });
});
