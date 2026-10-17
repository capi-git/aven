import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));

import {
  NO_ANSWER_TEXT,
  OWNER_CLOSED_TEXT,
  TEAM_WATCH_ACTION_EVENT,
  TEAM_WATCH_CLOSED_EVENT,
  TEAM_WATCH_REPLY_EVENT,
  TEAM_WATCH_STATE_EVENT,
  teamWatchOwner,
  teamWatchWindow,
  type TeamWatchTransport,
  type TeamWatchWindowState,
} from "./teamWatchBridge";

/** A host that records commands and lets a test emit events to the page. */
function fakeHost(answer: (command: string) => unknown = () => null) {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const transport: TeamWatchTransport = {
    invoke: async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args });
      const result = answer(command);
      if (result instanceof Error) throw result;
      return result as T;
    },
    listen: async <T>(event: string, callback: (payload: T) => void) => {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      const listener = callback as (payload: unknown) => void;
      set.add(listener);
      return () => set.delete(listener);
    },
  };
  const emit = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };
  return { transport, calls, emit, listeners };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("the owning window's side", () => {
  it("opens, updates, closes and answers through the host's team commands", async () => {
    const host = fakeHost();
    const owner = teamWatchOwner(host.transport);
    const snapshot = {
      view: null,
      theme: { mode: "dark" as const, accent: "#fff" },
    };
    const at = { x: 1, y: 2, width: 430, height: 590, dpr: 2 };
    await owner.open("race:r1", "Race · “Fix”", snapshot, at);
    await owner.update("race:r1", snapshot);
    await owner.reply("race:r1", "req-1", "Not now");
    await owner.close("race:r1");
    await owner.reset();
    expect(host.calls).toEqual([
      {
        command: "team_watch_open",
        args: { team: "race:r1", title: "Race · “Fix”", snapshot, at },
      },
      { command: "team_watch_update", args: { team: "race:r1", snapshot } },
      {
        command: "team_watch_reply",
        args: { team: "race:r1", requestId: "req-1", error: "Not now" },
      },
      { command: "team_watch_close", args: { team: "race:r1" } },
      { command: "team_watch_reset", args: undefined },
    ]);
  });

  it("hears only well-formed requests and closings", async () => {
    const host = fakeHost();
    const owner = teamWatchOwner(host.transport);
    const requests: unknown[] = [];
    const closed: string[] = [];
    const stop = await owner.onAction((request) => requests.push(request));
    await owner.onClosed((team) => closed.push(team));
    host.emit(TEAM_WATCH_ACTION_EVENT, {
      team: "race:r1",
      requestId: "a-1",
      action: { kind: "compare" },
    });
    host.emit(TEAM_WATCH_ACTION_EVENT, { team: "nope", requestId: "a-2" });
    host.emit(TEAM_WATCH_ACTION_EVENT, "junk");
    host.emit(TEAM_WATCH_CLOSED_EVENT, { team: "race:r1" });
    host.emit(TEAM_WATCH_CLOSED_EVENT, { team: 4 });
    expect(requests).toEqual([
      { team: "race:r1", requestId: "a-1", action: { kind: "compare" } },
    ]);
    expect(closed).toEqual(["race:r1"]);
    stop();
    host.emit(TEAM_WATCH_ACTION_EVENT, {
      team: "race:r1",
      requestId: "a-3",
      action: {},
    });
    expect(requests).toHaveLength(1);
  });
});

describe("the pop-out's side", () => {
  it("resolves an action with its owner's answer", async () => {
    const host = fakeHost();
    const page = teamWatchWindow(host.transport);
    await tick();
    const sent = page.send({ kind: "compare" });
    await tick();
    const call = host.calls.find(
      (entry) => entry.command === "team_watch_action",
    );
    expect(call?.args?.action).toEqual({ kind: "compare" });
    const requestId = call?.args?.requestId as string;
    // Someone else's answer is not this one.
    host.emit(TEAM_WATCH_REPLY_EVENT, { requestId: "other", error: "no" });
    host.emit(TEAM_WATCH_REPLY_EVENT, { requestId, error: null });
    await expect(sent).resolves.toBe(null);
    const refused = page.send({ kind: "stop" });
    await tick();
    const second = host.calls.at(-1)?.args?.requestId as string;
    host.emit(TEAM_WATCH_REPLY_EVENT, {
      requestId: second,
      error: "Wait for the lead to finish its turn, then resume.",
    });
    await expect(refused).resolves.toBe(
      "Wait for the lead to finish its turn, then resume.",
    );
  });

  it("gives up on a silent owner, and says so when the host refuses", async () => {
    vi.useFakeTimers();
    const host = fakeHost();
    const page = teamWatchWindow(host.transport, { replyMs: 1_000 });
    const silent = page.send({ kind: "compare" });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(silent).resolves.toBe(NO_ANSWER_TEXT);
    vi.useRealTimers();
    const refusing = fakeHost((command) =>
      command === "team_watch_action"
        ? new Error("This team's window was closed.")
        : null,
    );
    const lost = teamWatchWindow(refusing.transport);
    await expect(lost.send({ kind: "stop" })).resolves.toBe(
      "This team's window was closed.",
    );
  });

  it("refuses everything at once once the owning window has closed", async () => {
    const host = fakeHost();
    const page = teamWatchWindow(host.transport);
    const states: TeamWatchWindowState[] = [];
    await page.onState((state) => states.push(state));
    const waiting = page.send({ kind: "compare" });
    await tick();
    const closed: TeamWatchWindowState = {
      team: "race:r1",
      snapshot: { view: null, theme: { mode: "dark", accent: "#fff" } },
      revision: 3,
      ownerClosed: true,
    };
    host.emit(TEAM_WATCH_STATE_EVENT, closed);
    await expect(waiting).resolves.toBe(OWNER_CLOSED_TEXT);
    await expect(page.send({ kind: "stop" })).resolves.toBe(OWNER_CLOSED_TEXT);
    expect(states).toEqual([closed]);
    // Nothing more was sent once it knew.
    expect(
      host.calls.filter((entry) => entry.command === "team_watch_action"),
    ).toHaveLength(1);
  });

  it("reads its state, shows itself once drawn, and closes itself", async () => {
    const state = {
      team: "race:r1",
      snapshot: { view: null, theme: {} },
      revision: 1,
      ownerClosed: false,
    };
    const host = fakeHost((command) =>
      command === "team_watch_get_state" ? state : null,
    );
    const page = teamWatchWindow(host.transport);
    await expect(page.state()).resolves.toBe(state);
    await page.ready(1);
    await page.dismiss();
    page.dispose();
    expect(host.calls.map((entry) => entry.command)).toEqual([
      "team_watch_get_state",
      "team_watch_ready",
      "team_watch_dismiss",
    ]);
    expect(host.calls[1].args).toEqual({ revision: 1 });
    await tick();
    expect(host.listeners.get(TEAM_WATCH_REPLY_EVENT)?.size ?? 0).toBe(0);
  });
});
