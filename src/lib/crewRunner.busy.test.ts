// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queueCard } from "./crewLoop";
import { CrewRunner, resetCrewRunnerSession } from "./crewRunner";
import { crewCard, getCrew, resetCrewsCache, updateCrew } from "./crews";
import { resetProjectBotsCache } from "./projectBots";
import type { Session } from "./session";

/*
 * A turn whose chat is busy (you're talking to it, or it waits on you)
 * waits without spinning: no copy prepared, nothing saved, again and again.
 */

const PATH = "/Users/me/aven-site";
const COPY = "/data/bots/aven-site-crew-1";
/** Local noon, outside the default quiet hours. */
const NOON = new Date(2026, 9, 29, 12, 0).getTime();

let writes = 0;

function countingStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => {
      writes += 1;
      values.set(key, String(value));
    },
  };
}

function chat(id: string, busy: boolean): Session {
  return {
    id,
    harness: "claude",
    model: "claude:test",
    modelSettings: {},
    runtimeMode: "auto",
    title: id,
    cwd: PATH,
    worktreeCwd: COPY,
    blocks: [],
    busy,
  } as unknown as Session;
}

/**
 * A runner on stand-in timers whose Builder chat is busy. `known` says
 * whether the crew already knows that chat as its Builder's.
 */
function busyRunner(known: boolean) {
  let now = NOON;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  let sessions = [chat("builder-chat", true)];
  const sent: string[] = [];
  const prepare = vi.fn(async (_cwd: string, _key: string, branch: string) => {
    // A guard so a spinning runner fails the test instead of hanging it.
    if (prepare.mock.calls.length > 100) runner.stop();
    return { path: COPY, branch, root: PATH, gitDir: `${PATH}/.git` };
  });
  const runner: CrewRunner = new CrewRunner({
    owner: "me",
    now: () => now,
    setTimer: (run, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (id) => void timers.delete(id),
    sessions: () => sessions,
    ensureChat: async () => sessions[0],
    send: (sessionId) => {
      sent.push(sessionId);
      return true;
    },
    stopChat: () => {},
    copy: {
      prepare,
      sync: async () => ({
        root: PATH,
        base: "b".repeat(40),
        uncommitted: false,
        untracked: false,
      }),
      diff: async () => ({ files: [], additions: 0, deletions: 0, hash: "e" }),
      sources: async () => [],
      planted: async () => [],
    },
    weeklyUsed: () => 40,
    fixerRuns: () => 0,
    fixerBranch: () => undefined,
    board: {
      cards: async () => [],
      move: () => {},
      add: async () => [],
    },
    name: (_crew, who) => who,
    onWorking: () => {},
    newId: () => `turn-${nextId++}`,
  });
  updateCrew(PATH, (crew) => ({
    ...crew,
    on: true,
    onAt: 1,
    members: [
      {
        id: "builder",
        role: "builder",
        ...(known ? { sessionId: "builder-chat" } : {}),
      },
      { id: "checker", role: "checker" },
    ],
    cards: [
      queueCard(
        {
          id: "card-1",
          title: "Dark mode toggle",
          brief: "A switch in Settings.",
          from: "you",
          maxRounds: 3,
        },
        NOON,
      ),
    ],
  }));
  const flush = async () => {
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      await flush();
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = Math.max(now, due[1].at);
      due[1].run();
      await flush();
    }
    now = end;
    await flush();
  };
  return {
    runner,
    prepare,
    sent,
    advance,
    /** The chat is free again, as the window's sessions say. */
    free: () => {
      sessions = [chat("builder-chat", false)];
      runner.observe(sessions);
    },
  };
}

beforeEach(() => {
  writes = 0;
  vi.stubGlobal("localStorage", countingStorage());
  resetProjectBotsCache();
  resetCrewsCache();
  resetCrewRunnerSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProjectBotsCache();
  resetCrewsCache();
});

describe("a turn whose chat is busy", () => {
  it("waits without preparing the copy or saving anything", async () => {
    const h = busyRunner(true);
    const before = writes;
    h.runner.start();
    await h.advance(2 * 60_000);
    expect(h.prepare).not.toHaveBeenCalled();
    expect(writes - before).toBe(0);
    expect(h.sent).toEqual([]);
    expect(crewCard(getCrew(PATH)!, "card-1")?.stage).toBe("queued");
    h.runner.stop();
  });

  it("backs off between looks when the busy chat wasn't known yet", async () => {
    const h = busyRunner(false);
    h.runner.start();
    await h.advance(30_000);
    // One look, then one each pause after it: never a loop.
    expect(h.prepare.mock.calls.length).toBeGreaterThan(0);
    expect(h.prepare.mock.calls.length).toBeLessThanOrEqual(12);
    expect(h.sent).toEqual([]);
    h.runner.stop();
  });

  it("goes as soon as the chat is free", async () => {
    const h = busyRunner(true);
    h.runner.start();
    await h.advance(5_000);
    expect(h.sent).toEqual([]);
    h.free();
    await h.advance(0);
    expect(h.sent).toEqual(["builder-chat"]);
    h.runner.stop();
  });
});
