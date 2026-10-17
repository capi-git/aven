// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/harness/child", () => ({ resolveClaudeBinary: vi.fn() }));
vi.mock("../lib/floatingSidebar", () => ({
  nativeFloatingSidebar: { send: vi.fn(), listen: vi.fn() },
}));
vi.mock("../surfaces/AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => text,
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async () => null),
}));

import { recordActivity } from "../lib/activity";
import {
  createLiveSessionStore,
  LiveSessionsContext,
  type LiveSessionStore,
} from "../lib/liveSessions";
import { installRaceWorkspace, saveRace, type RaceRecord } from "../lib/race";
import { newSession, type Session } from "../lib/session";
import type { TeamWatchOwner } from "../lib/teamWatchBridge";
import { installTeamWorkspace } from "../lib/teamWorkspace";
import { RaceCard } from "../surfaces/RaceCard";
import { TeamWatchFloat } from "../surfaces/TeamWatchPanel";
import { checkTeamPanel, type SmokeWindow } from "./useDevSmoke";
import { useTeamWatch, type TeamWatchControls } from "./useTeamWatch";

const record: RaceRecord = {
  id: "r1",
  project: "/work/site",
  root: "/work/site",
  base: "a".repeat(40),
  prompt: "Build the change",
  createdAt: 0,
  uncommitted: false,
  untracked: false,
  state: "running",
  origin: { sessionId: "chat", blockId: "msg" },
  lanes: [0, 1].map((slot) => ({
    sessionId: `l${slot}`,
    harness: slot ? ("grok" as const) : ("claude" as const),
    model: "m",
    label: slot ? "Grok Build" : "Claude Code",
    path: `/data/races/r1/${slot}`,
    branch: `aven/race/r1-${slot}`,
  })),
};

const lane = (id: string, busy: boolean): Session => ({
  ...newSession("claude", "/work/site"),
  id,
  busy,
  blocks: [{ id: `${id}-user`, role: "user", text: "Go", startedAt: 1_000 }],
});

let root: Root;
let container: HTMLDivElement;
let live: LiveSessionStore;
let panel: TeamWatchControls;
let popOuts: TeamWatchOwner | null;
let closeThere: ((team: string) => void) | undefined;
let opened: string[];
let uninstall: (() => void)[] = [];
const chat: Session = { ...newSession("claude", "/work/site"), id: "chat" };

/** The host's bridge: each open becomes a window the check can find and close. */
function fakePopOuts(): TeamWatchOwner {
  return {
    open: vi.fn(async (team: string) => void opened.push(team)),
    update: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    reset: vi.fn(async () => {}),
    reply: vi.fn(async () => {}),
    // The check never acts from a pop-out, so nothing listens here.
    onAction: vi.fn(async () => () => {}),
    onFocus: vi.fn(async () => () => {}),
    onClosed: vi.fn(async (callback: (team: string) => void) => {
      closeThere = callback;
      return () => {};
    }),
  };
}

const windows = async (): Promise<SmokeWindow[]> =>
  opened.map((team, index) => ({
    label: `team-watch-${index}`,
    isVisible: async () => true,
    close: async () => {
      opened = opened.filter((entry) => entry !== team);
      act(() => closeThere?.(team));
    },
  }));

function Workspace() {
  panel = useTeamWatch("main", localStorage);
  return createElement(
    "div",
    null,
    createElement(TeamWatchFloat, { panel, sessions: [chat], popOuts }),
    createElement(RaceCard, { raceId: "r1" }),
  );
}

async function mount() {
  await act(async () =>
    root.render(
      createElement(
        LiveSessionsContext.Provider,
        { value: live },
        createElement(Workspace),
      ),
    ),
  );
}

const watch = () =>
  document.querySelector<HTMLElement>(
    '[data-race-card] [data-team-watch="race:r1"]',
  );
const lanes = (panel: HTMLElement) =>
  [...panel.querySelectorAll("[data-team-lane]")]
    .map((lane) => lane.getAttribute("data-lane-state"))
    .join();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  // On screen, as the check reads it.
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(
    () => [{ top: 0, height: 10 }] as unknown as DOMRectList,
  );
  saveRace(record);
  live = createLiveSessionStore([chat, lane("l0", true), lane("l1", false)]);
  recordActivity({
    id: "l1:turn:t:failed",
    sessionId: "l1",
    outcome: "failed",
    title: "",
    summary: "",
    cwd: "/work/site",
    harness: "grok",
    model: "m",
    createdAt: 70_000,
  });
  opened = [];
  popOuts = fakePopOuts();
  uninstall = [
    installRaceWorkspace({
      stop: vi.fn(),
      settle: vi.fn(),
      release: vi.fn(),
      openChat: vi.fn(),
      compare: vi.fn(),
      retry: vi.fn(),
    }),
    installTeamWorkspace({
      reviewChanges: vi.fn(),
      openChat: vi.fn(),
      send: vi.fn(async () => true),
      watch: (id) => panel.open(id),
    }),
  ];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  for (const stop of uninstall) stop();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the real-app check's team panel", () => {
  it("watches a race, shrinks it to a pill, pops it out and takes it back", async () => {
    await mount();
    const detail = await checkTeamPanel(
      "race:r1",
      watch,
      (shown) =>
        lanes(shown) === "working,failed" ? null : `lanes ${lanes(shown)}`,
      windows,
    );
    expect(detail).toBe(
      'Watch opened its panel; it shrank to "0 of 2 done · 1 failed · Racing" and came back; it popped out into a window that showed itself, and closing that left a pill',
    );
    expect(popOuts?.open).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('[data-team-panel="race:r1"]'),
    ).not.toBeNull();
  });

  it("stops at Watch where there is no pop-out", async () => {
    popOuts = null;
    await mount();
    await expect(
      checkTeamPanel("race:r1", watch, () => null, windows),
    ).resolves.toBe(
      'Watch opened its panel; it shrank to "0 of 2 done · 1 failed · Racing" and came back; no pop-out here',
    );
  });

  it("fails with what the panel showed instead", async () => {
    await mount();
    await expect(
      checkTeamPanel(
        "race:r1",
        watch,
        (shown) => `its lanes read ${lanes(shown)}`,
        windows,
      ),
    ).rejects.toThrow(
      "Timed out waiting for the panel to show the team: its lanes read working,failed",
    );
    await expect(
      checkTeamPanel(
        "race:r9",
        () => null,
        () => null,
        windows,
      ),
    ).rejects.toThrow("There is no Watch for race:r9");
  }, 20_000);
});
