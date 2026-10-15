import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "./activity";
import { sessionProjectCounts } from "./projectStatus";
import type { Session } from "./session";
import type { SessionSummary } from "./sessionStore";
import {
  homeElapsed,
  homeLiveSessions,
  homeNeedsYou,
  homeProjects,
  homeRecentSessions,
  homeRunning,
  homeScope,
  homeSummary,
  homeTimeAgo,
  inHomeScope,
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
    );
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.run).toMatchObject({ running: true, startedAt: 5_000 });
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
    );
    expect(rows.map((row) => row.id)).toEqual(["lead", "new"]);
    expect(rows[0]).toMatchObject({ running: true, startedAt: 3_000 });
    expect(rows[1].empty).toBe(true);
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
    const rows = homeLiveSessions(sessions, new Set(["1", "2", "3", "4"]));
    const counts = sessionProjectCounts(sessions);
    for (const path of [APP, SITE]) {
      const mine = rows.filter((row) => row.cwd === path);
      expect({
        running: mine.filter((row) => row.running).length,
        waiting: mine.filter((row) => row.waiting).length,
      }).toEqual(counts[path]);
    }
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
        live({ id: "a", title: "Renamed A", updatedAt: 50, running: true }),
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

describe("text", () => {
  it("summarizes what is happening, or nothing when quiet", () => {
    expect(homeSummary({ running: 2, waiting: 1, unread: 3 })).toBe(
      "2 agents running · 1 needs you · 3 unread",
    );
    expect(homeSummary({ running: 1, waiting: 2, unread: 0 })).toBe(
      "1 agent running · 2 need you",
    );
    expect(homeSummary({ running: 0, waiting: 0, unread: 0 })).toBe("");
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
