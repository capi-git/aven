import { describe, expect, it } from "vitest";
import type { ChatReview } from "./chatReview";
import type { ChatStatusWord } from "./chatStatus";
import { newSession, type Block, type Session } from "./session";
import type { ShippedChat } from "./shippedChats";
import { NO_LEAD_DECIDED } from "./teamAttention";
import type { TeamMember, TeamRun, TeamStatus } from "./teamRuns";
import {
  boardChats,
  boardTodayText,
  reviewLine,
  workBoard,
  type BoardChat,
  type WorkBoardInput,
} from "./workBoard";

const PROJECT = "/work/site";
const NOW = new Date(2026, 9, 17, 15, 0).getTime();
const DAY = 86_400_000;

const chat = (id: string, patch: Partial<BoardChat> = {}): BoardChat => ({
  id,
  cwd: PROJECT,
  workCwd: PROJECT,
  title: id,
  harness: "claude",
  at: NOW - 1_000,
  ...patch,
});

const review = (sessionId: string, patch: Partial<ChatReview> = {}) =>
  ({
    sessionId,
    project: PROJECT,
    cwd: PROJECT,
    at: NOW - 5_000,
    files: 3,
    additions: 48,
    deletions: 12,
    names: ["a.ts", "b.ts", "c.ts"],
    ...patch,
  }) satisfies ChatReview;

// Each chat's own commit, named by the chat.
const ship = (sessionId: string, patch: Partial<ShippedChat> = {}) =>
  ({
    sessionId,
    project: PROJECT,
    cwd: PROJECT,
    at: NOW - 60_000,
    commit: {
      sha: `${sessionId}-4c19b02aa`,
      shortSha: "4c19b02",
      subject: sessionId,
    },
    ...patch,
  }) satisfies ShippedChat;

const member = (sessionId: string, role: TeamMember["role"] = "lane") =>
  ({
    sessionId,
    harness: "codex",
    model: "m",
    label: sessionId,
    role,
    state: "working",
    stateLabel: "Working",
  }) satisfies TeamMember;

const team = (
  kind: TeamRun["kind"],
  status: TeamStatus,
  origin: string,
  members: string[],
  patch: Partial<TeamRun> = {},
): TeamRun => ({
  id: `${kind}:${origin}`,
  kind,
  key: origin,
  origin: { sessionId: origin },
  project: PROJECT,
  title: `Team ${origin}`,
  status,
  progress: "1 of 2 done",
  members: members.map((id) => member(id)),
  startedAt: NOW - 120_000,
  updatedAt: NOW - 60_000,
  ...patch,
});

const board = (patch: Partial<WorkBoardInput>) =>
  workBoard({
    project: PROJECT,
    chats: [],
    statuses: {},
    teams: [],
    reviews: {},
    shipped: {},
    previews: [],
    now: NOW,
    ...patch,
  });

const titles = (model: ReturnType<typeof board>) =>
  Object.fromEntries(
    Object.entries(model.columns).map(([column, cards]) => [
      column,
      cards.map((card) => card.title),
    ]),
  );

describe("workBoard", () => {
  it("sorts chats into the four columns by their word", () => {
    const statuses: Record<string, ChatStatusWord> = {
      ask: "needs-you",
      run: "working",
      fix: "review",
      done: "shipped",
    };
    const model = board({
      chats: [
        chat("ask", { waiting: { kind: "question", detail: "Which one?" } }),
        chat("run", { startedAt: NOW - 120_000, doing: "Edit App.tsx" }),
      ],
      statuses,
      reviews: { fix: review("fix", { title: "fix" }) },
      shipped: { done: ship("done", { title: "done" }) },
    });
    expect(titles(model)).toEqual({
      "needs-you": ["ask"],
      working: ["run"],
      review: ["fix"],
      shipped: ["done"],
    });
    expect(model.today).toEqual({ shipped: 1, inProgress: 2 });
    expect(boardTodayText(model.today)).toBe(
      "Today: 1 shipped · 2 in progress",
    );
  });

  it("offers the right buttons on each card", () => {
    const model = board({
      chats: [
        chat("approve", {
          waiting: {
            kind: "approval",
            detail: "npm run deploy",
            requestId: 7,
          },
        }),
        chat("question", {
          waiting: { kind: "question", detail: "Short or long?" },
        }),
        chat("run", { startedAt: NOW - 120_000, doing: "Edit App.tsx" }),
      ],
      statuses: {
        approve: "needs-you",
        question: "needs-you",
        run: "working",
        fix: "review",
        pr: "shipped",
        commit: "shipped",
      },
      reviews: { fix: review("fix") },
      shipped: {
        pr: ship("pr", {
          pr: { number: 42, url: "https://github.com/o/r/pull/42" },
        }),
        commit: ship("commit"),
      },
      previews: [
        {
          key: "site\n5173",
          project: PROJECT,
          cwd: PROJECT,
          sessionId: "fix",
          status: "live",
        },
      ],
    });
    const card = (id: string) =>
      Object.values(model.columns)
        .flat()
        .find((entry) => entry.sessionId === id)!;
    expect(card("approve").actions).toEqual([
      { kind: "allow", requestId: 7 },
      { kind: "open" },
    ]);
    expect(card("approve").line).toBe(
      "Claude wants your approval: npm run deploy",
    );
    expect(card("question").actions).toEqual([{ kind: "answer" }]);
    expect(card("run").actions).toEqual([]);
    expect(card("run").line).toBe("Edit App.tsx");
    expect(card("run").since).toBe(NOW - 120_000);
    expect(card("fix").actions).toEqual([
      { kind: "preview", previewKey: "site\n5173" },
      { kind: "review" },
      { kind: "ship" },
    ]);
    expect(card("fix").line).toBe("3 files · +48 −12 · preview running");
    expect(card("pr").actions).toEqual([
      { kind: "pr", number: 42, url: "https://github.com/o/r/pull/42" },
    ]);
    expect(card("pr").line).toMatch(/^PR #42 · /);
    expect(card("commit").actions).toEqual([
      {
        kind: "commit",
        commit: {
          sha: "commit-4c19b02aa",
          shortSha: "4c19b02",
          subject: "commit",
        },
      },
    ]);
    expect(card("commit").line).toMatch(/^Commit 4c19b02 · /);
  });

  it("shows each team as one card with its mascots, its chats folded in", () => {
    const model = board({
      chats: [chat("origin"), chat("l1"), chat("l2")],
      statuses: { origin: "racing", l1: "racing", l2: "racing" },
      teams: [
        team("race", "running", "origin", ["l1", "l2"]),
        team("discuss", "needs-you", "a", ["a", "b"], {
          need: {
            sessionId: "b",
            kind: "question",
            text: "Codex asked a question",
            since: NOW - 10_000,
          },
        }),
        team("race", "ready", "r", ["r1", "r2"]),
        team("orchestrate", "finished", "lead", ["lead", "w"]),
      ],
    });
    expect(model.columns.working).toHaveLength(1);
    const race = model.columns.working[0]!;
    expect(race).toMatchObject({
      id: "team:race:origin",
      sessionId: "origin",
      line: "Racing · 1 of 2 done",
      actions: [{ kind: "watch", teamId: "race:origin" }],
      team: "race",
    });
    expect(race.faces.map((face) => face.sessionId)).toEqual(["l1", "l2"]);
    expect(model.columns["needs-you"][0]).toMatchObject({
      sessionId: "b",
      line: "Discussing · Codex asked a question",
      actions: [{ kind: "open" }, { kind: "watch", teamId: "discuss:a" }],
    });
    expect(model.columns.review[0]).toMatchObject({
      line: "Ready to compare · 1 of 2 done",
      actions: [
        { kind: "compare", raceId: "r" },
        { kind: "watch", teamId: "race:r" },
      ],
    });
    // A finished team is no card of its own.
    expect(model.columns.shipped).toEqual([]);
  });

  it("keeps to its project", () => {
    const model = board({
      chats: [chat("here"), chat("there", { cwd: "/work/other" })],
      statuses: { here: "working", there: "working", far: "review" },
      reviews: { far: review("far", { project: "/work/other" }) },
      teams: [team("race", "running", "x", ["y"], { project: "/work/other" })],
    });
    expect(titles(model)).toEqual({
      "needs-you": [],
      working: ["here"],
      review: [],
      shipped: [],
    });
  });

  it("shows this week's ships and counts the older ones until asked", () => {
    const shipped = {
      today: ship("today", { title: "today" }),
      week: ship("week", { title: "week", at: NOW - 3 * DAY }),
      old: ship("old", { title: "old", at: NOW - 30 * DAY }),
    };
    const statuses = {
      today: "shipped",
      week: "shipped",
      old: "shipped",
    } as const;
    const recent = board({ shipped, statuses });
    expect(recent.columns.shipped.map((card) => card.title)).toEqual([
      "today",
      "week",
    ]);
    expect(recent.olderShipped).toBe(1);
    expect(recent.today.shipped).toBe(1);
    const all = board({ shipped, statuses, showOlder: true });
    expect(all.columns.shipped.map((card) => card.title)).toEqual([
      "today",
      "week",
      "old",
    ]);
    expect(all.olderShipped).toBe(0);
  });

  it("keeps a ship in Shipped once its chat has new changes, and counts it in the header", () => {
    // Shipped this morning, then a race brought in more for review.
    const model = board({
      chats: [chat("calc", { title: "Round up" })],
      statuses: { calc: "review" },
      reviews: { calc: review("calc", { at: NOW - 1_000 }) },
      shipped: {
        calc: ship("calc", {
          at: NOW - 2 * 3_600_000,
          commit: {
            sha: "9f8e7d6c5",
            shortSha: "9f8e7d6",
            subject: "Add a round-up option",
          },
        }),
      },
    });
    expect(titles(model)).toEqual({
      "needs-you": [],
      working: [],
      review: ["Round up"],
      shipped: ["Add a round-up option"],
    });
    expect(model.columns.shipped[0]).toMatchObject({
      id: "ship:9f8e7d6c5",
      sessionId: "calc",
      faces: [{ sessionId: "calc", harness: "claude" }],
    });
    expect(model.columns.shipped[0]!.line).toMatch(/^Commit 9f8e7d6 · /);
    expect(boardTodayText(model.today)).toBe(
      "Today: 1 shipped · 0 in progress",
    );
  });

  it("shows each of a chat's ships, and one card for a ship that carried several chats", () => {
    const together = {
      sha: "aaaa1111",
      shortSha: "aaaa111",
      subject: "Ship both",
    };
    const model = board({
      chats: [chat("b", { harness: "codex" })],
      statuses: { a: "shipped", b: "shipped", c: "shipped" },
      shipped: {
        a: ship("a", {
          at: NOW - 60_000,
          earlier: [
            {
              at: NOW - 3_600_000,
              commit: {
                sha: "bbbb2222",
                shortSha: "bbbb222",
                subject: "First pass",
              },
            },
            { at: NOW - 2 * DAY, pushed: true },
          ],
        }),
        b: ship("b", { at: NOW - 120_000, commit: together }),
        c: ship("c", {
          at: NOW - 120_000,
          commit: together,
          harness: "cursor",
        }),
      },
    });
    expect(model.columns.shipped.map((card) => card.title)).toEqual([
      "a",
      "Ship both",
      "First pass",
      "Chat",
    ]);
    expect(model.columns.shipped[1]!.faces).toEqual([
      { sessionId: "b", harness: "codex" },
      { sessionId: "c", harness: "cursor" },
    ]);
    // A ship without a commit is named by its chat and says it was pushed.
    expect(model.columns.shipped[3]!.line).toMatch(/^Pushed · /);
    expect(model.columns.shipped[3]!.actions).toEqual([]);
    expect(model.today.shipped).toBe(3);
  });

  it("names a single changed file", () => {
    expect(reviewLine(review("x", { files: 1, names: ["Row.js"] }))).toBe(
      "Row.js · +48 −12",
    );
  });
});

describe("boardChats", () => {
  const approval: Block = {
    id: "ask",
    role: "approval",
    text: "Run npm run deploy",
    tool: { title: "npm run deploy" },
    approval: { requestId: 7 },
  };

  it("reduces loaded chats to small rows with what they do or ask", () => {
    const sessions: Session[] = [
      {
        ...newSession("claude", PROJECT),
        id: "ask",
        title: "claude · Publish reminders",
        busy: true,
        blocks: [
          { id: "u", role: "user", text: "Deploy", startedAt: NOW - 5_000 },
          approval,
        ],
      },
      {
        ...newSession("codex", PROJECT),
        id: "copy",
        worktreeCwd: "/copies/site-1",
        title: "codex · Docs",
        blocks: [{ id: "u", role: "user", text: "Docs", startedAt: 9 }],
      },
    ];
    const rows = boardChats(sessions, new Set(["ask"]), NO_LEAD_DECIDED);
    expect(rows[0]).toMatchObject({
      id: "ask",
      title: "Publish reminders",
      waiting: { kind: "approval", detail: "npm run deploy", requestId: 7 },
    });
    expect(rows[1]).toMatchObject({
      id: "copy",
      cwd: PROJECT,
      workCwd: "/copies/site-1",
      harness: "codex",
    });
    expect(rows[1]?.waiting).toBeUndefined();
  });
});
