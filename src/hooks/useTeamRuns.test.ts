// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import {
  createLiveSessionStore,
  LiveSessionsContext,
  type LiveSessionStore,
} from "../lib/liveSessions";
import { saveRace, updateRace, type RaceRecord } from "../lib/race";
import { newSession, type Session } from "../lib/session";
import type { TeamRun } from "../lib/teamRuns";
import { useTeamOf, useTeamRun, useTeamRuns } from "./useTeamRuns";

const record: RaceRecord = {
  id: "r1",
  project: "/work/site",
  root: "/work/site",
  base: "a".repeat(40),
  prompt: "Fix the login loop",
  createdAt: 0,
  uncommitted: false,
  untracked: false,
  state: "running",
  origin: { sessionId: "chat", blockId: "msg" },
  lanes: [0, 1].map((slot) => ({
    sessionId: `l${slot}`,
    harness: slot ? ("codex" as const) : ("claude" as const),
    model: "m",
    label: slot ? "Codex" : "Claude Code",
    path: `/data/races/r1/${slot}`,
    branch: `aven/race/r1-${slot}`,
  })),
};

const lane = (id: string, text: string, busy = true): Session => ({
  ...newSession("claude", "/work/site"),
  id,
  busy,
  blocks: [
    { id: `${id}-u`, role: "user", text: "Go", startedAt: 1_000 },
    { id: `${id}-r`, role: "assistant", text, streaming: busy },
  ],
});

let root: Root;
let container: HTMLDivElement;
let store: LiveSessionStore;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
  saveRace(record);
  store = createLiveSessionStore([lane("l0", "Wor"), lane("l1", "Thi")]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function watch(use: () => TeamRun | null | readonly TeamRun[]) {
  const seen: unknown[] = [];
  function Watcher() {
    seen.push(use());
    return null;
  }
  await act(async () =>
    root.render(
      createElement(
        LiveSessionsContext.Provider,
        { value: store },
        createElement(Watcher),
      ),
    ),
  );
  return seen;
}

it("does not re-render a watcher while members stream", async () => {
  const seen = await watch(() => useTeamOf("chat"));
  expect((seen.at(-1) as TeamRun).progress).toBe("0 of 2 done");
  const renders = seen.length;
  await act(async () =>
    store.set([lane("l0", "Working on it"), lane("l1", "Thinking hard")]),
  );
  expect(seen.length).toBe(renders);
  // A lane finishing changes what the team shows.
  await act(async () =>
    store.set([lane("l0", "Done.", false), lane("l1", "Thinking hard")]),
  );
  expect(seen.length).toBe(renders + 1);
  expect((seen.at(-1) as TeamRun).members[0].state).not.toBe("working");
});

it("follows one team by id, and every team together", async () => {
  const one = await watch(() => useTeamRun("race:r1"));
  expect((one.at(-1) as TeamRun).id).toBe("race:r1");
  await act(async () => updateRace("r1", { state: "discarded" }));
  expect((one.at(-1) as TeamRun).status).toBe("stopped");
  const all = await watch(() => useTeamRuns());
  expect((all.at(-1) as TeamRun[]).map((team) => team.id)).toEqual(["race:r1"]);
});

it("finds nothing for a chat outside every team", async () => {
  const seen = await watch(() => useTeamOf("elsewhere"));
  expect(seen.at(-1)).toBeNull();
});
