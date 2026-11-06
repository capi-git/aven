import { describe, expect, it } from "vitest";
import { afterBuild, afterCheck, queueCard, startCard } from "./crewLoop";
import {
  autoStartsLeft,
  crewGate,
  crewHoldGate,
  crewLimitsLine,
  crewRunsLine,
  ideaMayAutoStart,
  ideaWaits,
  ideasLeft,
  ideasToBuild,
  nextCardToStart,
  nextIdeaToBuild,
  scoutShouldLook,
} from "./crewLimits";
import {
  CREW_ALL_RUNS_PER_DAY,
  cardInCopy,
  newCrew,
  readCrew,
  withCard,
  withIdea,
  type Crew,
  type CrewCard,
} from "./crews";
import { localDay } from "./projectBots";

/** Local time on 2026-10-29 at `hour:minute`. */
function at(hour: number, minute = 0, day = 29): number {
  return new Date(2026, 9, day, hour, minute).getTime();
}

const NOON = at(12);

function crew(patch: Partial<Crew> = {}): Crew {
  return { ...newCrew("/Users/me/aven-site", 1), on: true, ...patch };
}

function gate(input: Partial<Parameters<typeof crewGate>[0]> = {}) {
  return crewGate({
    crew: crew(),
    now: NOON,
    weeklyUsed: 40,
    fixerRuns: 0,
    allRuns: 0,
    ...input,
  });
}

describe("budgets", () => {
  it("runs while every limit allows it", () => {
    expect(gate()).toEqual({ ok: true });
  });

  it("holds at the daily run cap, counting the Fixer's runs too", () => {
    const today = { day: localDay(NOON), count: 15 };
    expect(gate({ crew: crew({ runs: today }), fixerRuns: 4 }).ok).toBe(true);
    expect(gate({ crew: crew({ runs: today }), fixerRuns: 5 })).toMatchObject({
      ok: false,
      reason: "daily-cap",
      title: "Today's 20 runs are used",
    });
    // Yesterday's runs don't count.
    expect(
      gate({ crew: crew({ runs: { day: "2026-10-28", count: 99 } }) }).ok,
    ).toBe(true);
  });

  it("lets you allow 10 more today", () => {
    const full = crew({
      runs: { day: localDay(NOON), count: 20 },
      extra: { day: localDay(NOON), count: 10 },
    });
    expect(gate({ crew: full }).ok).toBe(true);
    expect(crewRunsLine(full, NOON)).toBe("20 of 30 runs today");
    expect(
      gate({ crew: { ...full, runs: { day: localDay(NOON), count: 30 } } }),
    ).toMatchObject({ reason: "daily-cap", title: "Today's 30 runs are used" });
  });

  it("holds when every team together has used the day's ceiling", () => {
    expect(gate({ allRuns: CREW_ALL_RUNS_PER_DAY })).toMatchObject({
      ok: false,
      reason: "all-crews-cap",
    });
  });

  it("holds in quiet hours, 11 pm to 8 am by default, and the hours can change", () => {
    expect(gate({ now: at(23, 30) })).toMatchObject({
      reason: "quiet-hours",
      title: "Quiet hours, 11 pm–8 am",
      detail: "Nothing new starts. A turn already running finishes.",
    });
    expect(gate({ now: at(7, 59) }).ok).toBe(false);
    expect(gate({ now: at(8) }).ok).toBe(true);
    const late = crew({
      limits: {
        ...newCrew("/x").limits,
        quiet: { on: true, start: 22 * 60 + 30, end: 7 * 60 },
      },
    });
    expect(gate({ crew: late, now: at(22, 45) }).ok).toBe(false);
    expect(gate({ crew: late, now: at(7, 30) }).ok).toBe(true);
  });

  it("pauses at 80% of the Claude week, and says so", () => {
    expect(gate({ weeklyUsed: 79.9 }).ok).toBe(true);
    expect(gate({ weeklyUsed: 81 })).toMatchObject({
      ok: false,
      reason: "usage",
      title: "Claude is 81% used for the week",
      detail: "Avos pauses at 80% so your own chats keep working.",
    });
    // Unknown usage doesn't hold the crew.
    expect(gate({ weeklyUsed: null }).ok).toBe(true);
  });

  it("puts your pause first", () => {
    expect(
      gate({ crew: crew({ paused: true }), weeklyUsed: 99 }),
    ).toMatchObject({ reason: "paused" });
  });

  it("shows its limits as plain counts", () => {
    const shown = crew({ runs: { day: localDay(NOON), count: 5 } });
    expect(crewLimitsLine(shown, NOON, 2)).toBe(
      "7 of 20 runs today · one card at a time · quiet 11 pm–8 am · pauses at 80% of your week",
    );
  });
});

describe("one card at a time", () => {
  const queued = (id: string, at: number) =>
    queueCard({ id, title: id, brief: id, from: "you", maxRounds: 3 }, at);

  it("starts the oldest queued card only while no card holds the copy", () => {
    let current = withCard(withCard(crew(), queued("b", 2)), queued("a", 1));
    expect(nextCardToStart(current)).toBe("a");
    current = withCard(current, startCard(queued("a", 1), 3));
    expect(nextCardToStart(current)).toBeNull();
  });

  it("waits while a Ready or Stuck card holds the copy", () => {
    const ready = { ...startCard(queued("a", 1), 2), stage: "ready" as const };
    expect(
      nextCardToStart(withCard(withCard(crew(), ready), queued("b", 3))),
    ).toBeNull();
    // Stuck with work in the copy: it holds it until you act.
    const change = {
      base: "b",
      hash: "h",
      files: 1,
      additions: 1,
      deletions: 0,
      paths: [],
    };
    const stuck = {
      ...ready,
      stage: "stuck" as const,
      stuck: { reason: "failed" as const, text: "It failed" },
      rounds: [{ n: 1, change }],
    };
    expect(
      nextCardToStart(withCard(withCard(crew(), stuck), queued("b", 3))),
    ).toBeNull();
  });

  it("goes on past a Stuck card that changed nothing: it steps aside", () => {
    const started = startCard(queued("a", 1), 2);
    const nothing = afterBuild(started, {
      handoff: { summary: "Already done", howToCheck: [], ran: [] },
      change: null,
      now: 3,
    }).card;
    expect(nothing.stage).toBe("stuck");
    const current = withCard(withCard(crew(), nothing), queued("b", 4));
    expect(cardInCopy(current)).toBeUndefined();
    expect(nextCardToStart(current)).toBe("b");
    // No read of the copy (a turn cut off while it waited on an approval,
    // by turning the team off): its work may be there, so it holds the copy.
    const cutOff = {
      ...started,
      stage: "stuck" as const,
      holder: "builder" as const,
      stuck: { reason: "question" as const, text: "Builder is waiting" },
    };
    expect(cardInCopy(withCard(crew(), cutOff))?.id).toBe("a");
    // A question asked before changing anything steps aside too.
    const asked = afterBuild(started, {
      handoff: { summary: "", howToCheck: [], ran: [], question: "Which one?" },
      change: null,
      now: 3,
    }).card;
    expect(cardInCopy(withCard(crew(), asked))).toBeUndefined();
    // Asked after changing files: it holds them, so it holds the copy.
    const change = {
      base: "b",
      hash: "h",
      files: 2,
      additions: 4,
      deletions: 0,
      paths: [],
    };
    const askedWithWork = afterBuild(started, {
      handoff: { summary: "", howToCheck: [], ran: [], question: "Which one?" },
      change,
      now: 3,
    }).card;
    expect(cardInCopy(withCard(crew(), askedWithWork))?.id).toBe("a");
  });
});

describe("ideas build themselves, top first", () => {
  const board = (id: string, createdAt: number, patch = {}) => ({
    id,
    column: "idea" as const,
    createdAt,
    ...patch,
  });
  const idea = (at: number, patch = {}) => ({
    at,
    size: "small" as const,
    ...patch,
  });

  it("builds yours and the Scout's alike, oldest first, as the Board shows them", () => {
    const current = withIdea(crew(), "scout", idea(5, { size: "medium" }));
    const cards = [board("late", 30), board("scout", 20), board("early", 10)];
    expect(ideasToBuild(current, cards, NOON).map((card) => card.id)).toEqual([
      "early",
      "scout",
      "late",
    ]);
    expect(nextIdeaToBuild(current, cards, NOON)?.id).toBe("early");
  });

  it("waits on Not now, outside material, Security's sweep and a used-up day", () => {
    let current = crew({ notNow: ["held"] });
    current = withIdea(current, "declined", idea(1, { declined: true }));
    current = withIdea(current, "sweep", idea(1, { by: "security" as const }));
    current = withIdea(current, "linked", idea(1, { outside: true }));
    expect(ideaWaits(current, { id: "held" }, NOON)).toBe("not-now");
    expect(ideaWaits(current, { id: "declined" }, NOON)).toBe("not-now");
    expect(ideaWaits(current, { id: "sweep" }, NOON)).toBe("security");
    expect(ideaWaits(current, { id: "linked" }, NOON)).toBe("outside");
    // An issue brought in from GitHub, say.
    expect(
      ideaWaits(current, { id: "issue", sourceUrl: "https://x.test/1" }, NOON),
    ).toBe("outside");
    expect(ideaWaits(current, { id: "yours" }, NOON)).toBeNull();
    // The day's cap on Scout ideas; yours never count.
    current = withIdea(current, "scout", idea(1));
    current = { ...current, autoStarts: { day: localDay(NOON), count: 3 } };
    expect(autoStartsLeft(current, NOON)).toBe(0);
    expect(ideaWaits(current, { id: "scout" }, NOON)).toBe("cap");
    expect(ideaWaits(current, { id: "yours" }, NOON)).toBeNull();
  });

  it("keeps the records of ideas that wait, however many come after", () => {
    let current = withIdea(
      crew(),
      "sweep",
      idea(1, { by: "security" as const }),
    );
    current = withIdea(current, "linked", idea(1, { outside: true }));
    current = withIdea(current, "declined", idea(1, { declined: true }));
    current = withIdea(current, "big", idea(1, { size: "large" as const }));
    for (let n = 0; n < 100; n += 1)
      current = withIdea(current, `new-${n}`, idea(n));
    expect(ideaWaits(current, { id: "sweep" }, NOON)).toBe("security");
    expect(ideaWaits(current, { id: "linked" }, NOON)).toBe("outside");
    expect(ideaWaits(current, { id: "declined" }, NOON)).toBe("not-now");
    expect(ideaWaits(current, { id: "big" }, NOON)).toBe("large");
    // The rest stay at their cap.
    expect(Object.keys(current.ideas ?? {}).length).toBe(64);
    // And they survive a save and a read.
    const read = readCrew(JSON.parse(JSON.stringify(current)));
    expect(ideaWaits(read!, { id: "sweep" }, NOON)).toBe("security");
  });

  it("waits on a card the team built or threw away, a large Scout idea and one a chat has", () => {
    const thrown = {
      ...startCard(
        queueCard(
          { id: "old", title: "Old", brief: "x", from: "you", maxRounds: 3 },
          1,
        ),
        2,
      ),
      stage: "discarded" as const,
    };
    const current = withIdea(
      withCard(crew(), thrown),
      "big",
      idea(1, { size: "large" }),
    );
    expect(ideaWaits(current, { id: "old" }, NOON)).toBe("not-now");
    expect(ideaWaits(current, { id: "big" }, NOON)).toBe("large");
    expect(
      ideaWaits(current, { id: "drafted", chatIds: ["chat-1"] }, NOON),
    ).toBe("chat");
  });

  it("never starts a declined Scout idea, a large one, one from outside, or one that already started", () => {
    expect(ideaMayAutoStart(idea(1, { size: "large" }))).toBe(false);
    expect(ideaMayAutoStart(idea(1, { size: "medium" }))).toBe(true);
    expect(ideaMayAutoStart(idea(1, { declined: true }))).toBe(false);
    expect(
      ideaMayAutoStart(idea(1, { sourceUrl: "https://example.com/issue" })),
    ).toBe(false);
    expect(ideaMayAutoStart(idea(1, { autoStarted: true }))).toBe(false);
    // Aven's own check found a link or an issue in its words.
    expect(ideaMayAutoStart(idea(1, { outside: true }))).toBe(false);
  });

  it("waits while a card is in the copy or queued, and skips one the team has", () => {
    const started = startCard(
      queueCard(
        { id: "x", title: "x", brief: "x", from: "you", maxRounds: 3 },
        1,
      ),
      2,
    );
    expect(
      nextIdeaToBuild(withCard(crew(), started), [board("a", 1)], NOON),
    ).toBeNull();
    // The team has it already (built, then put back by hand): not twice.
    const ready = {
      ...started,
      id: "a",
      stage: "ready" as const,
      stacked: { commit: "c", parent: "p", hash: "h" },
    };
    expect(
      nextIdeaToBuild(withCard(crew(), ready), [board("a", 1)], NOON),
    ).toBeNull();
    // Not in Ideas any more.
    expect(
      nextIdeaToBuild(
        crew(),
        [{ ...board("a", 1), column: "building" as const }],
        NOON,
      ),
    ).toBeNull();
  });

  it("lets the Scout look once a day, with ideas left, while idle", () => {
    const fresh = crew({
      members: [
        { id: "builder", role: "builder" },
        { id: "checker", role: "checker" },
        { id: "scout", role: "scout" },
      ],
    });
    expect(scoutShouldLook(fresh, NOON, false)).toBe(true);
    expect(scoutShouldLook(fresh, NOON, true)).toBe(false);
    expect(scoutShouldLook({ ...fresh, scoutAt: at(9) }, NOON, false)).toBe(
      false,
    );
    expect(
      scoutShouldLook({ ...fresh, scoutAt: at(9, 0, 28) }, NOON, false),
    ).toBe(true);
    const full = { ...fresh, ideasAdded: { day: localDay(NOON), count: 3 } };
    expect(ideasLeft(full, NOON)).toBe(0);
    expect(scoutShouldLook(full, NOON, false)).toBe(false);
    const paused = {
      ...fresh,
      members: [{ id: "scout", role: "scout" as const, paused: true }],
    };
    expect(scoutShouldLook(paused, NOON, false)).toBe(false);
  });
});

describe("why the Board says the team holds", () => {
  const queued = queueCard(
    { id: "c", title: "Dark mode", brief: "x", from: "you", maxRounds: 3 },
    1,
  );
  /** A card the Checker passed, waiting for Security's review. */
  function forSecurity(withChange = true) {
    let card: CrewCard = { ...startCard(queued, 2), base: "base" };
    card = afterBuild(card, {
      handoff: { summary: "Done", howToCheck: [], ran: [] },
      change: {
        base: "base",
        hash: "h1",
        files: 1,
        additions: 1,
        deletions: 0,
        paths: [],
      },
      now: 3,
    }).card;
    card = afterCheck(card, {
      verdict: { pass: true, summary: "", mustFix: [], later: [], ran: [] },
      edited: false,
      security: true,
      now: 4,
    }).card;
    return withChange
      ? card
      : {
          ...card,
          reviewing: undefined,
          rounds: card.rounds.map((round) => ({ ...round, change: undefined })),
        };
  }
  const hold = (patch: Partial<Crew>, input: { allRuns?: number } = {}) =>
    crewHoldGate({
      crew: crew(patch),
      now: NOON,
      weeklyUsed: 40,
      fixerRuns: 0,
      allRuns: input.allRuns ?? 0,
      allRunsCap: 30,
    });

  it("names the all-crews ceiling while a card waits", () => {
    expect(hold({ cards: [queued] }, { allRuns: 30 })?.gate).toMatchObject({
      reason: "all-crews-cap",
      title: "Today's 30 runs for all projects are used",
    });
    expect(hold({ cards: [queued] }, { allRuns: 29 })).toBeNull();
  });

  it("says Security is off when a card waits for it with nothing to make Ready", () => {
    const members: Crew["members"] = [
      { id: "builder", role: "builder" },
      { id: "checker", role: "checker" },
      { id: "security", role: "security", paused: true },
    ];
    expect(hold({ members, cards: [forSecurity(false)] })?.gate).toMatchObject({
      reason: "no-member",
      title: "No Security is on",
    });
    // With the Checker's pass to make Ready, nothing holds it.
    expect(hold({ members, cards: [forSecurity()] })).toBeNull();
  });
});
