import { describe, expect, it } from "vitest";
import { queueCard, startCard } from "./crewLoop";
import {
  autoStartsLeft,
  crewGate,
  crewLimitsLine,
  crewRunsLine,
  ideaMayAutoStart,
  ideasLeft,
  nextAutoStart,
  nextCardToStart,
  scoutShouldLook,
} from "./crewLimits";
import {
  CREW_ALL_RUNS_PER_DAY,
  newCrew,
  withCard,
  withIdea,
  type Crew,
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

  it("holds when every crew together has used the day's ceiling", () => {
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
      detail: "Crews pause at 80% so your own chats keep working.",
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
      "7 of 20 runs today · one card at a time · quiet 11 pm–8 am",
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
    const stuck = { ...ready, stage: "stuck" as const };
    expect(
      nextCardToStart(withCard(withCard(crew(), stuck), queued("b", 3))),
    ).toBeNull();
  });
});

describe("Scout ideas start themselves, within limits", () => {
  const idea = (at: number, patch = {}) => ({
    at,
    size: "small" as const,
    ...patch,
  });
  const allInIdeas = () => true;

  it("starts the oldest small idea while the crew is idle", () => {
    let current = withIdea(crew(), "late", idea(20));
    current = withIdea(current, "early", idea(10));
    expect(nextAutoStart(current, NOON, allInIdeas)).toBe("early");
  });

  it("never starts a medium or large idea, a declined one, or one from outside", () => {
    expect(ideaMayAutoStart(idea(1, { size: "medium" }))).toBe(false);
    expect(ideaMayAutoStart(idea(1, { size: "large" }))).toBe(false);
    expect(ideaMayAutoStart(idea(1, { declined: true }))).toBe(false);
    expect(
      ideaMayAutoStart(idea(1, { sourceUrl: "https://example.com/issue" })),
    ).toBe(false);
    expect(ideaMayAutoStart(idea(1, { autoStarted: true }))).toBe(false);
    expect(ideaMayAutoStart(idea(1))).toBe(true);
  });

  it("stops at the day's cap of 3", () => {
    let current = withIdea(crew(), "idea", idea(1));
    current = { ...current, autoStarts: { day: localDay(NOON), count: 2 } };
    expect(autoStartsLeft(current, NOON)).toBe(1);
    expect(nextAutoStart(current, NOON, allInIdeas)).toBe("idea");
    current = { ...current, autoStarts: { day: localDay(NOON), count: 3 } };
    expect(nextAutoStart(current, NOON, allInIdeas)).toBeNull();
  });

  it("waits while a card is in the copy or queued, and skips ideas no longer in Ideas", () => {
    const busy = withCard(
      withIdea(crew(), "idea", idea(1)),
      startCard(
        queueCard(
          { id: "x", title: "x", brief: "x", from: "you", maxRounds: 3 },
          1,
        ),
        2,
      ),
    );
    expect(nextAutoStart(busy, NOON, allInIdeas)).toBeNull();
    expect(
      nextAutoStart(withIdea(crew(), "idea", idea(1)), NOON, () => false),
    ).toBeNull();
  });

  it("lets the Scout look once a day, with ideas left, while idle", () => {
    const fresh = crew({
      members: [{ role: "builder" }, { role: "checker" }, { role: "scout" }],
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
      members: [{ role: "scout" as const, paused: true }],
    };
    expect(scoutShouldLook(paused, NOON, false)).toBe(false);
  });
});
