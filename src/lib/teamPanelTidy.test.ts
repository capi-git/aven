import { describe, expect, it } from "vitest";
import type { Discussion } from "./discussions";
import {
  ENDED_RACE_PILL_MS,
  endedRacePills,
  finishedPanelLook,
  finishedPanelShrinks,
} from "./teamPanelTidy";

const panel = (
  watching: string[],
  expanded: string | null = null,
  popped: string[] = [],
) => ({ watching, expanded, popped });

describe("an ended race's pill", () => {
  const races = [
    { id: "r1", state: "kept" as const, finishedAt: 1_000 },
    { id: "r2", state: "running" as const },
    { id: "r3", state: "discarded" as const, finishedAt: 1_000 },
  ];

  it("says how the race ended for a moment, then goes", () => {
    const state = panel(["race:r1", "race:r2", "discuss:d1"]);
    const shown = new Map([["race:r1", 1_000]]);
    expect(endedRacePills(state, races, shown, 2_000)).toEqual({
      ended: ["race:r1"],
      due: [],
      next: 1_000 + ENDED_RACE_PILL_MS,
    });
    expect(
      endedRacePills(state, races, shown, 1_000 + ENDED_RACE_PILL_MS),
    ).toMatchObject({ due: ["race:r1"], next: null });
    // A running race keeps its pill, as does every other kind of team.
    expect(endedRacePills(state, races, shown, 99_000).due).toEqual([
      "race:r1",
    ]);
  });

  it("counts from when it first showed as a pill, for one ended long ago", () => {
    const state = panel(["race:r3"]);
    expect(endedRacePills(state, races, new Map(), 50_000)).toMatchObject({
      ended: ["race:r3"],
      due: [],
      next: 50_000 + ENDED_RACE_PILL_MS,
    });
  });

  it("leaves a race open as the panel or popped out alone", () => {
    expect(
      endedRacePills(
        panel(["race:r1", "race:r3"], "race:r1", ["race:r3"]),
        races,
        new Map(),
        99_000,
      ).ended,
    ).toEqual([]);
  });
});

const discussion = (patch: Partial<Discussion> = {}): Discussion =>
  ({
    id: "d1",
    a: { sessionId: "chat-a" },
    b: { sessionId: "chat-b" },
    status: "ended",
    settled: 4,
    ...patch,
  }) as Discussion;

describe("a finished discussion's panel", () => {
  const look = (view: string, patch: Partial<Discussion> = {}) =>
    finishedPanelLook("discuss:d1", [discussion(patch)], view);

  it("shrinks when you leave its chat for Home, the board or another chat", () => {
    const before = look("chat-a");
    expect(before?.shows).toBe(true);
    expect(finishedPanelShrinks(before, look("chat-a\nchat-x"))).toBe(false);
    expect(finishedPanelShrinks(before, look(""))).toBe(true);
    expect(finishedPanelShrinks(before, look("chat-x"))).toBe(true);
    // The partner's chat counts as its chat too.
    expect(finishedPanelShrinks(before, look("chat-b"))).toBe(false);
  });

  it("shrinks once its plan is sent to build", () => {
    const before = look("chat-a");
    expect(
      finishedPanelShrinks(before, look("chat-a", { built: { b: 4 } })),
    ).toBe(true);
    // A build sent for an earlier ending is not this one's.
    expect(
      finishedPanelShrinks(before, look("chat-a", { built: { b: 2 } })),
    ).toBe(false);
  });

  it("shrinks when it ends away from its chats, and stays while it runs", () => {
    const running = look("chat-x", { status: "active" });
    expect(
      finishedPanelShrinks(look("chat-a", { status: "active" }), running),
    ).toBe(false);
    expect(finishedPanelShrinks(running, look("chat-x"))).toBe(true);
    expect(finishedPanelShrinks(running, look("chat-a"))).toBe(false);
  });

  it("stays open where you opened it, and shrinks on a new window away from its chats", () => {
    // Opened from Home: no change of view yet, so it stays.
    expect(finishedPanelShrinks(null, look(""))).toBe(false);
    expect(finishedPanelShrinks(look(""), look(""))).toBe(false);
    // The window opened with it floating over another view.
    expect(finishedPanelShrinks(undefined, look(""))).toBe(true);
    expect(finishedPanelShrinks(undefined, look("chat-a"))).toBe(false);
    // Races and runs are not its business.
    expect(finishedPanelLook("race:r1", [discussion()], "")).toBeNull();
    expect(finishedPanelLook(null, [discussion()], "")).toBeNull();
  });
});
