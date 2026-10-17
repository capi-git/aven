// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => text,
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async () => null),
}));

import { useTeamWatch, type TeamWatchControls } from "../hooks/useTeamWatch";
import { recordActivity } from "../lib/activity";
import {
  discussionStore,
  resetDiscussionStore,
  type DiscussionHost,
  type DiscussionParty,
} from "../lib/discussions";
import {
  createLiveSessionStore,
  LiveSessionsContext,
  type LiveSessionStore,
} from "../lib/liveSessions";
import {
  getRace,
  installRaceWorkspace,
  saveRace,
  type RaceRecord,
} from "../lib/race";
import { newSession, type Session } from "../lib/session";
import type { TeamWatchRequest, TeamWatchView } from "../lib/teamWatch";
import type { TeamWatchOwner, TeamWatchSnapshot } from "../lib/teamWatchBridge";
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

const lane = (id: string, busy: boolean): Session => ({
  ...newSession("claude", "/work/site"),
  id,
  busy,
  blocks: [
    { id: `${id}-user`, role: "user", text: "Go", startedAt: 1_000 },
    ...(busy
      ? []
      : [{ id: `${id}-reply`, role: "assistant" as const, text: "Done." }]),
  ],
});

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

/** The host's side of the bridge, recorded, with a way to press buttons in a pop-out. */
function fakeBridge() {
  let onAction: ((request: TeamWatchRequest) => void) | undefined;
  let onClosed: ((team: string) => void) | undefined;
  const bridge = {
    open: vi.fn(async () => {}),
    update: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    reset: vi.fn(async () => {}),
    reply: vi.fn(async () => {}),
    onAction: vi.fn(async (callback: (request: TeamWatchRequest) => void) => {
      onAction = callback;
      return () => {
        onAction = undefined;
      };
    }),
    onClosed: vi.fn(async (callback: (team: string) => void) => {
      onClosed = callback;
      return () => {
        onClosed = undefined;
      };
    }),
  } satisfies TeamWatchOwner;
  return {
    bridge,
    press: (team: string, action: unknown, requestId = "req-1") =>
      onAction?.({ team, requestId, action }),
    closeThere: (team: string) => onClosed?.(team),
  };
}

let root: Root;
let container: HTMLDivElement;
let live: LiveSessionStore;
let values: Map<string, string>;
let panel: TeamWatchControls;
let host: ReturnType<typeof fakeBridge>;
let discussionHost: DiscussionHost | undefined;
const compare = vi.fn();
let uninstall: () => void;
const chat: Session = { ...newSession("claude", "/work/site"), id: "chat" };

function Workspace({ sessions }: { sessions: Session[] }) {
  panel = useTeamWatch("main", {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  });
  return createElement(TeamWatchFloat, {
    panel,
    sessions,
    host: discussionHost,
    popOuts: host.bridge,
  });
}

async function mount(sessions: Session[] = [chat]) {
  await act(async () =>
    root.render(
      createElement(
        LiveSessionsContext.Provider,
        { value: live },
        createElement(Workspace, { sessions }),
      ),
    ),
  );
  await settle();
}

/** Let effects, the bridge's promises and a deferred close run. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });

const view = () =>
  container.querySelector<HTMLElement>('[data-team-panel="race:r1"]');
const pill = () =>
  container.querySelector<HTMLElement>('[data-team-pill="race:r1"]');
const lastSnapshot = (
  mock: typeof host.bridge.open | typeof host.bridge.update,
): TeamWatchSnapshot => {
  const call = mock.mock.calls.at(-1) as unknown[] | undefined;
  return call?.find(
    (entry) => entry && typeof entry === "object" && "theme" in entry,
  ) as TeamWatchSnapshot;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  resetDiscussionStore("main");
  saveRace(record);
  live = createLiveSessionStore([chat, lane("l0", false), lane("l1", true)]);
  completed("l0");
  host = fakeBridge();
  discussionHost = undefined;
  uninstall = installRaceWorkspace({
    stop: vi.fn(),
    settle: vi.fn(),
    release: vi.fn(),
    openChat: vi.fn(),
    compare,
    retry: vi.fn(),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  uninstall();
  container.remove();
  resetDiscussionStore();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function popOut() {
  await act(async () => panel.open("race:r1"));
  await act(async () =>
    view()!.querySelector<HTMLElement>("[data-team-pop-out]")!.click(),
  );
  await settle();
}

describe("a team popped out into its own window", () => {
  it("closes pop-outs an earlier page left, then opens one where the panel sat", async () => {
    await mount();
    expect(host.bridge.reset).toHaveBeenCalled();
    await popOut();
    // It left the window: no panel, no pill.
    expect(view()).toBeNull();
    expect(pill()).toBeNull();
    expect(host.bridge.open).toHaveBeenCalledTimes(1);
    const [team, title, snapshot, at] = host.bridge.open.mock
      .calls[0] as unknown as [string, string, TeamWatchSnapshot, object];
    expect(team).toBe("race:r1");
    expect(title).toBe("Race · “Fix the login loop”");
    expect(snapshot.view?.team.id).toBe("race:r1");
    expect(snapshot.view?.team.members.map((member) => member.state)).toEqual([
      "done",
      "working",
    ]);
    expect(snapshot.theme.mode).toBeDefined();
    expect(at).toMatchObject({ dpr: expect.any(Number) });
    const saved = JSON.parse(values.get("aven.teamPanel.main")!);
    expect(saved.popped).toBeUndefined();
  });

  it("sends what changes, once", async () => {
    await mount();
    await popOut();
    expect(host.bridge.update).not.toHaveBeenCalled();
    completed("l1");
    await act(async () =>
      live.set([chat, lane("l0", false), lane("l1", false)]),
    );
    await settle();
    expect(host.bridge.update).toHaveBeenCalledTimes(1);
    const sent = lastSnapshot(host.bridge.update).view as TeamWatchView;
    expect(sent.team.status).toBe("ready");
    // The same view again is not sent again.
    await act(async () =>
      live.set([chat, lane("l0", false), lane("l1", false)]),
    );
    await settle();
    expect(host.bridge.update).toHaveBeenCalledTimes(1);
  });

  it("sends a change made while its window opens once it has opened", async () => {
    let opened!: () => void;
    host.bridge.open.mockImplementationOnce(
      () => new Promise<void>((resolve) => (opened = resolve)),
    );
    await mount();
    await popOut();
    completed("l1");
    await act(async () =>
      live.set([chat, lane("l0", false), lane("l1", false)]),
    );
    await settle();
    // The host has no window to update yet: nothing goes out.
    expect(host.bridge.update).not.toHaveBeenCalled();
    await act(async () => opened());
    await settle();
    expect(host.bridge.update).toHaveBeenCalledTimes(1);
    expect(
      (lastSnapshot(host.bridge.update).view as TeamWatchView).team.status,
    ).toBe("ready");
  });

  it("answers Suggest a winner once it starts, not when the model replies", async () => {
    completed("l1");
    live.set([chat, lane("l0", false), lane("l1", false)]);
    await mount();
    await popOut();
    // Answered at once; the pop-out sees "Suggesting…" in the race's view,
    // then the pick (here, no model answers, so it says it couldn't).
    host.press("race:r1", { kind: "suggest" }, "s-1");
    expect(host.bridge.reply).toHaveBeenLastCalledWith("race:r1", "s-1", null);
    expect(getRace("r1")?.suggestion?.status).toBe("running");
    // A second press while it runs is refused, not started again.
    host.press("race:r1", { kind: "suggest" }, "s-2");
    expect(host.bridge.reply).toHaveBeenLastCalledWith(
      "race:r1",
      "s-2",
      "A suggestion is already on its way.",
    );
    await settle();
    expect(
      (lastSnapshot(host.bridge.update).view as TeamWatchView).race?.suggestion,
    ).toEqual({ status: "failed" });
  });

  it("does what the pop-out asks, after checking it against the team", async () => {
    await mount();
    await popOut();
    await act(async () => host.press("race:r1", { kind: "compare" }, "a-1"));
    expect(compare).toHaveBeenCalledWith("r1");
    expect(host.bridge.reply).toHaveBeenLastCalledWith("race:r1", "a-1", null);
    // A discussion's action on a race, a stranger's chat, a team not out.
    await act(async () =>
      host.press("race:r1", { kind: "jump-in", text: "Hi" }, "a-2"),
    );
    await act(async () =>
      host.press("race:r1", { kind: "open-chat", sessionId: "else" }, "a-3"),
    );
    await act(async () => host.press("race:r9", { kind: "stop" }, "a-4"));
    for (const id of ["a-2", "a-3"])
      expect(host.bridge.reply).toHaveBeenCalledWith(
        "race:r1",
        id,
        "Aven can't do that from here.",
      );
    expect(host.bridge.reply).toHaveBeenCalledWith(
      "race:r9",
      "a-4",
      "Aven can't do that from here.",
    );
    expect(compare).toHaveBeenCalledTimes(1);
  });

  it("comes back as the panel on ↙, closing its window", async () => {
    await mount();
    await popOut();
    await act(async () => host.press("race:r1", { kind: "watch" }));
    await settle();
    expect(view()).not.toBeNull();
    expect(host.bridge.close).toHaveBeenCalledWith("race:r1");
  });

  it("comes back as a pill when its window is closed there", async () => {
    await mount();
    await popOut();
    await act(async () => host.closeThere("race:r1"));
    await settle();
    expect(view()).toBeNull();
    expect(pill()).not.toBeNull();
    // That window is already gone: nothing to close.
    expect(host.bridge.close).not.toHaveBeenCalled();
  });

  it("brings its window forward on Watch rather than taking it back", async () => {
    await mount();
    await popOut();
    await act(async () => panel.open("race:r1"));
    await settle();
    expect(view()).toBeNull();
    expect(host.bridge.open).toHaveBeenCalledTimes(2);
    expect(host.bridge.close).not.toHaveBeenCalled();
  });

  it("stays in the window when its own window cannot open", async () => {
    host.bridge.open.mockRejectedValueOnce(new Error("no window"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await mount();
    await popOut();
    expect(view()).not.toBeNull();
  });

  it("offers no ↗ where pop-outs are not available", async () => {
    await act(async () =>
      root.render(
        createElement(
          LiveSessionsContext.Provider,
          { value: live },
          createElement(function NoPopOuts() {
            panel = useTeamWatch("main", {
              getItem: (key) => values.get(key) ?? null,
              setItem: (key, value) => void values.set(key, value),
            });
            return createElement(TeamWatchFloat, {
              panel,
              sessions: [chat],
              popOuts: null,
            });
          }),
        ),
      ),
    );
    await act(async () => panel.open("race:r1"));
    expect(view()?.querySelector("[data-team-pop-out]")).toBeNull();
    expect(view()?.querySelector("[data-team-shrink]")).not.toBeNull();
  });

  it("carries a discussion's thread out and passes what the user adds back", async () => {
    const A: DiscussionParty = {
      sessionId: "a",
      harness: "claude",
      model: "Opus",
      title: "Caching",
      cwd: "/work/site",
    };
    const B: DiscussionParty = {
      sessionId: "b",
      harness: "codex",
      model: "GPT-5",
      title: "Review",
      cwd: "/work/site",
    };
    discussionHost = {
      options: () => ({ candidates: [] }),
      start: () => null,
      show: vi.fn(),
    };
    discussionStore().start({
      id: "d1",
      a: A,
      b: B,
      topic: "Cache the lookups?",
      rounds: 2,
    });
    discussionStore().markDelivered("d1");
    const a: Session = { ...newSession("claude", "/work/site"), id: "a" };
    const b: Session = { ...newSession("codex", "/work/site"), id: "b" };
    await mount([a, b]);
    await act(async () => panel.open("discuss:d1"));
    await act(async () =>
      container
        .querySelector<HTMLElement>(
          '[data-discussion-panel="d1"] [data-team-pop-out]',
        )!
        .click(),
    );
    await settle();
    const snapshot = lastSnapshot(host.bridge.open);
    expect(snapshot.view?.discussion?.items[0]).toMatchObject({
      kind: "topic",
      text: "Cache the lookups?",
    });
    expect(snapshot.view?.discussion?.record.relay).toBe("");
    expect(snapshot.view?.can).toMatchObject({
      jumpIn: true,
      openChat: true,
      build: false,
    });
    await act(async () =>
      host.press("discuss:d1", { kind: "jump-in", text: "Mind the TTL." }),
    );
    expect(host.bridge.reply).toHaveBeenLastCalledWith(
      "discuss:d1",
      "req-1",
      null,
    );
    expect(discussionStore().get("d1")?.interjections?.[0]?.text).toBe(
      "Mind the TTL.",
    );
    await act(async () =>
      host.press("discuss:d1", { kind: "open-chat", sessionId: "b" }, "r-2"),
    );
    expect(discussionHost.show).toHaveBeenCalledWith("d1", "b");
  });
});
