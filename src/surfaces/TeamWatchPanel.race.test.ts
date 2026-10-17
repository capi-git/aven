// @vitest-environment happy-dom
import { act, createElement, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const suggest = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => text,
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async (command: string) =>
    command === "race_diff"
      ? {
          files: [{ path: "a.ts" }, { path: "b.ts" }],
          additions: 12,
          deletions: 3,
        }
      : null,
  ),
}));
vi.mock("../lib/teamResult", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/teamResult")>()),
  requestRaceSuggestion: suggest,
}));

import { useTeamWatch, type TeamWatchControls } from "../hooks/useTeamWatch";
import { recordActivity } from "../lib/activity";
import {
  createLiveSessionStore,
  LiveSessionsContext,
  type LiveSessionStore,
} from "../lib/liveSessions";
import {
  getRace,
  installRaceWorkspace,
  saveRace,
  updateRace,
  type RaceRecord,
} from "../lib/race";
import { newSession, type Block, type Session } from "../lib/session";
import { TEAM_PANEL_PREFIX } from "../lib/teamWatch";
import { installTeamWorkspace } from "../lib/teamWorkspace";
import { currentActivity } from "../lib/workspaceHome";
import { RaceCard } from "./RaceCard";
import { TeamWatchFloat } from "./TeamWatchPanel";

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
    label: slot ? "Codex · GPT-5" : "Claude Code · Opus",
    path: `/data/races/r1/${slot}`,
    branch: `aven/race/r1-${slot}`,
  })),
};

const FINAL =
  "Fixed the loop.\n\nThe cookie was read twice.\nAdded a test.\nRan it.";

function lane(
  id: string,
  busy: boolean,
  extra: Partial<Session> = {},
): Session {
  const blocks: Block[] = [
    {
      id: `${id}-user`,
      role: "user",
      text: "Go",
      startedAt: 1_000,
      ...(busy ? {} : { durationMs: 65_000 }),
    },
    busy
      ? ({
          id: `${id}-tool`,
          role: "tool",
          text: "Edit",
          tool: {
            kind: "edit",
            title: "Edit",
            preview: { path: "/work/site/redirect.ts" },
          },
        } as Block)
      : { id: `${id}-reply`, role: "assistant", text: FINAL },
  ];
  return {
    ...newSession(id === "l1" ? "codex" : "claude", "/work/site"),
    id,
    busy,
    blocks,
    ...extra,
  };
}

const completed = (sessionId: string) =>
  recordActivity({
    id: `${sessionId}:turn:t:completed`,
    sessionId,
    outcome: "completed",
    title: "",
    summary: "",
    cwd: "/work/site",
    harness: "claude",
    model: "m",
    createdAt: 70_000,
  });

let root: Root;
let container: HTMLDivElement;
let live: LiveSessionStore;
let values: Map<string, string>;
let panel: TeamWatchControls;
let renders: number;
let withCard = false;
const compare = vi.fn();
const openChat = vi.fn();
const stopLanes = vi.fn();
let uninstall: (() => void)[] = [];
const chat: Session = { ...newSession("claude", "/work/site"), id: "chat" };

function Workspace() {
  panel = useTeamWatch("main", {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  });
  return createElement(
    Profiler,
    { id: "float", onRender: () => void (renders += 1) },
    createElement(TeamWatchFloat, {
      panel,
      sessions: [chat],
      popOuts: null,
    }),
    withCard ? createElement(RaceCard, { raceId: "r1" }) : null,
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
  await act(async () => {
    await Promise.resolve();
  });
}

const view = () =>
  container.querySelector<HTMLElement>('[data-team-panel="race:r1"]');
const pill = () =>
  container.querySelector<HTMLElement>('[data-team-pill="race:r1"]');
const lanes = () => [
  ...container.querySelectorAll<HTMLElement>("[data-team-lane]"),
];
const words = (element: Element | null | undefined) =>
  element?.textContent?.replace(/\s+/g, " ").trim();
const buttons = () =>
  [...(view()?.querySelectorAll(".team-watch-actions button") ?? [])].map(
    (button) => words(button),
  );
const press = async (label: string, scope: ParentNode = container) => {
  const button = [...scope.querySelectorAll("button")].find(
    (entry) => words(entry) === label,
  );
  expect(button, `a "${label}" button`).toBeTruthy();
  await act(async () => (button as HTMLElement).click());
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  saveRace(record);
  live = createLiveSessionStore([chat, lane("l0", false), lane("l1", true)]);
  completed("l0");
  renders = 0;
  withCard = false;
  uninstall = [
    installRaceWorkspace({
      stop: stopLanes,
      settle: vi.fn(),
      release: vi.fn(),
      openChat,
      compare,
      retry: vi.fn(),
    }),
    installTeamWorkspace({
      reviewChanges: vi.fn(),
      openChat,
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
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("a race in the team panel", () => {
  it("gets a pill while it runs, and opens as columns, one per lane", async () => {
    await mount();
    expect(view()).toBeNull();
    // A race started here shows as a pill without being asked.
    expect(pill()?.dataset.state).toBe("live");
    expect(words(pill())).toContain("1 of 2 done");
    expect(words(pill())).toContain("Racing");
    expect(pill()!.querySelectorAll("[data-discussion-avatar]")).toHaveLength(
      2,
    );
    await act(async () => pill()!.click());
    expect(view()?.dataset.teamKind).toBe("race");
    expect(view()?.dataset.nativeBrowserOccluded).toBe("true");
    expect(words(view()!.querySelector(".discussion-float-title"))).toBe(
      "Race · “Fix the login loop”",
    );
    // The face-off: both mascots, the working one glowing, and a status line.
    const tiles = [...view()!.querySelectorAll(".team-watch-tile")];
    expect(tiles.map((tile) => tile.hasAttribute("data-active"))).toEqual([
      false,
      true,
    ]);
    expect(words(view()!.querySelector(".team-watch-status"))).toBe(
      "Claude and Codex are racing · 1 of 2 done",
    );
    expect(
      view()!.querySelector(".team-watch-lanes")?.getAttribute("data-lanes"),
    ).toBe("2");
    const [done, working] = lanes();
    expect(done.dataset.laneState).toBe("done");
    expect(words(done.querySelector(".team-watch-state"))).toBe("Done");
    expect(words(done)).toContain("1:05");
    expect(words(done)).toContain("+12 −3");
    expect(words(done)).toContain("2 files");
    // How it ended, in its own first lines.
    expect(done.querySelector(".team-watch-reply")?.textContent).toBe(
      "Fixed the loop.\nThe cookie was read twice.\nAdded a test.",
    );
    expect(working.dataset.laneState).toBe("working");
    expect(working.querySelector(".team-watch-doing")?.textContent).toBe(
      currentActivity(lane("l1", true)),
    );
    expect(working.querySelector(".team-watch-reply")).toBeNull();
    expect(buttons()).toEqual(["Compare", "Stop all"]);
    await press("Compare", view()!);
    expect(compare).toHaveBeenCalledWith("r1");
    await press("Stop all", view()!);
    expect(stopLanes).toHaveBeenCalledWith(["l1"]);
  });

  it("turns amber when a lane needs you, with a way to that chat", async () => {
    live.set([
      chat,
      lane("l0", false),
      lane("l1", true, {
        pendingQuestion: {
          requestId: 1,
          title: "Which cookie?",
          questions: [],
        } as never,
      }),
    ]);
    await mount();
    expect(pill()?.dataset.state).toBe("needs-you");
    expect(words(pill())).toContain("Needs you");
    await act(async () => pill()!.click());
    const [, asking] = lanes();
    expect(asking.dataset.tone).toBe("needs-you");
    expect(words(asking.querySelector(".team-watch-asking"))).toBe(
      "Which cookie?",
    );
    await press("Needs you · Go to chat", asking);
    expect(openChat).toHaveBeenCalledWith("l1");
  });

  it("is ready to compare once every lane is done, and suggests a winner", async () => {
    completed("l1");
    live.set([chat, lane("l0", false), lane("l1", false)]);
    await mount();
    expect(pill()?.dataset.state).toBe("ready");
    expect(words(pill())).toContain("Ready to compare");
    await act(async () => panel.open("race:r1"));
    expect(words(view()!.querySelector(".team-watch-status"))).toBe(
      "Ready to compare · 2 of 2 done",
    );
    expect(buttons()).toEqual([
      "Compare",
      "Suggest a winner",
      "Ask a reviewer",
    ]);
    await press("Suggest a winner", view()!);
    expect(suggest).toHaveBeenCalledWith("r1", expect.any(Function), [
      "Done",
      "Done",
    ]);
    await act(async () =>
      updateRace("r1", {
        suggestion: {
          status: "done",
          lane: 1,
          why: "It also covers logout.",
          model: "Claude Haiku 4.5",
          at: 1,
        },
      }),
    );
    expect(words(view()!.querySelector("[data-team-suggestion]"))).toBe(
      "Suggested: Codex · GPT-5 — It also covers logout.",
    );
    expect(words(lanes()[1].querySelector(".team-watch-tag"))).toBe(
      "Suggested winner",
    );
    expect(buttons()).toEqual(["Compare"]);
  });

  it("asks a chat of your choice to review it, and shows the reviewer with its role", async () => {
    completed("l1");
    const busy: Session = {
      ...newSession("codex", "/work/site"),
      id: "busy",
      title: "Busy",
      busy: true,
    };
    live.set([chat, busy, lane("l0", false), lane("l1", false)]);
    const send = vi.fn(async () => true);
    uninstall.push(
      installTeamWorkspace({
        reviewChanges: vi.fn(),
        openChat,
        send,
        watch: (id) => panel.open(id),
      }),
    );
    await mount();
    await act(async () => panel.open("race:r1"));
    await press("Ask a reviewer", view()!);
    const choices = [
      ...view()!.querySelectorAll<HTMLButtonElement>("[data-team-review]"),
    ];
    // The chat it was sent from first; never one of its own agents.
    expect(choices.map((choice) => choice.dataset.teamReview)).toEqual([
      "chat",
      "busy",
    ]);
    expect(words(choices[0])).toContain("The chat you raced from");
    expect(choices[1].disabled).toBe(true);
    await act(async () => choices[0].click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledWith("chat", expect.any(Function), {
      onSettled: expect.any(Function),
    });
    const reviewer = view()!.querySelector<HTMLElement>(
      '[data-team-reviewer="chat"]',
    )!;
    expect(reviewer.dataset.reviewState).toBe("running");
    expect(reviewer.querySelector("[data-agent-role]")?.textContent).toBe(
      "Reviewer",
    );
    expect(
      reviewer
        .querySelector("[data-discussion-avatar]")
        ?.getAttribute("data-role"),
    ).toBe("reviewer");
    expect(buttons()).toContain("Reviewing…");
    await act(async () =>
      updateRace("r1", {
        review: { ...getRace("r1")!.review!, status: "done" },
        suggestion: {
          status: "done",
          lane: 0,
          why: "It adds a test.",
          model: getRace("r1")!.review!.label,
          at: 1,
          by: "reviewer",
        },
      }),
    );
    expect(words(view()!.querySelector("[data-team-suggestion]"))).toMatch(
      /, as Reviewer, suggests Claude Code · Opus — It adds a test\.$/,
    );
  });

  it("names two models of one provider apart", async () => {
    saveRace({
      ...record,
      lanes: [
        { ...record.lanes[0], label: "Claude Code · Opus 4.6" },
        {
          ...record.lanes[1],
          harness: "claude",
          label: "Claude Code · Claude Sonnet 5",
        },
      ],
    });
    await mount();
    await act(async () => panel.open("race:r1"));
    expect(
      [...view()!.querySelectorAll(".team-watch-tile-name")].map(words),
    ).toEqual(["Claude Opus 4.6", "Claude Sonnet 5"]);
    expect(words(view()!.querySelector(".team-watch-status"))).toBe(
      "Claude Opus 4.6 and Claude Sonnet 5 are racing · 1 of 2 done",
    );
    expect(
      lanes().map((entry) => words(entry.querySelector(".team-watch-name"))),
    ).toEqual(["Claude Code · Opus 4.6", "Claude Code · Claude Sonnet 5"]);
  });

  it("opens from Watch on the race's card, shrinks to a pill and comes back where it was", async () => {
    withCard = true;
    await mount();
    const watch = container.querySelector<HTMLElement>(
      '[data-race-card] [data-team-watch="race:r1"]',
    );
    expect(watch?.textContent).toBe("Watch");
    await act(async () => watch!.click());
    expect(view()).not.toBeNull();
    expect(pill()).toBeNull();
    await act(async () =>
      view()!.querySelector<HTMLElement>("[data-team-shrink]")!.click(),
    );
    expect(view()).toBeNull();
    expect(pill()).not.toBeNull();
    const saved = JSON.parse(values.get(`${TEAM_PANEL_PREFIX}main`)!);
    expect(saved).toMatchObject({ mode: "pill", watching: ["race:r1"] });
    // Closed: no pill until it is watched again, even while it runs.
    await act(async () => pill()!.click());
    await act(async () =>
      view()!.querySelector<HTMLElement>("[data-team-close]")!.click(),
    );
    expect(view()).toBeNull();
    expect(pill()).toBeNull();
    await act(async () => watch!.click());
    expect(view()).not.toBeNull();
  });

  it("reads its result once kept, with no actions left to take", async () => {
    saveRace({
      ...record,
      state: "kept",
      finishedAt: 80_000,
      outcome: { kind: "lane", lane: 1, files: 7, why: "Smaller change." },
    });
    await mount();
    expect(pill()).toBeNull();
    await act(async () => panel.open("race:r1"));
    expect(words(view()!.querySelector(".team-watch-status"))).toBe(
      "Kept Codex · GPT-5 (7 files) · Smaller change.",
    );
    expect(words(lanes()[1].querySelector(".team-watch-state"))).toBe("Kept");
    expect(view()!.querySelector(".team-watch-actions")).toBeNull();
    await act(async () => panel.shrink());
    expect(pill()?.dataset.state).toBe("done");
  });

  it("does not redraw while a lane streams its reply", async () => {
    const streaming = (text: string): Session => ({
      ...lane("l1", true),
      blocks: [
        { id: "l1-user", role: "user", text: "Go", startedAt: 1_000 },
        { id: "l1-reply", role: "assistant", text, streaming: true },
      ],
    });
    live.set([chat, lane("l0", false), streaming("Look")]);
    await mount();
    await act(async () => panel.open("race:r1"));
    await act(async () => {
      await Promise.resolve();
    });
    const before = renders;
    for (const text of ["Looking", "Looking at the", "Looking at the cookie"])
      await act(async () =>
        live.set([chat, lane("l0", false), streaming(text)]),
      );
    expect(renders).toBe(before);
    // What it shows changing does redraw it.
    completed("l1");
    await act(async () =>
      live.set([chat, lane("l0", false), lane("l1", false)]),
    );
    expect(renders).toBeGreaterThan(before);
    expect(lanes()[1].dataset.laneState).toBe("done");
  });
});
