import { describe, expect, it } from "vitest";
import type { ChatReview } from "./chatReview";
import type { ChatStatusWord } from "./chatStatus";
import type { FeatureCard } from "./featureCards";
import {
  formatSessionTitle,
  newSession,
  type Block,
  type Session,
} from "./session";
import type { ShippedChat } from "./shippedChats";
import { NO_LEAD_DECIDED } from "./teamAttention";
import type { TeamMember, TeamRun, TeamStatus } from "./teamRuns";
import {
  boardChats,
  boardTodayText,
  cardBasis,
  chatBoardColumn,
  chatCardDrafts,
  outsideText,
  reviewLine,
  sourceLabel,
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

const card = (id: string, patch: Partial<FeatureCard> = {}): FeatureCard => ({
  id,
  title: `Feature ${id}`,
  column: "idea",
  chatIds: [],
  createdAt: NOW - DAY,
  updatedAt: NOW - DAY,
  movedAt: NOW - DAY,
  ...patch,
});

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
    cards: [],
    chats: [],
    statuses: {},
    teams: [],
    reviews: {},
    shipped: {},
    previews: [],
    now: NOW,
    live: true,
    ...patch,
  });

const titles = (model: ReturnType<typeof board>) =>
  Object.fromEntries(
    Object.entries(model.columns).map(([column, cards]) => [
      column,
      cards.map((entry) => entry.title),
    ]),
  );

const only = (model: ReturnType<typeof board>) =>
  Object.values(model.columns).flat()[0]!;

describe("workBoard", () => {
  it("shows cards in their saved columns, ideas oldest first", () => {
    const model = board({
      cards: [
        card("b", { title: "Export", createdAt: NOW - 1_000 }),
        card("a", { title: "Dark mode", createdAt: NOW - 2_000 }),
        card("c", { title: "Search", column: "building", chatIds: ["x"] }),
      ],
      live: false,
    });
    expect(titles(model)).toEqual({
      idea: ["Dark mode", "Export"],
      building: ["Search"],
      review: [],
      shipped: [],
    });
    expect(model.empty).toBe(false);
    expect(board({}).empty).toBe(true);
    // An idea leads with Build.
    expect(model.columns.idea[0].actions).toEqual([{ kind: "build" }]);
  });

  it("moves a card to Building while any of its chats works, with what it is doing", () => {
    const model = board({
      cards: [card("f", { chatIds: ["run"] })],
      chats: [chat("run", { startedAt: NOW - 120_000, doing: "Edit App.tsx" })],
      statuses: { run: "working" },
    });
    const drawn = model.columns.building[0];
    expect(drawn).toMatchObject({
      column: "building",
      working: true,
      line: "Edit App.tsx",
      since: NOW - 120_000,
      sessionId: "run",
      faces: [{ sessionId: "run", harness: "claude" }],
    });
    expect(model.settles).toEqual([
      {
        id: "f",
        from: undefined,
        basis: "run:working::",
        column: "building",
      },
    ]);
  });

  it("moves a card to Review once work stops with changes, with Review and Ship it", () => {
    const model = board({
      cards: [card("f", { column: "building", chatIds: ["fix"] })],
      chats: [chat("fix", { workCwd: "/copies/site-1" })],
      statuses: { fix: "review" },
      reviews: { fix: review("fix", { files: 1, names: ["Row.js"] }) },
      previews: [
        {
          key: "p1",
          project: PROJECT,
          cwd: PROJECT,
          sessionId: "fix",
          status: "live",
        },
      ],
    });
    const drawn = model.columns.review[0];
    expect(drawn.line).toBe("Row.js · +48 −12 · preview running");
    expect(drawn.actions).toEqual([
      { kind: "preview", previewKey: "p1" },
      { kind: "review", sessionId: "fix", cwd: "/copies/site-1" },
      { kind: "ship", sessionId: "fix", cwd: "/copies/site-1" },
    ]);
    expect(model.settles[0]).toMatchObject({ id: "f", column: "review" });
  });

  it("moves a card to Shipped with the date once its chat ships", () => {
    const model = board({
      cards: [card("f", { column: "review", chatIds: ["done"] })],
      statuses: { done: "shipped" },
      shipped: {
        done: ship("done", {
          at: NOW - 2 * DAY,
          pr: { number: 42, url: "https://github.com/o/r/pull/42" },
        }),
      },
    });
    const drawn = model.columns.shipped[0];
    expect(drawn.line).toMatch(/^Shipped .+ · PR #42$/);
    expect(drawn.actions).toEqual([
      { kind: "pr", number: 42, url: "https://github.com/o/r/pull/42" },
    ]);
    // Shipped when its chat shipped, not when the board noticed.
    expect(model.settles[0]).toMatchObject({
      column: "shipped",
      shippedAt: NOW - 2 * DAY,
    });
    expect(drawn.at).toBe(NOW - 2 * DAY);
  });

  it("leaves a card where it is with an amber Needs you while a chat waits on you", () => {
    const model = board({
      cards: [card("f", { column: "building", chatIds: ["ask"] })],
      chats: [
        chat("ask", {
          harness: "codex",
          waiting: { kind: "approval", detail: "npm i", requestId: 7 },
        }),
      ],
      statuses: { ask: "needs-you" },
    });
    const drawn = model.columns.building[0];
    expect(drawn.needsYou).toBe("Codex wants your approval: npm i");
    expect(drawn.actions).toEqual([
      { kind: "allow", sessionId: "ask", requestId: 7 },
      { kind: "open", sessionId: "ask" },
    ]);
    // Its basis is saved, so the card keeps its place.
    expect(model.settles[0]).toMatchObject({ column: "building" });
    const question = board({
      cards: [card("f", { column: "review", chatIds: ["ask"] })],
      chats: [
        chat("ask", { waiting: { kind: "question", detail: "Which port?" } }),
      ],
      statuses: { ask: "needs-you" },
    });
    expect(question.columns.review[0].needsYou).toBe(
      "Claude asked: Which port?",
    );
    expect(question.columns.review[0].actions).toEqual([
      { kind: "answer", sessionId: "ask" },
    ]);
  });

  it("keeps a move by hand until a linked chat really changes", () => {
    const statuses: Record<string, ChatStatusWord> = { fix: "review" };
    const reviews = { fix: review("fix") };
    const basis = cardBasis(["fix"], statuses, reviews, {});
    // Moved back to Ideas by hand while its changes wait.
    const moved = card("f", { column: "idea", chatIds: ["fix"], basis });
    const held = board({ cards: [moved], statuses, reviews });
    expect(held.columns.idea.map((entry) => entry.id)).toEqual(["f"]);
    expect(held.settles).toEqual([]);
    // A streamed reply or a minute's tick changes nothing.
    expect(
      board({
        cards: [moved],
        statuses,
        reviews,
        now: NOW + 60_000,
        chats: [chat("fix", { doing: "Thinking" })],
      }).settles,
    ).toEqual([]);
    // New work in the chat is a real change: the card follows it again.
    const again = board({
      cards: [moved],
      statuses: { fix: "working" },
      reviews,
      chats: [chat("fix")],
    });
    expect(again.columns.building.map((entry) => entry.id)).toEqual(["f"]);
    // So are new changes.
    const newer = board({
      cards: [moved],
      statuses,
      reviews: { fix: review("fix", { at: NOW }) },
    });
    expect(newer.columns.review.map((entry) => entry.id)).toEqual(["f"]);
  });

  it("follows the busiest of several chats", () => {
    const cards = [card("f", { column: "idea", chatIds: ["a", "b", "c"] })];
    const reviews = { b: review("b") };
    expect(
      only(
        board({
          cards,
          statuses: { a: "shipped", b: "review", c: "working" },
          reviews,
          shipped: { a: ship("a") },
          chats: [chat("c")],
        }),
      ).column,
    ).toBe("building");
    expect(
      only(
        board({
          cards,
          statuses: { a: "shipped", b: "review" },
          reviews,
          shipped: { a: ship("a") },
        }),
      ).column,
    ).toBe("review");
    expect(
      only(
        board({ cards, statuses: { a: "shipped" }, shipped: { a: ship("a") } }),
      ).column,
    ).toBe("shipped");
    // Chats gone quiet move nothing.
    expect(only(board({ cards, statuses: {} })).column).toBe("idea");
  });

  it("moves nothing by itself until the workspace has told it the chats", () => {
    const model = board({
      cards: [card("f", { column: "idea", chatIds: ["run"] })],
      statuses: { run: "working" },
      live: false,
    });
    expect(only(model).column).toBe("idea");
    expect(model.settles).toEqual([]);
  });

  it("counts a race, discussion or run a card's chat started as that card's work", () => {
    const race = team("race", "running", "origin", ["l1", "l2"]);
    const model = board({
      cards: [card("f", { column: "idea", chatIds: ["origin"] })],
      chats: [chat("origin"), chat("l1"), chat("l2")],
      statuses: { origin: "racing", l1: "racing", l2: "racing" },
      teams: [race],
    });
    const drawn = model.columns.building[0];
    expect(drawn).toMatchObject({
      team: "race",
      working: true,
      line: "Racing · 1 of 2 done",
      faces: [
        { sessionId: "l1", harness: "codex" },
        { sessionId: "l2", harness: "codex" },
      ],
    });
    expect(drawn.actions).toEqual([{ kind: "watch", teamId: "race:origin" }]);
    // Its lanes are not work outside the board.
    expect(model.outside).toEqual([]);

    const ready = board({
      cards: [card("f", { column: "building", chatIds: ["origin"] })],
      statuses: { origin: "review" },
      teams: [
        team("race", "ready", "origin", ["l1"], {
          progress: "Ready to compare · 2 of 2 done",
        }),
      ],
    });
    expect(ready.columns.review[0]).toMatchObject({
      line: "Ready to compare · 2 of 2 done",
      actions: [
        { kind: "compare", raceId: "origin" },
        { kind: "watch", teamId: "race:origin" },
      ],
    });

    const paused = board({
      cards: [card("f", { column: "building", chatIds: ["lead"] })],
      statuses: { lead: "orchestrating" },
      teams: [
        team("orchestrate", "needs-you", "lead", ["w1"], {
          need: {
            kind: "paused",
            text: "The lead stopped without finishing",
            sessionId: "lead",
            since: NOW,
          } as TeamRun["need"],
        }),
      ],
    });
    expect(paused.columns.building[0].needsYou).toBe(
      "Paused · The lead stopped without finishing",
    );
  });

  it("shows this week's shipped cards and counts the older ones until asked", () => {
    const cards = [
      card("new", { column: "shipped", shippedAt: NOW - 3_600_000 }),
      card("old", { column: "shipped", shippedAt: NOW - 10 * DAY }),
    ];
    const model = board({ cards });
    expect(model.columns.shipped.map((entry) => entry.id)).toEqual(["new"]);
    expect(model.olderShipped).toBe(1);
    expect(model.columns.shipped[0].line).toMatch(/^Shipped \d/);
    const all = board({ cards, showOlder: true });
    expect(all.columns.shipped.map((entry) => entry.id)).toEqual([
      "new",
      "old",
    ]);
    expect(all.olderShipped).toBe(0);
  });

  it("says today's ships and the cards in progress", () => {
    const model = board({
      cards: [
        card("a", { column: "shipped", shippedAt: NOW - 60_000 }),
        card("b", { column: "shipped", shippedAt: NOW - 2 * DAY }),
        card("c", { column: "building" }),
        card("d", { column: "review" }),
        card("e", { column: "idea" }),
      ],
    });
    expect(boardTodayText(model.today)).toBe(
      "Today: 1 shipped · 2 in progress",
    );
  });

  it("sums up work in the project that no card links to", () => {
    const model = board({
      cards: [card("f", { column: "building", chatIds: ["mine"] })],
      chats: [
        chat("mine"),
        chat("ask", { waiting: { kind: "question", detail: "Port?" } }),
        chat("run"),
        chat("far", { cwd: "/work/other" }),
      ],
      statuses: {
        mine: "working",
        ask: "needs-you",
        run: "working",
        fix: "review",
        far: "working",
        done: "shipped",
        lane: "racing",
      },
      reviews: { fix: review("fix", { title: "Fix sign-in" }) },
      teams: [team("race", "running", "solo", ["lane"])],
    });
    expect(
      model.outside.map((entry) => [entry.id, entry.stage, entry.column]),
    ).toEqual([
      ["chat:ask", "needs-you", "building"],
      ["chat:run", "working", "building"],
      ["team:race:solo", "working", "building"],
      ["chat:fix", "review", "review"],
    ]);
    expect(model.outside.find((entry) => entry.id === "chat:fix")?.title).toBe(
      "Fix sign-in",
    );
    expect(outsideText(model.outside)).toBe(
      "4 chats outside the board: 1 needs you · 2 working · 1 with changes",
    );
  });

  it("words the outside line for one kind of work", () => {
    const entry = (stage: "needs-you" | "working" | "review") => ({
      id: stage,
      sessionId: stage,
      title: stage,
      stage,
      column: "building" as const,
      faces: [],
      at: 0,
    });
    expect(outsideText([entry("working"), entry("working")])).toBe(
      "2 chats working outside the board",
    );
    expect(outsideText([entry("needs-you")])).toBe(
      "1 chat needs you outside the board",
    );
    expect(outsideText([entry("review")])).toBe(
      "1 chat with changes outside the board",
    );
  });

  it("says where a card without chats stands, and offers Build", () => {
    const model = board({
      cards: [card("f", { column: "building" })],
    });
    expect(only(model)).toMatchObject({
      line: "No chat yet",
      actions: [{ kind: "build" }],
    });
    const quiet = board({
      cards: [card("f", { column: "building", chatIds: ["x"], basis: "x:::" })],
      statuses: {},
    });
    expect(only(quiet)).toMatchObject({
      line: "Agent stopped · nothing to review yet",
      actions: [{ kind: "open", sessionId: "x" }],
    });
  });

  it("labels a card's source link", () => {
    expect(sourceLabel("https://github.com/o/r/issues/12")).toBe("#12");
    expect(sourceLabel("https://linear.app/t/ISS-1")).toBe("linear.app");
    expect(sourceLabel("not a url")).toBe("Link");
    expect(
      only(
        board({
          cards: [card("f", { sourceUrl: "https://github.com/o/r/issues/12" })],
        }),
      ).source,
    ).toEqual({ url: "https://github.com/o/r/issues/12", label: "#12" });
  });

  it("starts a chat's card in the column its state implies", () => {
    expect(chatBoardColumn("working")).toBe("building");
    expect(chatBoardColumn("racing")).toBe("building");
    expect(chatBoardColumn("review")).toBe("review");
    expect(chatBoardColumn("shipped")).toBe("shipped");
    expect(chatBoardColumn("needs-you")).toBe("building");
    expect(chatBoardColumn(undefined)).toBe("building");
  });

  it("makes a card for each chat added to the board, on its project's board", () => {
    const drafts = chatCardDrafts(
      [
        {
          id: "a",
          cwd: PROJECT,
          title: formatSessionTitle("claude", "Fix sign-in"),
          harness: "claude",
        },
        { id: "b", cwd: "/work/other", title: "Docs", harness: "codex" },
        { id: "c", cwd: PROJECT, title: "Search", harness: "codex" },
        { id: "home", cwd: "~", title: "Scratch", harness: "claude" },
      ],
      { a: "review", c: "working" },
    );
    expect([...drafts.entries()]).toEqual([
      [
        PROJECT,
        [
          { title: "Fix sign-in", chatIds: ["a"], column: "review" },
          { title: "Search", chatIds: ["c"], column: "building" },
        ],
      ],
      ["/work/other", [{ title: "Docs", chatIds: ["b"], column: "building" }]],
    ]);
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
