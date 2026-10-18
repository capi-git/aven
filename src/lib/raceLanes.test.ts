import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "./activity";
import type { RaceRecord } from "./race";
import {
  raceDiscardQuestion,
  raceKeepAsks,
  raceKeepQuestion,
  raceKeptWhy,
  raceLaneCanRetry,
  raceLaneSeconds,
  raceLaneState,
  raceOutcomeText,
  raceProgress,
  raceSuggestionText,
  type RaceLaneKind,
  type RaceLaneState,
} from "./raceLanes";
import { newSession, type Session } from "./session";

const race = (lanes = 3, patch: Partial<RaceRecord> = {}): RaceRecord => ({
  id: "r1",
  project: "/work/site",
  root: "/work/site",
  base: "a".repeat(40),
  prompt: "Fix the login loop",
  createdAt: 1,
  uncommitted: false,
  untracked: false,
  state: "running",
  lanes: (["claude", "codex", "grok"] as const)
    .slice(0, lanes)
    .map((harness, slot) => ({
      sessionId: `s${slot}`,
      harness,
      model: "m",
      label: harness,
      path: `/data/races/r1/${slot}`,
      branch: `aven/race/r1-${slot}`,
    })),
  ...patch,
});

const lane = (kind: RaceLaneKind): RaceLaneState => ({ kind, label: kind });

const entry = (
  sessionId: string,
  outcome: ActivityEntry["outcome"],
  createdAt: number,
  resolvedAt: number | null = null,
): ActivityEntry => ({
  id: `${sessionId}:turn:t:${outcome}`,
  sessionId,
  outcome,
  title: "",
  summary: "",
  cwd: "/work/site",
  harness: "claude",
  model: "m",
  createdAt,
  readAt: null,
  resolvedAt,
});

describe("lane states", () => {
  it("reads a chat that is not loaded from its latest recorded outcome", () => {
    expect(raceLaneState("s0", undefined, []).kind).toBe("closed");
    // Kept with the race: a cleared ledger still knows it finished.
    expect(
      raceLaneState("s0", undefined, [], { kind: "done", at: 4 }).kind,
    ).toBe("done");
    expect(
      raceLaneState("s0", undefined, [entry("s0", "failed", 9)], {
        kind: "done",
        at: 4,
      }).kind,
    ).toBe("failed");
    expect(
      raceLaneState("s0", undefined, [
        entry("s0", "completed", 1),
        entry("s0", "failed", 2),
        entry("s1", "completed", 3),
      ]).kind,
    ).toBe("failed");
    expect(
      raceLaneState("s0", undefined, [entry("s0", "approval", 1)]).label,
    ).toBe("Needs you");
    // A team's notice posted on the chat ("Race ready") is not how it ended.
    const notice = {
      ...entry("s0", "completed", 9),
      id: "s0:team:r1:ready:8",
    };
    expect(
      raceLaneState("s0", undefined, [notice], { kind: "failed", at: 4 }).kind,
    ).toBe("failed");
    expect(raceLaneState("s0", undefined, [notice]).kind).toBe("closed");
    // The race saw its turn start: working where it is held, not "closed"
    // because this window doesn't hold it.
    expect(raceLaneState("s0", undefined, [], null).kind).toBe("working");
    expect(
      raceLaneState("s0", undefined, [entry("s0", "completed", 1)], null).kind,
    ).toBe("working");
  });

  it("tells a lane that never started from one that finished", () => {
    const fresh: Session = { ...newSession("claude", "/work/site"), id: "s0" };
    expect(raceLaneState("s0", fresh, []).label).toBe("Not started");
    const queued: Session = {
      ...fresh,
      blocks: [{ id: "u", role: "user", text: "Go", startedAt: 5 }],
      queuedMessages: [{ id: "q", text: "Next", attachments: [] }],
    };
    expect(raceLaneState("s0", queued, []).kind).toBe("working");
  });

  it("stops the clock at the lane's own end, and runs it while working", () => {
    expect(
      raceLaneSeconds(
        { kind: "done", label: "Done", startedAt: 0, durationMs: 61_000 },
        999_999,
      ),
    ).toBe(61);
    expect(
      raceLaneSeconds({ kind: "working", label: "", startedAt: 1_000 }, 31_000),
    ).toBe(30);
    expect(raceLaneSeconds(lane("closed"), 5)).toBeNull();
  });
});

describe("race wording", () => {
  it("counts what is done and what else happened", () => {
    expect(raceProgress([lane("done"), lane("done"), lane("working")])).toBe(
      "2 of 3 done",
    );
    expect(
      raceProgress([lane("waiting"), lane("failed"), lane("interrupted")]),
    ).toBe("0 of 3 done · 1 needs you · 1 failed · 1 interrupted");
  });

  it("says what keeping one lane stops and deletes", () => {
    expect(
      raceKeepQuestion(race(), 0, [
        lane("done"),
        lane("working"),
        lane("waiting"),
      ]),
    ).toEqual({
      title: "Keep Claude's version?",
      body: "This stops 2 agents still working and deletes the other agents' work.",
      confirm: "Keep Claude's version",
    });
  });

  it("says keeping deletes a finished agent's work, and asks only then", () => {
    const done = [lane("done"), lane("done")];
    expect(raceKeepQuestion(race(2), 0, done, [2, 3]).body).toBe(
      "This deletes Codex's work (3 files).",
    );
    expect(raceKeepAsks(race(2), 0, done, [2, 3])).toBe(true);
    // Nothing else changed and nothing works: nothing to lose.
    expect(raceKeepAsks(race(2), 0, done, [2, 0])).toBe(false);
    expect(raceKeepAsks(race(2), 0, [lane("done"), lane("working")])).toBe(
      true,
    );
  });

  it("offers Retry for any agent that stopped without finishing", () => {
    for (const kind of ["failed", "interrupted", "stopped", "closed"] as const)
      expect(raceLaneCanRetry(lane(kind))).toBe(true);
    for (const kind of ["done", "working", "waiting", "unstarted"] as const)
      expect(raceLaneCanRetry(lane(kind))).toBe(false);
  });

  it("names what discarding deletes", () => {
    expect(
      raceDiscardQuestion(race(2), [lane("done"), lane("done")]).body,
    ).toBe("This deletes the agents' work. Your project doesn't change.");
    expect(
      raceDiscardQuestion(
        race(),
        [lane("done"), lane("working"), lane("done")],
        [2, 0, undefined],
      ).body,
    ).toBe(
      "This stops 1 agent still working and deletes Claude's work (2 files). Your project doesn't change.",
    );
  });

  it("describes what a kept race brought in", () => {
    expect(
      raceOutcomeText(
        race(3, {
          state: "kept",
          outcome: { kind: "lane", lane: 1, files: 1 },
        }),
      ),
    ).toBe("Kept Codex's version · 1 file");
    expect(raceOutcomeText(race(3, { state: "discarded" }))).toBeNull();
  });

  it("never says Lane N: a judge's numbers read as the agents' names", () => {
    const suggested = race(3, {
      suggestion: {
        status: "done",
        lane: 1,
        why: "Lane 2 tested it, unlike lane 1 and agent 3.",
        model: "Claude Haiku 4.5",
        at: 1,
      },
    });
    expect(raceSuggestionText(suggested)).toBe(
      "Aven suggests Codex: Codex tested it, unlike Claude and Grok.",
    );
    expect(
      raceKeptWhy(
        race(3, {
          state: "kept",
          outcome: {
            kind: "lane",
            lane: 1,
            files: 2,
            why: "Lane 2 says it tested.",
          },
        }),
      ),
    ).toBe("Codex says it tested.");
    expect(raceKeptWhy(race(3))).toBeUndefined();
  });
});
