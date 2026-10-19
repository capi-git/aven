import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "./activity";
import { sessionProjectCounts } from "./projectStatus";
import type { Session } from "./session";
import type { SessionSummary } from "./sessionStore";
import {
  currentActivity,
  homeElapsed,
  homeFinished,
  homeGreeting,
  homeLiveSessions,
  homeNeedsYou,
  homeProjects,
  homeRecentSessions,
  homeRunning,
  homeScope,
  homeSessionIndex,
  homeTimeAgo,
  homeTodayCounts,
  homeTodayRecap,
  inHomeScope,
  startOfDay,
  type HomeLiveSession,
} from "./workspaceHome";

const APP = "/Users/me/Developer/app";
const SITE = "/Users/me/Developer/site";
const OTHER = "/Users/me/Developer/other-workspace";
const SCRATCH = "/Users/me/Library/Application Support/aven/standalone/ws-1";

const scope = homeScope([{ path: APP }, { path: SITE }], [SCRATCH]);

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

function entry(overrides: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: `${overrides.sessionId}:${overrides.outcome}:${overrides.createdAt}`,
    sessionId: "s",
    outcome: "completed",
    title: "Session",
    summary: "",
    cwd: APP,
    harness: "codex",
    model: "",
    createdAt: 1,
    readAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

function summary(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: "h",
    cwd: APP,
    harness: "codex",
    model: "gpt-5",
    runtimeMode: "full-access",
    title: "Saved",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as SessionSummary;
}

function live(overrides: Partial<HomeLiveSession>): HomeLiveSession {
  return {
    id: "s",
    cwd: APP,
    title: "Live",
    harness: "codex",
    updatedAt: 1,
    ...overrides,
  };
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
    expect(homeNeedsYou([lead], [], scope)).toEqual([]);
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
    expect(homeNeedsYou(rows, [], scope).map((item) => item.id)).toEqual([
      "worker",
    ]);
    // Recent leaves workers out, as saved history does.
    expect(homeRecentSessions([], rows, scope).map((row) => row.id)).toEqual([
      "lead",
    ]);
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

describe("homeScope", () => {
  it("covers the workspace's projects and no-project folders only", () => {
    expect(inHomeScope(scope, `${APP}/`)).toBe(true);
    expect(inHomeScope(scope, SCRATCH)).toBe(true);
    expect(inHomeScope(scope, OTHER)).toBe(false);
    expect(inHomeScope(scope, "~")).toBe(false);
    expect(inHomeScope(scope, "")).toBe(false);
  });
});

describe("homeRecentSessions", () => {
  it("merges saved and loaded sessions, newest first, within the workspace", () => {
    const rows = homeRecentSessions(
      [
        summary({ id: "a", updatedAt: 10, branch: "main", title: "Saved A" }),
        summary({ id: "b", updatedAt: 30 }),
        summary({ id: "gone", updatedAt: 99, archived: true }),
        summary({ id: "worker", updatedAt: 98, orchestrationLeadId: "a" }),
        summary({ id: "elsewhere", updatedAt: 97, cwd: OTHER }),
      ],
      [
        live({
          id: "a",
          title: "Renamed A",
          updatedAt: 50,
          activeAt: 50,
          running: true,
        }),
        live({ id: "c", cwd: SCRATCH, updatedAt: 20 }),
        live({ id: "blank", updatedAt: 60, empty: true }),
      ],
      scope,
    );
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(rows[0]).toMatchObject({
      title: "Renamed A",
      branch: "main",
      running: true,
    });
  });
});

describe("one time and title per session", () => {
  const MINUTE = 60_000;
  const now = 1_800_000_000_000;
  // A chat renamed from "Session reply check" to "Your mum": its saved row was
  // touched 74 minutes ago, its last reply finished two hours ago, and the
  // loaded copy's own estimate dates from its last timed turn, 23 hours ago.
  const history = [
    summary({ id: "mum", title: "Your mum", updatedAt: now - 74 * MINUTE }),
    summary({ id: "old", title: "Older", updatedAt: now - 3 * 60 * MINUTE }),
  ];
  const loaded = [
    live({
      id: "mum",
      title: "Your mum",
      updatedAt: now - 23 * 60 * MINUTE,
      activeAt: now - 23 * 60 * MINUTE,
    }),
  ];
  const ledger = [
    entry({
      id: "reply",
      sessionId: "mum",
      title: "Session reply check",
      summary: "All set",
      createdAt: now - 120 * MINUTE,
    }),
  ];
  const index = homeSessionIndex(history, loaded, ledger);

  it("dates a session by the newest of its saved row, ledger and turns", () => {
    expect(index.at.get("mum")).toBe(now - 74 * MINUTE);
    const fresher = homeSessionIndex(history, loaded, [
      entry({ sessionId: "mum", createdAt: now - 5 * MINUTE }),
    ]);
    expect(fresher.at.get("mum")).toBe(now - 5 * MINUTE);
    const turn = homeSessionIndex(
      history,
      [live({ id: "mum", activeAt: now - MINUTE })],
      [],
    );
    expect(turn.at.get("mum")).toBe(now - MINUTE);
  });

  it("ignores the live estimate of a saved session, as the sidebar does", () => {
    // A rename moves the live estimate to now; the saved row's time stands.
    const renamed = homeSessionIndex(
      history,
      [live({ id: "mum", title: "Your mum", updatedAt: now })],
      [],
    );
    expect(renamed.at.get("mum")).toBe(now - 74 * MINUTE);
    // A session not saved yet has only the live estimate, which the sidebar
    // shows too.
    const fresh = homeSessionIndex(
      [],
      [live({ id: "new", updatedAt: 42 })],
      [],
    );
    expect(fresh.at.get("new")).toBe(42);
  });

  it("dates Recent sessions, Needs you and the agent tile alike", () => {
    const recent = homeRecentSessions(history, loaded, scope, index);
    expect(recent.map((row) => [row.id, row.title, row.updatedAt])).toEqual([
      ["mum", "Your mum", now - 74 * MINUTE],
      ["old", "Older", now - 3 * 60 * MINUTE],
    ]);
    const [needs] = homeNeedsYou(loaded, ledger, scope, index);
    expect(needs).toMatchObject({
      id: "mum",
      title: "Your mum",
      at: now - 74 * MINUTE,
    });
    const [tile] = homeProjects([{ path: APP }], recent, ledger, loaded, index);
    expect(tile).toMatchObject({
      lastActivity: now - 74 * MINUTE,
      resumeTitle: "Your mum",
    });
  });

  it("keeps each finished turn's own time under the session's current title", () => {
    const [row] = homeFinished(ledger, scope, index);
    expect(row).toMatchObject({
      title: "Your mum",
      at: now - 120 * MINUTE,
    });
    // A session Home knows nothing about keeps the title it finished under.
    const [unknown] = homeFinished(
      [entry({ sessionId: "gone", title: "Deleted chat", createdAt: 9 })],
      scope,
      index,
    );
    expect(unknown.title).toBe("Deleted chat");
  });

  it("names a waiting session by its live title and dates it like Recent", () => {
    const waiting = live({
      id: "mum",
      title: "Your mum",
      updatedAt: now,
      waiting: { kind: "approval", detail: "Run npm test" },
    });
    const asked = [
      entry({
        sessionId: "mum",
        outcome: "approval",
        title: "Session reply check",
        createdAt: now - 3 * MINUTE,
      }),
    ];
    const [item] = homeNeedsYou(
      [waiting],
      asked,
      scope,
      homeSessionIndex(history, [waiting], asked),
    );
    expect(item).toMatchObject({
      title: "Your mum",
      at: now - 3 * MINUTE,
    });
  });
});

describe("homeNeedsYou", () => {
  it("lists waiting sessions first, then unread replies, each newest first", () => {
    const items = homeNeedsYou(
      [
        live({
          id: "old-ask",
          title: "Old ask",
          waiting: { kind: "question", detail: "Which one?" },
        }),
        live({
          id: "new-ask",
          waiting: { kind: "approval", detail: "Run npm test" },
        }),
      ],
      [
        entry({ sessionId: "old-ask", outcome: "question", createdAt: 100 }),
        entry({ sessionId: "new-ask", outcome: "approval", createdAt: 200 }),
        entry({ sessionId: "r1", createdAt: 300, summary: "Done.\nAll set" }),
        entry({ sessionId: "r2", outcome: "failed", createdAt: 400 }),
      ],
      scope,
    );
    expect(items.map((item) => [item.id, item.kind, item.at])).toEqual([
      ["new-ask", "approval", 200],
      ["old-ask", "question", 100],
      ["r2", "failed", 400],
      ["r1", "completed", 300],
    ]);
    expect(items[3].detail).toBe("Done. All set");
  });

  it("keeps one reply per session and skips read, resolved and other workspaces", () => {
    const items = homeNeedsYou(
      [live({ id: "ask", waiting: { kind: "approval", detail: "x" } })],
      [
        entry({ sessionId: "r", createdAt: 5, summary: "older" }),
        entry({ sessionId: "r", createdAt: 9, summary: "newer" }),
        entry({ sessionId: "read", createdAt: 9, readAt: 10 }),
        entry({ sessionId: "away", createdAt: 9, cwd: OTHER }),
        entry({ sessionId: "ask", createdAt: 9 }),
        entry({ sessionId: "q", outcome: "question", resolvedAt: 4 }),
      ],
      scope,
    );
    expect(items.map((item) => [item.id, item.detail])).toEqual([
      ["ask", "x"],
      ["r", "newer"],
    ]);
  });

  it("falls back to the session's time when no request was recorded", () => {
    const [item] = homeNeedsYou(
      [
        live({
          updatedAt: 42,
          waiting: { kind: "approval", detail: "x" },
        }),
      ],
      [],
      scope,
    );
    expect(item.at).toBe(42);
  });
});

describe("homeRunning", () => {
  it("lists running sessions in the workspace, longest-running first", () => {
    const rows = homeRunning(
      [
        live({ id: "late", running: true, startedAt: 30 }),
        live({ id: "early", running: true, startedAt: 10 }),
        live({ id: "unknown", running: true }),
        live({ id: "idle" }),
        live({ id: "away", running: true, startedAt: 1, cwd: OTHER }),
      ],
      scope,
    );
    expect(rows.map((row) => row.id)).toEqual(["early", "late", "unknown"]);
  });
});

describe("homeProjects", () => {
  it("keeps the given order and finds each project's latest session and activity", () => {
    const recent = homeRecentSessions(
      [
        summary({ id: "app-old", updatedAt: 10, branch: "feature" }),
        summary({ id: "app-new", updatedAt: 20, title: "Latest app task" }),
      ],
      [],
      scope,
    );
    const cards = homeProjects([{ path: SITE }, { path: APP }], recent, [
      entry({ cwd: SITE, createdAt: 15 }),
      entry({ cwd: APP, createdAt: 5 }),
    ]);
    expect(cards).toEqual([
      { path: SITE, name: "site", lastActivity: 15 },
      {
        path: APP,
        name: "app",
        branch: "feature",
        lastActivity: 20,
        resumeId: "app-new",
        resumeTitle: "Latest app task",
      },
    ]);
  });
});

describe("homeProjects with a team waiting on you", () => {
  it("opens the tile to the chat the team waits in, saying why", () => {
    const [card] = homeProjects([{ path: SITE }], [], [], [], undefined, [
      {
        id: "discuss:d1",
        kind: "discuss",
        key: "d1",
        origin: { sessionId: "a" },
        project: SITE,
        title: "Cache the lookups?",
        status: "needs-you",
        progress: "Round 1 of 2",
        need: {
          sessionId: "b",
          kind: "paused",
          text: "“Review” isn't open in this window.",
          since: 3,
        },
        members: [],
        startedAt: 0,
        updatedAt: 0,
      },
    ]);
    expect(card).toMatchObject({
      resumeId: "b",
      asking: "“Review” isn't open in this window.",
    });
  });

  it("names the chat it opens, not the project's latest", () => {
    const recent = homeRecentSessions(
      [summary({ id: "latest", cwd: SITE, updatedAt: 50, title: "Latest" })],
      [],
      scope,
    );
    const [card] = homeProjects([{ path: SITE }], recent, [], [], undefined, [
      {
        id: "discuss:d1",
        kind: "discuss",
        key: "d1",
        origin: { sessionId: "a" },
        project: SITE,
        title: "Cache the lookups?",
        status: "needs-you",
        progress: "Round 1 of 2",
        need: { sessionId: "b", kind: "paused", text: "Paused", since: 3 },
        members: [
          {
            sessionId: "b",
            harness: "codex",
            model: "GPT-5",
            label: "Codex · GPT-5",
            title: "Review",
            role: "responder",
            state: "queued",
            stateLabel: "Waiting",
          },
        ],
        startedAt: 0,
        updatedAt: 0,
      },
    ]);
    expect(card).toMatchObject({ resumeId: "b", resumeTitle: "Review" });
  });
});

describe("homeProjects with live sessions", () => {
  it("opens to what waits on the user, then what is at work, then the latest", () => {
    const recent = homeRecentSessions(
      [summary({ id: "latest", updatedAt: 50, title: "Latest" })],
      [],
      scope,
    );
    const [busy] = homeProjects(
      [{ path: APP }],
      recent,
      [],
      [
        live({ id: "a", running: true, startedAt: 10, doing: "Read a.ts" }),
        live({ id: "b", running: true, startedAt: 20, doing: "Edit b.ts" }),
      ],
    );
    expect(busy).toMatchObject({
      resumeId: "b",
      doing: "Edit b.ts",
    });
    expect(busy.asking).toBeUndefined();
    const [asking] = homeProjects(
      [{ path: APP }],
      recent,
      [],
      [
        live({ id: "b", running: true, startedAt: 20, doing: "Edit b.ts" }),
        live({
          id: "q",
          title: "Question",
          waiting: { kind: "question", detail: "Which one?" },
        }),
      ],
    );
    expect(asking).toMatchObject({
      resumeId: "q",
      resumeTitle: "Question",
      doing: "Edit b.ts",
      asking: "Which one?",
    });
    const [quiet] = homeProjects([{ path: APP }], recent, [], []);
    expect(quiet).toMatchObject({ resumeId: "latest" });
  });
});

describe("finished turns", () => {
  it("lists the workspace's finished turns, newest first, marking unread ones", () => {
    const rows = homeFinished(
      [
        entry({ id: "1", sessionId: "a", createdAt: 10, readAt: 11 }),
        entry({ id: "2", sessionId: "b", createdAt: 30, outcome: "failed" }),
        entry({ id: "3", sessionId: "c", createdAt: 20, outcome: "approval" }),
        entry({ id: "4", sessionId: "d", createdAt: 40, cwd: OTHER }),
        entry({
          id: "5",
          sessionId: "a",
          createdAt: 25,
          summary: "Line one\nmore",
        }),
      ],
      scope,
    );
    expect(rows.map((row) => [row.id, row.kind, row.unread])).toEqual([
      ["2", "failed", true],
      ["5", "completed", true],
      ["1", "completed", false],
    ]);
    expect(rows[1].detail).toBe("Line one more");
  });

  it("counts today's turns from local midnight", () => {
    const now = new Date(2026, 9, 15, 14, 30).getTime();
    const midnight = startOfDay(now);
    expect(midnight).toBe(new Date(2026, 9, 15).getTime());
    expect(
      homeTodayCounts(
        [
          { kind: "completed", at: now - 60_000 },
          { kind: "completed", at: midnight + 1 },
          { kind: "failed", at: midnight + 2 },
          { kind: "stopped", at: midnight + 3 },
          { kind: "completed", at: midnight - 1 },
        ],
        now,
      ),
    ).toEqual({ done: 2, failed: 1, stopped: 1 });
  });

  it("recaps today by projects with a task done, from local midnight", () => {
    const now = new Date(2026, 9, 15, 0, 30).getTime();
    const midnight = startOfDay(now);
    expect(
      homeTodayRecap(
        [
          { kind: "completed", at: midnight + 1, cwd: APP },
          { kind: "completed", at: midnight + 2, cwd: `${APP}/` },
          { kind: "failed", at: midnight + 3, cwd: SITE },
          { kind: "completed", at: midnight - 1, cwd: SITE },
        ],
        now,
      ),
    ).toEqual({ done: 2, failed: 1, stopped: 0, projects: 1 });
  });
});

describe("text", () => {
  it("greets by the local hour", () => {
    const at = (hour: number) => new Date(2026, 9, 15, hour).getTime();
    expect(homeGreeting(at(3))).toBe("Working late");
    expect(homeGreeting(at(9))).toBe("Good morning");
    expect(homeGreeting(at(13))).toBe("Good afternoon");
    expect(homeGreeting(at(20))).toBe("Good evening");
  });

  it("formats times at minute resolution", () => {
    const now = 10 * 24 * 3_600_000;
    expect(homeTimeAgo(now - 30_000, now)).toBe("just now");
    expect(homeTimeAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(homeTimeAgo(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(homeTimeAgo(now - 2 * 86_400_000, now)).toBe("2d ago");
    expect(homeTimeAgo(0, now)).toBe("");
    expect(homeElapsed(now - 20_000, now)).toBe("<1m");
    expect(homeElapsed(now - 12 * 60_000, now)).toBe("12m");
    expect(homeElapsed(now - 65 * 60_000, now)).toBe("1h 5m");
    expect(homeElapsed(now - 120 * 60_000, now)).toBe("2h");
  });
});
