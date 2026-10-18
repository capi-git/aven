// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  isTauri: () => false,
}));

import {
  discussionStore,
  resetDiscussionStore,
  type DiscussionParty,
} from "../lib/discussions";
import { saveRace, updateRace, type RaceRecord } from "../lib/race";
import { ENDED_RACE_PILL_MS } from "../lib/teamPanelTidy";
import { EMPTY_TEAM_PANEL, type TeamPanelState } from "../lib/teamWatch";
import { useTeamPanelTidy } from "./useTeamPanelTidy";
import type { TeamWatchControls } from "./useTeamWatch";

const race: RaceRecord = {
  id: "r1",
  project: "/work/site",
  root: "/work/site",
  base: "a".repeat(40),
  prompt: "Fix it",
  createdAt: 0,
  uncommitted: false,
  untracked: false,
  state: "running",
  lanes: [],
};

const A: DiscussionParty = {
  sessionId: "chat-a",
  harness: "claude",
  model: "Claude Sonnet 5",
  title: "Caching plan",
  cwd: "/work/site",
};
const B: DiscussionParty = { ...A, sessionId: "chat-b", harness: "codex" };

let root: Root;
let container: HTMLDivElement;
let closed: string[];
let shrunk: number;

function Probe({ state, view }: { state: TeamPanelState; view: string }) {
  useTeamPanelTidy(
    {
      state,
      close: (id: string) => closed.push(id),
      shrink: () => (shrunk += 1),
    } as unknown as TeamWatchControls,
    view,
  );
  return null;
}

async function render(state: TeamPanelState, view = "") {
  await act(async () => root.render(createElement(Probe, { state, view })));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  resetDiscussionStore("main");
  closed = [];
  shrunk = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetDiscussionStore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the window's team panel keeps to live work", () => {
  it("lets a kept race's pill say so, then puts it away", async () => {
    saveRace(race);
    const state = { ...EMPTY_TEAM_PANEL, watching: ["race:r1"] };
    await render(state);
    await act(async () => vi.advanceTimersByTime(60_000));
    // Still racing: its pill stays.
    expect(closed).toEqual([]);
    await act(async () =>
      updateRace("r1", { state: "kept", finishedAt: Date.now() }),
    );
    await act(async () => vi.advanceTimersByTime(ENDED_RACE_PILL_MS - 100));
    expect(closed).toEqual([]);
    await act(async () => vi.advanceTimersByTime(200));
    expect(closed).toEqual(["race:r1"]);
  });

  it("shrinks a finished discussion's panel once you leave its chat", async () => {
    const store = discussionStore();
    store.start({ id: "d1", a: A, b: B, topic: "Cache it?", rounds: 1 });
    store.markDelivered("d1");
    store.settle("d1", 0, { status: "completed", text: "Yes." });
    store.markDelivered("d1");
    store.settle("d1", 1, { status: "completed", text: "Agreed." });
    const state = {
      ...EMPTY_TEAM_PANEL,
      watching: ["discuss:d1"],
      expanded: "discuss:d1",
    };
    await render(state, "chat-a");
    expect(shrunk).toBe(0);
    await render(state, "chat-a\nchat-z");
    expect(shrunk).toBe(0);
    // Home: no chat on screen.
    await render(state, "");
    expect(shrunk).toBe(1);
  });
});
