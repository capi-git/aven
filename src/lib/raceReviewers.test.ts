// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import type { OrchestrationRun } from "./orchestration";
import type { RaceRecord } from "./race";
import { reviewerChoices } from "./raceReviewers";
import { newSession, type Session } from "./session";

const race: RaceRecord = {
  id: "r1",
  project: "/work/site",
  root: "/work/site",
  base: "a".repeat(40),
  prompt: "Fix the login loop",
  createdAt: 0,
  uncommitted: false,
  untracked: false,
  state: "running",
  lanes: [],
};

const chat = (id: string, patch: Partial<Session> = {}): Session => ({
  ...newSession("claude", "/work/site"),
  id,
  title: `Claude Code · ${id}`,
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

it("leaves out a lead with an open run and a chat a run holds back", () => {
  const sessions = [chat("free"), chat("lead"), chat("held"), chat("done")];
  const runs = {
    run: (id: string) =>
      id === "lead"
        ? ({ status: "active" } as OrchestrationRun)
        : id === "done"
          ? ({ status: "finished" } as OrchestrationRun)
          : undefined,
    blockingRun: (id: string) =>
      id === "held" ? ({ status: "active" } as OrchestrationRun) : undefined,
  };
  expect(
    reviewerChoices(race, { list: () => sessions }, runs).map(
      (choice) => choice.sessionId,
    ),
  ).toEqual(["done", "free"]);
});

it("names a chat by its own model, never another one's", () => {
  const [choice] = reviewerChoices(
    race,
    { list: () => [chat("c", { model: "claude:not-a-model" })] },
    { run: () => undefined, blockingRun: () => undefined },
  );
  expect(choice.label).toBe("Claude · not-a-model");
});
