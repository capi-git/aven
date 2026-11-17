import { describe, expect, it } from "vitest";
import { sessionProjectCounts } from "./projectStatus";
import type { Session } from "./session";
import {
  currentActivity,
  homeElapsed,
  homeLiveSessions,
  startOfDay,
} from "./workspaceHome";

const APP = "/Users/me/Developer/app";
const SITE = "/Users/me/Developer/site";

type BlockList = Session["blocks"];

function user(startedAt: number, id = `u${startedAt}`): BlockList[number] {
  return { id, role: "user", text: "Do it", startedAt } as BlockList[number];
}

function approval(title = "Run npm test", decided = false): BlockList[number] {
  return {
    id: `a-${title}`,
    role: "tool",
    text: "",
    tool: { title },
    approval: { id: "a", requestId: "r", decided },
  } as unknown as BlockList[number];
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s",
    cwd: APP,
    harness: "codex",
    model: "gpt-5",
    runtimeMode: "full-access",
    title: "Fix the login form",
    blocks: [user(1_000)],
    busy: false,
    ...overrides,
  } as Session;
}

describe("homeLiveSessions", () => {
  it("marks running and waiting sessions, inspecting only those in flight", () => {
    const rows = homeLiveSessions(
      [
        session({ id: "run", busy: true, blocks: [user(5_000)] }),
        session({ id: "ask", busy: true, blocks: [user(1), approval()] }),
        session({ id: "idle" }),
        // Not in flight: its stale approval is not inspected.
        session({ id: "skip", blocks: [user(1), approval("Old")] }),
      ],
      new Set(["run", "ask"]),
      new Set(),
    );
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.run).toMatchObject({
      running: true,
      startedAt: 5_000,
      doing: "Thinking",
    });
    expect(byId.run.waiting).toBeUndefined();
    expect(byId.ask).toMatchObject({
      waiting: { kind: "approval", detail: "Run npm test" },
    });
    expect(byId.ask.running).toBeUndefined();
    expect(byId.idle.running).toBeUndefined();
    expect(byId.skip.waiting).toBeUndefined();
  });

  it("names the question it waits on and keeps an optional question running", () => {
    const [row] = homeLiveSessions(
      [
        session({
          busy: true,
          pendingQuestion: {
            title: "Which database?",
            blocking: false,
            questions: [],
          } as unknown as Session["pendingQuestion"],
        }),
      ],
      new Set(["s"]),
      new Set(),
    );
    expect(row).toMatchObject({
      running: true,
      waiting: { kind: "question", detail: "Which database?" },
    });
  });

  it("drops Inbox chats, folds workers into their lead and flags unsent sessions", () => {
    const rows = homeLiveSessions(
      [
        session({ id: "lead", blocks: [user(2_000)] }),
        session({
          id: "worker",
          orchestrationLeadId: "lead",
          busy: true,
          blocks: [user(3_000)],
        }),
        session({ id: "inbox", inboxAsk: {} as Session["inboxAsk"] }),
        session({ id: "new", blocks: [] }),
      ],
      new Set(["lead", "worker"]),
      new Set(["worker"]),
    );
    expect(rows.map((row) => row.id)).toEqual(["lead", "new"]);
    expect(rows[0]).toMatchObject({ running: true, startedAt: 3_000 });
    expect(rows[1].empty).toBe(true);
  });

  it("keeps a lead working, not waiting, while it decides a worker's request", () => {
    const sessions = [
      session({ id: "lead", blocks: [user(2_000)] }),
      session({
        id: "worker",
        orchestrationLeadId: "lead",
        busy: true,
        blocks: [user(3_000), approval()],
      }),
    ];
    const deciding = new Set(["worker"]);
    const [lead] = homeLiveSessions(sessions, new Set(["worker"]), deciding);
    expect(lead.waiting).toBeUndefined();
    expect(lead).toMatchObject({ running: true, doing: "Lead deciding" });
    // The project counts it as working, never as waiting for you.
    expect(sessionProjectCounts(sessions, deciding)[APP]).toEqual({
      running: 1,
      waiting: 0,
    });
  });

  it("lists a former worker's request as its own, never as Lead deciding", () => {
    // Its run is over, so no lead decides for it: it asks you itself.
    const sessions = [
      session({ id: "lead", blocks: [user(2_000)] }),
      session({
        id: "worker",
        title: "Fix the tests",
        orchestrationLeadId: "lead",
        busy: true,
        blocks: [user(3_000), approval()],
      }),
    ];
    const rows = homeLiveSessions(sessions, new Set(["worker"]), new Set());
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.lead.doing).toBeUndefined();
    expect(byId.lead.running).toBeUndefined();
    expect(byId.worker).toMatchObject({
      worker: true,
      waiting: { kind: "approval", detail: "Run npm test" },
    });
    expect(sessionProjectCounts(sessions, new Set())[APP]).toEqual({
      running: 0,
      waiting: 1,
    });
    // An idle former worker is not listed at all.
    expect(
      homeLiveSessions(sessions, new Set(), new Set()).map((row) => row.id),
    ).toEqual(["lead"]);
  });

  it("dates each session by its latest timed turn, never by a guess", () => {
    const steer = {
      id: "steer",
      role: "user",
      text: "Also this",
    } as BlockList[number];
    const done = { ...user(1_000), durationMs: 500 } as BlockList[number];
    const rows = homeLiveSessions(
      [
        session({ id: "done", blocks: [user(10), done] }),
        session({ id: "running", busy: true, blocks: [done, user(4_000)] }),
        // A message sent mid-turn has no time; the turn it joined does.
        session({ id: "steered", busy: true, blocks: [user(2_000), steer] }),
        session({ id: "untimed", blocks: [steer] }),
      ],
      new Set(["running", "steered"]),
      new Set(),
    );
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.done.activeAt).toBe(1_500);
    expect(byId.running.activeAt).toBe(4_000);
    expect(byId.steered.activeAt).toBe(2_000);
    expect(byId.steered.startedAt).toBeUndefined();
    expect(byId.untimed.activeAt).toBeUndefined();
  });

  it("agrees with the sidebar's per-project running and waiting counts", () => {
    const sessions = [
      session({ id: "1", busy: true }),
      session({ id: "2", busy: true, blocks: [user(1), approval()] }),
      session({
        id: "3",
        liveAgents: [{ id: "x", status: "running" }] as Session["liveAgents"],
      }),
      session({
        id: "4",
        cwd: SITE,
        busy: true,
        pendingQuestion: {
          blocking: true,
          questions: [],
        } as unknown as Session["pendingQuestion"],
      }),
      session({ id: "5", cwd: SITE }),
    ];
    const rows = homeLiveSessions(
      sessions,
      new Set(["1", "2", "3", "4"]),
      new Set(),
    );
    const counts = sessionProjectCounts(sessions, new Set());
    for (const path of [APP, SITE]) {
      const mine = rows.filter((row) => row.cwd === path);
      expect({
        running: mine.filter((row) => row.running).length,
        waiting: mine.filter((row) => row.waiting).length,
      }).toEqual(counts[path]);
    }
  });
});

describe("currentActivity", () => {
  const block = (overrides: object) =>
    ({ id: "b", text: "", ...overrides }) as BlockList[number];

  it("says what the current turn is doing, newest step first", () => {
    const tool = block({
      role: "tool",
      tool: {
        kind: "edit",
        title: "Edit",
        preview: { path: `${APP}/src/App.tsx` },
      },
    });
    expect(currentActivity(session({ blocks: [user(1), tool] }))).toBe(
      "Edit App.tsx",
    );
    const named = block({ role: "tool", tool: { title: "Run npm test" } });
    expect(currentActivity(session({ blocks: [user(1), named] }))).toBe(
      "Run npm test",
    );
    expect(
      currentActivity(
        session({ blocks: [user(1), tool, block({ role: "assistant" })] }),
      ),
    ).toBe("Writing a reply");
    expect(
      currentActivity(
        session({ blocks: [user(1), block({ role: "reasoning" })] }),
      ),
    ).toBe("Thinking");
  });

  it("never reports a tool from an earlier turn", () => {
    const old = block({ role: "tool", tool: { title: "Run npm test" } });
    expect(currentActivity(session({ blocks: [user(1), old, user(2)] }))).toBe(
      "Thinking",
    );
  });

  it("names background agents when no turn is running", () => {
    expect(
      currentActivity(
        session({
          busy: false,
          liveAgents: [{ id: "x", status: "running" }] as Session["liveAgents"],
        }),
      ),
    ).toBe("Waiting on 1 helper agent");
  });
});

describe("times", () => {
  it("starts the day at local midnight", () => {
    const noon = new Date(2026, 9, 15, 12, 30).getTime();
    expect(startOfDay(noon)).toBe(new Date(2026, 9, 15).getTime());
  });

  it("formats elapsed time at minute resolution", () => {
    const now = 10 * 24 * 3_600_000;
    expect(homeElapsed(now - 20_000, now)).toBe("<1m");
    expect(homeElapsed(now - 12 * 60_000, now)).toBe("12m");
    expect(homeElapsed(now - 65 * 60_000, now)).toBe("1h 5m");
    expect(homeElapsed(now - 120 * 60_000, now)).toBe("2h");
  });
});
