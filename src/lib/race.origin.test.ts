// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { groupTurns } from "../surfaces/transcriptActivity";
import {
  getRace,
  noteRaceStats,
  raceLaneEnded,
  raceLaneStarted,
  raceOriginBlock,
  saveRace,
  updateRace,
  type RaceRecord,
} from "./race";
import { newSession, type Block } from "./session";
import { sanitizeSessionForPersist } from "./sessionStore";

const record = (patch: Partial<RaceRecord> = {}): RaceRecord => ({
  id: "r1",
  project: "/work/site",
  root: "/work/site",
  base: "a".repeat(40),
  prompt: "Fix the login loop",
  createdAt: 0,
  uncommitted: false,
  untracked: false,
  state: "running",
  lanes: [0, 1].map((slot) => ({
    sessionId: `l${slot}`,
    harness: slot ? ("codex" as const) : ("claude" as const),
    model: "m",
    label: slot ? "Codex" : "Claude Code",
    path: `/data/races/r1/${slot}`,
    branch: `aven/race/r1-${slot}`,
  })),
  ...patch,
});

beforeEach(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
});

it("keeps your message in the chat the race started from", () => {
  const block = raceOriginBlock("r1", "Fix the login loop", [], 1_000);
  expect(block).toMatchObject({
    role: "system",
    text: "Fix the login loop",
    startedAt: 1_000,
    team: { kind: "race", id: "r1" },
  });
  saveRace(record({ origin: { sessionId: "chat", blockId: block.id } }));
  expect(getRace("r1")?.origin).toEqual({
    sessionId: "chat",
    blockId: block.id,
  });
});

it("saves the message with the chat, as a turn of its own", () => {
  const earlier: Block[] = [
    { id: "u1", role: "user", text: "Hello", startedAt: 10 },
    { id: "a1", role: "assistant", text: "Hi." },
  ];
  const block = raceOriginBlock("r1", "Race this");
  const chat = {
    ...newSession("claude", "/work/site"),
    blocks: [...earlier, block],
  };
  const saved = sanitizeSessionForPersist(chat);
  expect(saved.blocks.at(-1)).toMatchObject({
    role: "system",
    text: "Race this",
    team: { kind: "race", id: "r1" },
  });
  const turns = groupTurns(saved.blocks);
  expect(turns).toHaveLength(2);
  expect(turns[1]).toEqual([saved.blocks.at(-1)]);
});

it("drops a malformed team mark rather than the message", () => {
  const chat = {
    ...newSession("claude", "/work/site"),
    blocks: [
      {
        id: "x",
        role: "system" as const,
        text: "Note",
        team: { kind: "other", id: 3 } as never,
      },
    ],
  };
  const saved = sanitizeSessionForPersist(chat);
  expect(saved.blocks[0].text).toBe("Note");
  expect(saved.blocks[0].team).toBeUndefined();
});

it("remembers lane changes only when they move", () => {
  saveRace(record());
  const listener = vi.fn();
  window.addEventListener("aven:races-changed", listener);
  const diff = { files: [], additions: 3, deletions: 1 };
  noteRaceStats("r1", [diff, undefined]);
  expect(getRace("r1")?.stats).toEqual([
    { files: 0, additions: 3, deletions: 1 },
    null,
  ]);
  expect(listener).toHaveBeenCalledTimes(1);
  noteRaceStats("r1", [diff, undefined]);
  expect(listener).toHaveBeenCalledTimes(1);
  updateRace("r1", { state: "kept" });
  noteRaceStats("r1", [{ ...diff, additions: 9 }, undefined]);
  expect(getRace("r1")?.stats?.[0]?.additions).toBe(3);
  window.removeEventListener("aven:races-changed", listener);
});

it("keeps how each lane ended with the race, and forgets it for a new turn", () => {
  saveRace(record({ suggestion: { status: "failed", at: 5 } }));
  raceLaneEnded("l1", "completed", 50);
  expect(getRace("r1")?.ends).toEqual([null, { kind: "done", at: 50 }]);
  raceLaneEnded("l0", "failed", 60);
  expect(getRace("r1")?.ends).toEqual([
    { kind: "failed", at: 60 },
    { kind: "done", at: 50 },
  ]);
  // A retried lane: its ending, and the suggestion that judged it, go.
  raceLaneStarted("l0");
  expect(getRace("r1")?.ends).toEqual([null, { kind: "done", at: 50 }]);
  expect(getRace("r1")?.suggestion).toBeUndefined();
  // Not a lane, or a race that is over: nothing changes.
  raceLaneEnded("chat", "completed");
  updateRace("r1", { state: "kept" });
  raceLaneEnded("l0", "completed", 70);
  expect(getRace("r1")?.ends?.[0]).toBeNull();
});
