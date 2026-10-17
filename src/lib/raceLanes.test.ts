import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "./activity";
import type { RaceRecord } from "./race";
import {
  raceDiscardQuestion,
  raceKeepQuestion,
  raceLaneSeconds,
  raceLaneState,
  raceOutcomeText,
  raceProgress,
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
      title: "Keep Claude Code's version?",
      body: "This stops 2 agents still working and deletes their copies.",
      confirm: "Keep Claude Code's version",
    });
  });

  it("names what discarding deletes", () => {
    expect(
      raceDiscardQuestion(race(2), [lane("done"), lane("done")]).body,
    ).toBe("This deletes both copies. Your project is not changed.");
    expect(
      raceDiscardQuestion(
        race(),
        [lane("done"), lane("working"), lane("done")],
        [
          {
            files: [1, 2].map((n) => ({
              path: `${n}.ts`,
              status: "added" as const,
              additions: 1,
              deletions: 0,
              binary: false,
            })),
            additions: 2,
            deletions: 0,
          },
          undefined,
          undefined,
        ],
      ).body,
    ).toBe(
      "This stops 1 agent still working and deletes all 3 copies and the changes in them: Claude Code (2 files). Your project is not changed.",
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
});
