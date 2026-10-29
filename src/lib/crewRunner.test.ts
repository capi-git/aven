// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrewRunner, crewBranch, replyForTurn } from "./crewRunner";
import {
  crewCard,
  defaultCrewLimits,
  getCrew,
  resetCrewsCache,
  updateCrew,
  withIdea,
  type Crew,
} from "./crews";
import { queueCard } from "./crewLoop";
import { localDay, resetProjectBotsCache } from "./projectBots";
import type { BotDiff } from "./projectBotCopy";
import type { BotSendOptions } from "./projectBotRunner";
import type {
  FeatureCard,
  FeatureCardDraft,
  FeatureColumn,
} from "./featureCards";
import type { Session } from "./session";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

const PATH = "/Users/me/aven-site";
const COPY = "/data/bots/aven-site-crew-1";
const BASE = "b".repeat(40);
/** Local noon, outside the default quiet hours. */
const NOON = new Date(2026, 9, 29, 12, 0).getTime();
const MINUTE = 60_000;

type Role = "builder" | "checker" | "scout";
type Reply = {
  text: string;
  /** What the copy holds after the turn: its fingerprint and files. */
  copy?: { hash: string; files: string[] } | null;
  status?: "completed" | "failed";
  /** The turn waits on you (a question) instead of ending. */
  asks?: boolean;
};
/** A stand-in agent: what it replies to the nth message it gets. */
type Agent = (text: string, nth: number) => Reply;

const fence = (name: string, body: unknown) =>
  `Done.\n\n\`\`\`${name}\n${JSON.stringify(body)}\n\`\`\``;
const handoff = (summary: string, extra: object = {}) =>
  fence("aven-handoff", {
    summary,
    howToCheck: ["Open Settings"],
    ran: [{ command: "npm test", ok: true, note: "48 passed" }],
    ...extra,
  });
const verdict = (mustFix: unknown[], later: string[] = []) =>
  fence("aven-verdict", {
    pass: !mustFix.length,
    summary: mustFix.length ? "Not yet." : "Looks right.",
    mustFix,
    later,
    ran: [{ command: "npm test", ok: true }],
  });

function harness(agents: Partial<Record<Role, Agent>>) {
  let now = NOON;
  let nextId = 1;
  let turnIds = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  let sessions: Session[] = [];
  const sent: {
    role: Role;
    sessionId: string;
    text: string;
    options: BotSendOptions;
  }[] = [];
  const counts: Record<Role, number> = { builder: 0, checker: 0, scout: 0 };
  const stopped: string[] = [];
  const fresh: string[] = [];
  let copyState: { hash: string; files: string[] } | null = null;
  const board = new Map<string, FeatureCard>();
  const moves: { id: string; column: FeatureColumn }[] = [];
  const roleOf = new Map<string, Role>();

  const diff = (): BotDiff =>
    copyState
      ? {
          files: copyState.files.map((path) => ({
            path,
            status: "modified",
            additions: 3,
            deletions: 1,
            binary: false,
          })),
          additions: copyState.files.length * 3,
          deletions: copyState.files.length,
          hash: copyState.hash,
        }
      : { files: [], additions: 0, deletions: 0, hash: "empty" };

  const copy = {
    prepare: vi.fn(async (_cwd: string, _key: string, branch: string) => ({
      path: COPY,
      branch,
      root: PATH,
      gitDir: `${PATH}/.git`,
    })),
    sync: vi.fn(async () => {
      copyState = null;
      return { root: PATH, base: BASE, uncommitted: true, untracked: false };
    }),
    diff: vi.fn(async () => diff()),
    sources: vi.fn(async () => [`${COPY}/src`, `${COPY}/package.json`]),
  };

  const update = (id: string, change: (chat: Session) => Session) => {
    sessions = sessions.map((chat) => (chat.id === id ? change(chat) : chat));
  };

  const runner = new CrewRunner({
    owner: "me",
    now: () => now,
    setTimer: (run, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (id) => void timers.delete(id),
    sessions: () => sessions,
    ensureChat: async (_crew: Crew, role) => {
      const id = `${role}-chat`;
      roleOf.set(id, role);
      if (!sessions.some((chat) => chat.id === id))
        sessions = [
          ...sessions,
          {
            id,
            harness: "claude",
            model: "claude:test",
            modelSettings: {},
            runtimeMode: "auto",
            title: role,
            cwd: PATH,
            worktreeCwd: COPY,
            blocks: [],
          } as Session,
        ];
      return sessions.find((chat) => chat.id === id)!;
    },
    send: (sessionId, text, options) => {
      const role = roleOf.get(sessionId)!;
      sent.push({ role, sessionId, text, options });
      update(sessionId, (chat) => ({
        ...chat,
        busy: true,
        blocks: [
          ...chat.blocks,
          { id: options.blockId, role: "user", text: options.displayText },
        ],
      }));
      const agent = agents[role];
      const nth = ++counts[role];
      const reply = agent?.(text, nth) ?? { text: "" };
      // The agent answers a minute later, in its own chat.
      const id = nextId++;
      timers.set(id, {
        at: now + MINUTE,
        run: () => {
          if (reply.copy !== undefined) copyState = reply.copy;
          if (reply.asks) {
            update(sessionId, (chat) => ({
              ...chat,
              pendingQuestion: {
                id: "q",
              } as unknown as Session["pendingQuestion"],
            }));
            return;
          }
          update(sessionId, (chat) => ({
            ...chat,
            busy: false,
            providerSessionId: `provider-${sessionId}`,
            blocks: [
              ...chat.blocks,
              { id: `reply-${turnIds++}`, role: "assistant", text: reply.text },
            ],
          }));
          options.onSettled({
            status: reply.status ?? "completed",
            text: reply.text,
          });
        },
      });
      return true;
    },
    stopChat: (sessionId) => {
      stopped.push(sessionId);
      update(sessionId, (chat) => ({ ...chat, busy: false }));
    },
    copy,
    weeklyUsed: () => 40,
    fixerRuns: () => 0,
    fixerBranch: () => "aven/bot/jelly-1a2b",
    board: {
      cards: async () => [...board.values()],
      move: (_project, id, column) => {
        moves.push({ id, column });
        const card = board.get(id);
        if (card) board.set(id, { ...card, column });
      },
      add: async (_project, drafts: readonly FeatureCardDraft[]) =>
        drafts.map((draft, index) => {
          const card: FeatureCard = {
            id: `idea-${board.size + index + 1}`,
            title: draft.title,
            ...(draft.note ? { note: draft.note } : {}),
            column: draft.column ?? "idea",
            chatIds: [],
            createdAt: now,
            updatedAt: now,
            movedAt: now,
          };
          board.set(card.id, card);
          return card;
        }),
    },
    name: (_crew, role) =>
      ({ builder: "Beetle", checker: "Owl", scout: "Fox", fixer: "Jelly" })[
        role
      ],
    onWorking: () => {},
    freshConversation: (sessionId) => {
      fresh.push(sessionId);
      update(sessionId, (chat) => ({ ...chat, providerSessionId: undefined }));
    },
    newId: () => `turn-${nextId++}`,
  });

  const flush = async () => {
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  };

  /** Run every timer due within `ms`, in order, letting each step finish. */
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
    sent,
    stopped,
    fresh,
    copy,
    moves,
    board,
    advance,
    get sessions() {
      return sessions;
    },
    get now() {
      return now;
    },
    setNow: (at: number) => {
      now = at;
    },
  };
}

function onCrew(patch: Partial<Crew> = {}) {
  updateCrew(PATH, (crew) => ({
    ...crew,
    on: true,
    onAt: 1,
    ...patch,
  }));
}

function give(id = "card-1", title = "Dark mode toggle") {
  updateCrew(PATH, (crew) => ({
    ...crew,
    cards: [
      ...crew.cards,
      queueCard(
        {
          id,
          title,
          brief: `${title}\n\nA switch in Settings.`,
          from: "you",
          maxRounds: crew.limits.roundsPerCard,
        },
        NOON,
      ),
    ],
  }));
}

const card = (id = "card-1") => crewCard(getCrew(PATH)!, id)!;

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  resetCrewsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProjectBotsCache();
  resetCrewsCache();
});

describe("the loop with stand-in agents", () => {
  it("passes, fails, then passes: Ready in Review with an Inbox card", async () => {
    const h = harness({
      builder: (_text, nth) => ({
        text: handoff(
          nth === 1 ? "A switch and a theme store." : "Fixed both.",
        ),
        copy: { hash: `h${nth}`, files: ["src/theme.ts", "src/Toggle.css"] },
      }),
      checker: (_text, nth) =>
        nth === 1
          ? {
              text: verdict(
                [
                  { text: "Label contrast is 2.9:1", where: "Toggle.css" },
                  { text: "Reload forgets the choice", where: "theme.ts:41" },
                ],
                ["Follow the system setting"],
              ),
            }
          : {
              text: verdict(
                [{ text: "Contrast fine now", about: 1 }].slice(0, 0),
              ),
            },
    });
    onCrew();
    give();
    h.runner.start();
    await h.advance(0);
    expect(card()).toMatchObject({ stage: "building", round: 1 });
    expect(h.copy.sync).toHaveBeenCalledTimes(1);
    expect(h.sent[0].role).toBe("builder");
    expect(h.sent[0].options.botWake?.label).toBe(
      "Card · Dark mode toggle · round 1",
    );
    // The copy's branch is the crew's, never the Fixer's.
    expect(h.copy.prepare.mock.calls[0][2]).toBe(crewBranch(PATH));
    expect(h.copy.prepare.mock.calls[0][2]).not.toBe("aven/bot/jelly-1a2b");

    await h.advance(MINUTE + 5_000);
    expect(card()).toMatchObject({ stage: "checking", round: 1 });
    expect(h.sent[1].role).toBe("checker");
    expect(h.sent[1].text).toContain("<builder-handoff>");
    expect(h.sent[1].options.botWake?.label).toBe(
      "From Beetle · Dark mode toggle · round 1",
    );

    await h.advance(MINUTE + 5_000);
    expect(card()).toMatchObject({ stage: "building", round: 2 });
    expect(card().later).toEqual(["Follow the system setting"]);
    expect(h.sent[2].role).toBe("builder");
    expect(h.sent[2].text).toContain(
      "Owl checked round 1 and asked for these fixes",
    );

    await h.advance(MINUTE + 5_000);
    expect(h.sent[3].role).toBe("checker");
    expect(h.sent[3].text).toContain("This is a re-check");
    await h.advance(MINUTE + 5_000);

    const ready = card();
    expect(ready).toMatchObject({ stage: "ready", round: 2, runs: 4 });
    expect(ready.fix).toMatchObject({ base: BASE, hash: "h2", files: 2 });
    expect(ready.inbox).toMatchObject({
      kind: "review",
      title: "Dark mode toggle",
      status: "open",
    });
    expect(ready.inbox?.summary).toBe(
      "Passed Owl's check in round 2 · 2 files · +6 −2 · 4 runs",
    );
    expect(h.moves).toContainEqual({ id: "card-1", column: "review" });
    const crew = getCrew(PATH)!;
    expect(crew.runs).toEqual({ day: localDay(NOON), count: 4 });
    expect(crew.feed.map((entry) => entry.kind)).toEqual([
      "start",
      "handoff",
      "verdict",
      "handoff",
      "ready",
    ]);
    // Nothing more starts while the Ready card holds the copy.
    await h.advance(10 * MINUTE);
    expect(h.sent).toHaveLength(4);
    h.runner.stop();
  });

  it("stops Stuck after 3 rounds, with no fourth turn", async () => {
    const h = harness({
      builder: (_text, nth) => ({
        text: handoff(`Try ${nth}`),
        copy: { hash: `h${nth}`, files: ["src/search.ts"] },
      }),
      checker: (_text, nth) => ({
        text: verdict([
          nth === 1
            ? { text: "Search takes 1.8 s" }
            : { text: "Still slow", about: 1 },
        ]),
      }),
    });
    onCrew();
    give("card-1", "Search inside note bodies");
    h.runner.start();
    await h.advance(30 * MINUTE);
    expect(card()).toMatchObject({ stage: "stuck", round: 3, runs: 6 });
    expect(card().stuck).toEqual({
      reason: "rounds",
      text: "Stuck after 3 rounds",
    });
    expect(h.sent.map((item) => item.role)).toEqual([
      "builder",
      "checker",
      "builder",
      "checker",
      "builder",
      "checker",
    ]);
    expect(card().inbox?.summary).toBe("Stuck after 3 rounds · 6 runs");
    h.runner.stop();
  });

  it("stops early when a round changes nothing", async () => {
    const h = harness({
      builder: () => ({
        text: handoff("Same as before"),
        copy: { hash: "same", files: ["src/list.tsx"] },
      }),
      checker: () => ({ text: verdict([{ text: "Rows overlap" }]) }),
    });
    onCrew();
    give("card-1", "Compact list view");
    h.runner.start();
    await h.advance(30 * MINUTE);
    expect(card().stuck).toEqual({
      reason: "no-change",
      text: "Stopped early: round 2 changed nothing Owl asked for",
    });
    expect(h.sent).toHaveLength(3);
    h.runner.stop();
  });

  it("waits on you when the Builder asks, then goes on with your answer", async () => {
    const h = harness({
      builder: (_text, nth) =>
        nth === 1
          ? {
              text: handoff("Half done.", {
                question: "Should the PDF keep each note's colour?",
              }),
              copy: { hash: "h1", files: ["src/pdf.ts"] },
            }
          : {
              text: handoff("Kept the colours."),
              copy: { hash: "h2", files: ["src/pdf.ts"] },
            },
      checker: () => ({ text: verdict([]) }),
    });
    onCrew();
    give("card-1", "Export notes as PDF");
    h.runner.start();
    await h.advance(2 * MINUTE);
    expect(card()).toMatchObject({ stage: "stuck", holder: "builder" });
    expect(card().stuck?.text).toBe(
      "Beetle asked: Should the PDF keep each note's colour?",
    );
    expect(card().inbox?.status).toBe("open");
    // Nothing goes on until you answer.
    await h.advance(10 * MINUTE);
    expect(h.sent).toHaveLength(1);

    const { resumeCrewCard } = await import("./crewActions");
    resumeCrewCard(PATH, "card-1", "Yes, keep them.", h.now);
    await h.advance(0);
    expect(h.sent[1].role).toBe("builder");
    expect(h.sent[1].text).toContain("The user says: Yes, keep them.");
    expect(card().inbox?.status).toBe("done");
    await h.advance(5 * MINUTE);
    expect(card()).toMatchObject({ stage: "ready", round: 1 });
    h.runner.stop();
  });

  it("puts a card in Needs you while a turn waits on an approval or question", async () => {
    const h = harness({
      builder: () => ({ text: "", asks: true }),
    });
    onCrew();
    give();
    h.runner.start();
    await h.advance(2 * MINUTE);
    h.runner.observe(h.sessions);
    expect(card().stage).toBe("stuck");
    expect(card().stuck?.text).toBe("Beetle is waiting on a question");
    h.runner.stop();
  });

  it("voids a check that changed the Builder's files", async () => {
    const h = harness({
      builder: () => ({
        text: handoff("Done"),
        copy: { hash: "h1", files: ["src/a.ts"] },
      }),
      checker: () => ({
        text: verdict([]),
        copy: { hash: "checker-edit", files: ["src/a.ts"] },
      }),
    });
    onCrew();
    give();
    h.runner.start();
    await h.advance(10 * MINUTE);
    expect(card().stuck?.reason).toBe("checker-edited");
    expect(card().fix).toBeUndefined();
    h.runner.stop();
  });

  it("stops a turn that runs past the crew's turn limit", async () => {
    const h = harness({ builder: () => ({ text: "", asks: true }) });
    onCrew();
    give();
    h.runner.start();
    await h.advance(21 * MINUTE);
    expect(h.stopped).toEqual(["builder-chat"]);
    expect(card().stuck).toEqual({
      reason: "timeout",
      text: "Beetle's turn ran past 20 minutes and was stopped",
    });
    h.runner.stop();
  });
});

describe("fresh eyes", () => {
  it("starts each card's build and check on a new conversation, keeping it for re-checks", async () => {
    const h = harness({
      builder: (_text, nth) => ({
        text: handoff(`Round ${nth}`),
        copy: { hash: `h${nth}`, files: ["src/a.ts"] },
      }),
      checker: (_text, nth) => ({
        text:
          nth === 1
            ? verdict([{ text: "Broken" }])
            : nth === 2
              ? verdict([])
              : verdict([]),
      }),
    });
    onCrew();
    give("first", "First");
    h.runner.start();
    await h.advance(10 * MINUTE);
    expect(card("first").stage).toBe("ready");
    // First card: both chats were new, so nothing to forget yet; each got its role.
    expect(h.fresh).toEqual([]);
    expect(h.sent[0].text).toContain("You are Beetle, the Builder");
    expect(h.sent[1].text).toContain("You are Owl, the Checker");
    // Round 2 keeps its conversation: no role again, no fresh start.
    expect(h.sent[2].text).not.toContain("You are Beetle");
    expect(h.sent[3].text).not.toContain("You are Owl");

    updateCrew(PATH, (crew) => ({
      ...crew,
      cards: crew.cards.map((item) =>
        item.id === "first" ? { ...item, stage: "applied" } : item,
      ),
    }));
    give("second", "Second");
    await h.advance(10 * MINUTE);
    // The next card starts both on new conversations, with their roles.
    expect(h.fresh).toEqual(["builder-chat", "checker-chat"]);
    expect(h.sent[4].text).toContain("You are Beetle, the Builder");
    expect(h.sent[5].text).toContain("You are Owl, the Checker");
    h.runner.stop();
  });
});

describe("one card at a time", () => {
  it("starts the next queued card only after the first is applied or thrown away", async () => {
    const h = harness({
      builder: (_text, nth) => ({
        text: handoff("Built"),
        copy: { hash: `h${nth}`, files: ["src/a.ts"] },
      }),
      checker: () => ({ text: verdict([]) }),
    });
    onCrew();
    give("first", "First");
    give("second", "Second");
    h.runner.start();
    await h.advance(10 * MINUTE);
    expect(card("first").stage).toBe("ready");
    expect(card("second").stage).toBe("queued");
    expect(h.sent.every((item) => !item.text.includes("Second"))).toBe(true);

    updateCrew(PATH, (crew) => ({
      ...crew,
      cards: crew.cards.map((item) =>
        item.id === "first" ? { ...item, stage: "applied" } : item,
      ),
    }));
    await h.advance(10 * MINUTE);
    expect(card("second").stage).toBe("ready");
    h.runner.stop();
  });
});

describe("budgets in the runner", () => {
  it("holds at the run cap with a reason in the feed, and starts nothing", async () => {
    const h = harness({ builder: () => ({ text: handoff("x") }) });
    onCrew({ runs: { day: localDay(NOON), count: 20 } });
    give();
    h.runner.start();
    await h.advance(MINUTE);
    expect(h.sent).toHaveLength(0);
    const crew = getCrew(PATH)!;
    expect(crew.hold?.reason).toBe("daily-cap");
    expect(crew.feed.at(-1)?.text).toBe(
      "Today's 20 runs are used. The crew picks up again tomorrow.",
    );
    h.runner.stop();
  });

  it("starts nothing in quiet hours, and picks up at 8 am", async () => {
    const h = harness({
      builder: () => ({
        text: handoff("x"),
        copy: { hash: "h", files: ["a"] },
      }),
      checker: () => ({ text: verdict([]) }),
    });
    h.setNow(new Date(2026, 9, 29, 23, 30).getTime());
    onCrew();
    give();
    h.runner.start();
    await h.advance(MINUTE);
    expect(h.sent).toHaveLength(0);
    expect(getCrew(PATH)!.hold?.reason).toBe("quiet-hours");
    h.setNow(new Date(2026, 9, 30, 8, 0).getTime());
    await h.advance(MINUTE);
    expect(h.sent[0]?.role).toBe("builder");
    h.runner.stop();
  });

  it("pauses at 80% of the Claude week", async () => {
    const h = harness({ builder: () => ({ text: handoff("x") }) });
    // The harness reads 40%; this crew pauses at 30%.
    onCrew({
      limits: { ...defaultCrewLimits(), pauseAtPercent: 30 },
    });
    give();
    h.runner.start();
    await h.advance(MINUTE);
    expect(h.sent).toHaveLength(0);
    expect(getCrew(PATH)!.hold?.reason).toBe("usage");
    h.runner.stop();
  });
});

describe("the Scout: ideas start themselves, within limits", () => {
  it("looks once a day, adds its ideas, and starts the small one by itself", async () => {
    const h = harness({
      scout: () => ({
        text: fence("aven-ideas", {
          ideas: [
            {
              title: "Remember the last open note",
              why: "Saves a click",
              size: "small",
            },
            { title: "Search inside note bodies", size: "medium" },
            {
              title: "Fix issue 12",
              size: "small",
              source: "https://github.com/o/r/issues/12",
            },
          ],
        }),
      }),
      builder: () => ({
        text: handoff("Built"),
        copy: { hash: "h1", files: ["src/notes.ts"] },
      }),
      checker: () => ({ text: verdict([]) }),
    });
    onCrew();
    h.runner.start();
    await h.advance(0);
    expect(h.sent[0].role).toBe("scout");
    expect(h.sent[0].text).toContain("suggest at most 3 small, scoped ideas");
    await h.advance(MINUTE + 5_000);
    const crew = getCrew(PATH)!;
    expect([...h.board.values()].map((item) => item.title)).toEqual([
      "Remember the last open note",
      "Search inside note bodies",
      "Fix issue 12",
    ]);
    expect(crew.ideasAdded).toEqual({ day: localDay(NOON), count: 3 });
    // Only the small idea from the project started by itself.
    expect(crew.autoStarts).toEqual({ day: localDay(NOON), count: 1 });
    expect(card("idea-1")).toMatchObject({ from: "scout", size: "small" });
    expect(crewCard(crew, "idea-2")).toBeUndefined();
    expect(crewCard(crew, "idea-3")).toBeUndefined();
    expect(h.moves).toContainEqual({ id: "idea-1", column: "building" });
    await h.advance(10 * MINUTE);
    expect(card("idea-1").stage).toBe("ready");
    // The Scout doesn't look again today, and nothing else starts.
    await h.advance(60 * MINUTE);
    expect(h.sent.filter((item) => item.role === "scout")).toHaveLength(1);
    h.runner.stop();
  });

  it("starts no more ideas than the day's cap", async () => {
    const h = harness({
      builder: () => ({
        text: handoff("x"),
        copy: { hash: "h", files: ["a"] },
      }),
      checker: () => ({ text: verdict([]) }),
    });
    onCrew({
      scoutAt: NOON,
      autoStarts: { day: localDay(NOON), count: 3 },
    });
    updateCrew(PATH, (crew) =>
      withIdea(crew, "idea-9", { at: 1, size: "small" }),
    );
    h.board.set("idea-9", {
      id: "idea-9",
      title: "Small idea",
      column: "idea",
      chatIds: [],
      createdAt: 1,
      updatedAt: 1,
      movedAt: 1,
    });
    h.runner.start();
    await h.advance(5 * MINUTE);
    expect(h.sent).toHaveLength(0);
    expect(crewCard(getCrew(PATH)!, "idea-9")).toBeUndefined();
    h.runner.stop();
  });

  it("never starts an idea you said Not now to", async () => {
    const h = harness({});
    onCrew({ scoutAt: NOON });
    updateCrew(PATH, (crew) =>
      withIdea(crew, "idea-9", { at: 1, size: "small", declined: true }),
    );
    h.board.set("idea-9", {
      id: "idea-9",
      title: "Small idea",
      column: "idea",
      chatIds: [],
      createdAt: 1,
      updatedAt: 1,
      movedAt: 1,
    });
    h.runner.start();
    await h.advance(5 * MINUTE);
    expect(h.sent).toHaveLength(0);
    h.runner.stop();
  });
});

describe("reading a turn", () => {
  it("reads the bot's last message in that turn only", () => {
    const chat = {
      blocks: [
        { id: "t1", role: "user", text: "card" },
        { id: "a", role: "assistant", text: "Working on it" },
        { id: "b", role: "assistant", text: "Final" },
        { id: "t2", role: "user", text: "you" },
        { id: "c", role: "assistant", text: "Later reply" },
      ],
    } as unknown as Session;
    expect(replyForTurn(chat, "t1")).toBe("Final");
    expect(replyForTurn(chat, "missing")).toBe("");
  });
});
