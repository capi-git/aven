// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "./activity";
import type { DevServerStop } from "./devServerStops";
import type { SessionActivityEvent } from "./notifications";
import type { ControlOutcome } from "./orchestration";
import { resetDevPreviews, watchTerminalOutput } from "./devPreviews";
import { devServerStopsWatched } from "./devServerStops";
import { BotRunner, type BotSendOptions } from "./projectBotRunner";
import { BOT_SETTLE_MS } from "./projectBotWake";
import {
  getProjectBot,
  resetProjectBotsCache,
  resolveFix,
  updateProjectBot,
  withReadyFix,
} from "./projectBots";
import type { BotDiff } from "./projectBotCopy";
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

const PATH = "/Users/me/Orbit";
const COPY = "/data/bots/orbit-1";
const BASE = "b".repeat(40);
const NO_DIFF: BotDiff = {
  files: [],
  additions: 0,
  deletions: 0,
  hash: "none",
};

/** Local 2 pm, outside the default quiet hours. */
const START = new Date(2026, 9, 23, 14, 0).getTime();

type Sent = {
  sessionId: string;
  text: string;
  options: BotSendOptions;
  /** What the agent was sent, once the message's preparation ran. */
  agentText?: string;
};

function harness(
  options: {
    realStops?: boolean;
    /** Sent messages reach the chat a render later, as in the app. */
    lagged?: boolean;
  } = {},
) {
  let ids = 0;
  const lag: (() => void)[] = [];
  let now = START;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  let activity: ActivityEntry[] = [];
  let onActivity: (() => void) | undefined;
  let onStop: ((stop: DevServerStop) => void) | undefined;
  let sessions: Session[] = [];
  const sent: Sent[] = [];
  /** Messages sent the plain way, as any chat sends them. */
  const plain: { sessionId: string; text: string }[] = [];
  const announced: { session: Session; event: SessionActivityEvent }[] = [];
  const working: ReadonlySet<string>[] = [];
  const copy = {
    prepare: vi.fn(async () => ({
      path: COPY,
      branch: "aven/bot/jelly",
      root: PATH,
      gitDir: `${PATH}/.git`,
    })),
    sync: vi.fn(async () => ({
      root: PATH,
      base: BASE,
      uncommitted: false,
      untracked: false,
    })),
    diff: vi.fn(async (): Promise<BotDiff> => NO_DIFF),
    remove: vi.fn(async () => undefined),
  };
  const chat = (): Session => ({
    id: "bot-chat",
    harness: "claude",
    model: "claude:sonnet-5",
    modelSettings: {},
    runtimeMode: "auto",
    title: "Jelly",
    cwd: PATH,
    worktreeCwd: COPY,
    blocks: [],
  });
  const runner = new BotRunner({
    owner: "me",
    now: () => now,
    setTimer: (run, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (id) => void timers.delete(id),
    sessions: () => sessions,
    ensureChat: async () => {
      let found = sessions.find((session) => session.id === "bot-chat");
      if (!found) {
        found = chat();
        sessions = [...sessions, found];
      }
      updateProjectBot(PATH, (bot) => ({ ...bot, sessionId: "bot-chat" }));
      return found;
    },
    newId: () => `turn-${++ids}`,
    sendAsUsual: (sessionId, text) => void plain.push({ sessionId, text }),
    send: (sessionId, text, sendOptions) => {
      const entry: Sent = { sessionId, text, options: sendOptions };
      sent.push(entry);
      // As onSubmit does: the message shows, then its preparation runs.
      if (sendOptions.prepareText)
        void sendOptions.prepareText(text).then((agentText) => {
          entry.agentText = agentText;
        });
      else entry.agentText = text;
      const commit = () => {
        sessions = sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                busy: true,
                blocks: [
                  ...session.blocks,
                  {
                    id: sendOptions.blockId,
                    role: "user",
                    text: sendOptions.displayText,
                    startedAt: now,
                    ...(sendOptions.botWake
                      ? { botWake: sendOptions.botWake }
                      : {}),
                  },
                ],
              }
            : session,
        );
      };
      if (options.lagged) lag.push(commit);
      else commit();
      return true;
    },
    announce: (session, event) => announced.push({ session, event }),
    copy,
    claimEvent: async () => true,
    weeklyUsed: () => 20,
    changedFiles: async () => [
      { path: "src/auth.ts", additions: 12, deletions: 3 },
    ],
    scheduledChats: () => new Set(),
    name: () => "Jelly",
    onWorking: (ids) => working.push(ids),
    activity: () => activity,
    subscribeActivity: (listener) => {
      onActivity = listener;
      return () => {
        onActivity = undefined;
      };
    },
    ...(options.realStops
      ? {}
      : {
          subscribeStops: (listener: (stop: DevServerStop) => void) => {
            onStop = listener;
            return () => {
              onStop = undefined;
            };
          },
        }),
  });
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return {
    runner,
    copy,
    sent,
    plain,
    announced,
    working,
    get sessions() {
      return sessions;
    },
    set sessions(next: Session[]) {
      sessions = next;
    },
    /** Render what was sent. */
    commit() {
      for (const commit of lag.splice(0)) commit();
    },
    async advance(ms: number) {
      now += ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= now)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        due[1].run();
        await flush();
      }
      await flush();
    },
    async finish(chatId: string, entry: Partial<ActivityEntry> = {}) {
      const item: ActivityEntry = {
        id: `${chatId}:turn:${nextId++}:completed`,
        sessionId: chatId,
        outcome: "completed",
        title: "Add sign-up flow",
        summary: "Done.",
        cwd: PATH,
        harness: "claude",
        model: "sonnet",
        createdAt: now,
        readAt: null,
        resolvedAt: null,
        ...entry,
      };
      activity = [item, ...activity];
      onActivity?.();
      await flush();
    },
    stop: (stop: Partial<DevServerStop>) =>
      onStop?.({
        project: PATH,
        cwd: PATH,
        label: "localhost:3000",
        port: 3000,
        sourceId: "terminal:t1",
        output: "Error: boom",
        reason: "exited",
        byUser: false,
        at: now,
        ...stop,
      }),
    /** The bot's turn ends with this reply. */
    async reply(text: string, status: ControlOutcome["status"] = "completed") {
      for (const commit of lag.splice(0)) commit();
      const last = sent.at(-1)!;
      sessions = sessions.map((session) =>
        session.id === last.sessionId
          ? {
              ...session,
              busy: false,
              blocks: [
                ...session.blocks,
                { id: `reply-${sent.length}`, role: "assistant", text },
              ],
            }
          : session,
      );
      last.options.onSettled({ status, text });
      await flush();
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  updateProjectBot(PATH, (bot) => ({
    ...bot,
    on: true,
    copy: { path: COPY, branch: "aven/bot/jelly", root: PATH },
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProjectBotsCache();
});

describe("a project bot waking up", () => {
  it("waits for a burst of finished chats to settle, then wakes once for all of them", async () => {
    const h = harness();
    h.runner.start();
    await h.finish("chat-a", { title: "Add sign-up flow" });
    await h.advance(20_000);
    await h.finish("chat-b", { title: "Fix header" });
    await h.advance(BOT_SETTLE_MS - 1);
    expect(h.sent).toHaveLength(0);
    await h.advance(1);
    expect(h.sent).toHaveLength(1);
    const [wake] = h.sent;
    expect(wake.options.displayText).toBe("2 chats finished");
    expect(wake.options.botWake).toEqual({ label: "2 chats finished" });
    expect(wake.text).toContain("“Add sign-up flow” finished");
    expect(wake.text).toContain("“Fix header” finished");
    expect(wake.text).toContain("src/auth.ts (+12 −3)");
    // First message of the conversation: its role comes first.
    expect(wake.text.startsWith("You are Jelly, Orbit's bot")).toBe(true);
    // Its copy was made sure of and synced before the wake-up went.
    expect(h.copy.sync).toHaveBeenCalledWith(PATH, COPY, "aven/bot/jelly");
    expect(getProjectBot(PATH)?.base).toBe(BASE);
    expect(getProjectBot(PATH)?.runs?.count).toBe(1);
    expect(getProjectBot(PATH)?.job?.owner).toBe("me");
    expect([...h.working.at(-1)!]).toEqual(["bot-chat"]);
    h.runner.stop();
  });

  it("ignores its own chat and chats in other projects", async () => {
    const h = harness();
    h.runner.start();
    updateProjectBot(PATH, (bot) => ({ ...bot, sessionId: "bot-chat" }));
    await h.finish("bot-chat");
    await h.finish("elsewhere", { cwd: "/Users/me/Other" });
    await h.advance(5 * 60_000);
    expect(h.sent).toHaveLength(0);
    h.runner.stop();
  });

  it("collapses a check with nothing to report: no Activity entry, a quiet post", async () => {
    const h = harness();
    h.runner.start();
    await h.finish("chat-a");
    await h.advance(BOT_SETTLE_MS);
    await h.reply("Nothing to report.");
    expect(h.announced).toHaveLength(0);
    const bot = getProjectBot(PATH)!;
    expect(bot.lastPost).toMatchObject({
      text: "Checked · nothing to report",
      quiet: true,
    });
    expect(bot.job).toBeUndefined();
    expect(bot.fixes).toBeUndefined();
    expect([...h.working.at(-1)!]).toEqual([]);
    h.runner.stop();
  });

  it("turns changes in its copy into a waiting fix with one Activity entry", async () => {
    const h = harness();
    h.runner.start();
    await h.finish("chat-a");
    await h.advance(BOT_SETTLE_MS);
    h.copy.diff.mockResolvedValueOnce({
      files: [
        {
          path: "auth.test.ts",
          status: "modified",
          additions: 10,
          deletions: 4,
          binary: false,
        },
        {
          path: "src/user.ts",
          status: "modified",
          additions: 4,
          deletions: 2,
          binary: false,
        },
      ],
      additions: 14,
      deletions: 6,
      hash: "h1",
    });
    await h.reply("Two auth tests broke; I fixed them in my copy.");
    expect(h.copy.diff).toHaveBeenCalledWith(COPY, BASE);
    const fix = getProjectBot(PATH)!.fixes![0];
    expect(fix).toMatchObject({
      state: "ready",
      turnId: "turn-1",
      files: 2,
      additions: 14,
      deletions: 6,
      base: BASE,
      paths: ["auth.test.ts", "src/user.ts"],
    });
    expect(h.announced).toHaveLength(1);
    expect(h.announced[0].event).toMatchObject({
      outcome: "completed",
      summary:
        "Fix ready · 2 files · +14 −6 · Two auth tests broke; I fixed them in my copy.",
    });
    // A second read of the same turn (its chat going idle) changes nothing.
    h.runner.observe(h.sessions);
    await h.advance(1);
    expect(h.announced).toHaveLength(1);
    h.runner.stop();
  });

  it("posts what it found when it found something but changed nothing", async () => {
    const h = harness();
    h.runner.start();
    h.stop({ output: "TypeError: Cannot read properties of undefined" });
    await h.advance(0);
    await h.advance(BOT_SETTLE_MS);
    expect(h.sent[0].options.displayText).toBe("Dev server crashed");
    expect(h.sent[0].text).toContain("TypeError: Cannot read properties");
    await h.reply("The settings page loads before the account does.");
    expect(h.announced[0].event.summary).toBe(
      "The settings page loads before the account does.",
    );
    expect(getProjectBot(PATH)?.lastPost?.text).toBe(
      "The settings page loads before the account does.",
    );
    h.runner.stop();
  });

  it("does not wake for a server you stopped yourself", async () => {
    const h = harness();
    h.runner.start();
    h.stop({ byUser: true });
    await h.advance(0);
    await h.advance(5 * 60_000);
    expect(h.sent).toHaveLength(0);
    h.runner.stop();
  });

  it("drops events during quiet hours and says so", async () => {
    const h = harness();
    h.runner.start();
    updateProjectBot(PATH, (bot) => ({
      ...bot,
      limits: {
        ...bot.limits,
        quiet: { on: true, start: 13 * 60, end: 15 * 60 },
      },
    }));
    await h.finish("chat-a");
    await h.advance(BOT_SETTLE_MS);
    expect(h.sent).toHaveLength(0);
    expect(getProjectBot(PATH)?.lastSkip?.reason).toBe("quiet-hours");
    expect(h.runner.pendingEvents(PATH)).toHaveLength(0);
    h.runner.stop();
  });

  it("holds events while the bot is busy and wakes once its turn ends", async () => {
    const h = harness();
    h.runner.start();
    updateProjectBot(PATH, (bot) => ({ ...bot, sessionId: "bot-chat" }));
    h.sessions = [
      {
        id: "bot-chat",
        harness: "claude",
        model: "m",
        modelSettings: {},
        runtimeMode: "auto",
        title: "Jelly",
        cwd: PATH,
        worktreeCwd: COPY,
        busy: true,
        blocks: [{ id: "you", role: "user", text: "look at this" }],
      },
    ];
    h.runner.observe(h.sessions);
    await h.finish("chat-a");
    await h.advance(BOT_SETTLE_MS);
    expect(h.sent).toHaveLength(0);
    expect(h.runner.pendingEvents(PATH)).toHaveLength(1);
    // Your own turn with the bot ends: it is read, then the event goes.
    h.sessions = h.sessions.map((session) => ({ ...session, busy: false }));
    h.runner.observe(h.sessions);
    await h.advance(10_000);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].options.displayText).toBe(
      "Chat finished · Add sign-up flow",
    );
    h.runner.stop();
  });

  it("holds what happens while a fix waits, and wakes once after you apply it", async () => {
    const h = harness();
    h.runner.start();
    updateProjectBot(PATH, (bot) =>
      withReadyFix(
        { ...bot, base: BASE },
        {
          base: BASE,
          turnId: "old",
          files: 1,
          additions: 1,
          deletions: 0,
          paths: ["a.ts"],
          hash: "waiting",
          at: 1,
        },
      ),
    );
    await h.finish("chat-a");
    await h.advance(BOT_SETTLE_MS);
    await h.finish("chat-b");
    await h.advance(5 * 60_000);
    // Nothing woke it, and its copy (holding the fix) was left alone.
    expect(h.sent).toHaveLength(0);
    expect(h.copy.sync).not.toHaveBeenCalled();
    expect(h.runner.pendingEvents(PATH)).toHaveLength(2);
    const fix = getProjectBot(PATH)!.fixes![0];
    updateProjectBot(PATH, (bot) => resolveFix(bot, fix.id, "applied"));
    await h.advance(60_000);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].options.displayText).toBe("2 chats finished");
    expect(h.copy.sync).toHaveBeenCalledTimes(1);
    h.runner.stop();
  });

  it("moves a waiting fix to a later turn only when its changes changed", async () => {
    const h = harness();
    h.runner.start();
    updateProjectBot(PATH, (bot) => ({ ...bot, sessionId: "bot-chat" }));
    h.sessions = [
      {
        id: "bot-chat",
        harness: "claude",
        model: "m",
        modelSettings: {},
        runtimeMode: "auto",
        title: "Jelly",
        cwd: PATH,
        worktreeCwd: COPY,
        providerSessionId: "sess",
        blocks: [],
      },
    ];
    updateProjectBot(PATH, (bot) =>
      withReadyFix(
        { ...bot, base: BASE },
        {
          base: BASE,
          turnId: "made-it",
          files: 1,
          additions: 1,
          deletions: 0,
          paths: ["a.ts"],
          hash: "first",
          at: 1,
        },
      ),
    );
    const same: BotDiff = {
      files: [
        {
          path: "a.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          binary: false,
        },
      ],
      additions: 1,
      deletions: 0,
      hash: "first",
    };
    // You ask about it; it changes nothing: the card stays on its turn.
    expect(h.runner.message("bot-chat", "Why this change?", [])).toBe(true);
    await h.advance(1);
    h.copy.diff.mockResolvedValueOnce(same);
    await h.reply("Because a.ts rounded up.");
    expect(getProjectBot(PATH)!.fixes![0]).toMatchObject({
      turnId: "made-it",
      hash: "first",
      state: "ready",
    });
    expect(h.announced.map((item) => item.event.summary)).toEqual([
      "Because a.ts rounded up.",
    ]);
    // Same files and line counts, different changes: a new card, here.
    expect(h.runner.message("bot-chat", "Round down instead", [])).toBe(true);
    await h.advance(1);
    h.copy.diff.mockResolvedValueOnce({ ...same, hash: "second" });
    await h.reply("Done, it rounds down now.");
    const fixes = getProjectBot(PATH)!.fixes!;
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({ hash: "second", state: "ready" });
    expect(fixes[0].turnId).not.toBe("made-it");
    expect(h.announced.at(-1)!.event.summary).toBe(
      "Fix ready · 1 file · +1 −0 · Done, it rounds down now.",
    );
    h.runner.stop();
  });

  it("leaves a bot another window is driving alone", async () => {
    const h = harness();
    h.runner.start();
    updateProjectBot(PATH, (bot) => ({
      ...bot,
      job: { owner: "other", since: START, heartbeat: START },
    }));
    await h.finish("chat-a");
    await h.advance(BOT_SETTLE_MS);
    expect(h.sent).toHaveLength(0);
    expect(h.runner.pendingEvents(PATH)).toHaveLength(1);
    h.runner.stop();
  });

  it("sends what you type through its synced copy", async () => {
    const h = harness();
    h.runner.start();
    updateProjectBot(PATH, (bot) => ({ ...bot, sessionId: "bot-chat" }));
    h.sessions = [
      {
        id: "bot-chat",
        harness: "claude",
        model: "m",
        modelSettings: {},
        runtimeMode: "auto",
        title: "Jelly",
        cwd: PATH,
        worktreeCwd: COPY,
        providerSessionId: "sess",
        blocks: [{ id: "earlier", role: "user", text: "hi" }],
      },
    ];
    expect(h.runner.message("bot-chat", "Push your branch", [])).toBe(true);
    // Your message goes at once, before the copy syncs.
    expect(h.sent).toHaveLength(1);
    expect(h.copy.sync).not.toHaveBeenCalled();
    await h.advance(1);
    expect(h.copy.sync).toHaveBeenCalled();
    expect(h.sent[0].options.displayText).toBe("Push your branch");
    expect(h.sent[0].options.botWake).toBeUndefined();
    expect(h.sent[0].agentText).toBe("Push your branch");
    // Not its first message: no role this time.
    expect(h.sent[0].agentText).not.toContain("You are Jelly");
    // A chat that is not a bot's is not the runner's to send.
    expect(h.runner.message("other", "hi", [])).toBe(false);
    h.runner.stop();
  });

  it("forgets jobs an earlier page left and costs nothing once stopped", async () => {
    updateProjectBot(PATH, (bot) => ({
      ...bot,
      job: { owner: "old-page", since: 1, heartbeat: START },
    }));
    const h = harness();
    h.runner.start();
    expect(getProjectBot(PATH)?.job).toBeUndefined();
    h.runner.stop();
    await h.finish("chat-a");
    await h.advance(5 * 60_000);
    expect(h.sent).toHaveLength(0);
  });

  it("is never stuck working when a turn's end goes unreported", async () => {
    const h = harness();
    h.runner.start();
    await h.finish("chat-a");
    await h.advance(BOT_SETTLE_MS);
    expect(getProjectBot(PATH)?.job).toBeDefined();
    // The turn ended (stopped, say) without its usual report.
    h.sessions = h.sessions.map((session) => ({
      ...session,
      busy: false,
      blocks: [
        ...session.blocks,
        { id: "r", role: "assistant", text: "Nothing to report." },
      ],
    }));
    await h.advance(3 * 60_000);
    expect(getProjectBot(PATH)?.job).toBeUndefined();
    expect(getProjectBot(PATH)?.lastPost?.quiet).toBe(true);
    expect(h.announced).toHaveLength(0);
    h.runner.stop();
  });

  it("never offers changes you already applied as a new fix", async () => {
    const h = harness();
    h.runner.start();
    const change: BotDiff = {
      files: [
        {
          path: "a.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          binary: false,
        },
      ],
      additions: 1,
      deletions: 1,
      hash: "h2",
    };
    await h.finish("chat-a");
    await h.advance(BOT_SETTLE_MS);
    h.copy.diff.mockResolvedValueOnce(change);
    await h.reply("Fixed a.ts.");
    const fix = getProjectBot(PATH)!.fixes![0];
    updateProjectBot(PATH, (bot) => ({
      ...bot,
      fixes: bot.fixes!.map((item) => ({ ...item, state: "applied" as const })),
    }));
    // Another turn ends before the copy is synced again.
    await h.finish("chat-b");
    await h.advance(BOT_SETTLE_MS);
    h.copy.sync.mockClear();
    h.copy.diff.mockResolvedValueOnce(change);
    await h.reply("All good now.");
    const fixes = getProjectBot(PATH)!.fixes!;
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({ id: fix.id, state: "applied" });
    expect(h.announced.map((item) => item.event.summary)).toEqual([
      "Fix ready · 1 file · +1 −1 · Fixed a.ts.",
      "All good now.",
    ]);
    h.runner.stop();
  });

  it("wakes when a terminal's dev server crashes, with its last output", async () => {
    resetDevPreviews();
    const h = harness({ realStops: true });
    const terminal = watchTerminalOutput({
      id: "t1",
      project: PATH,
      cwd: PATH,
      placement: "terminal",
    });
    // No bot listening yet: the terminal keeps nothing.
    expect(devServerStopsWatched()).toBe(false);
    h.runner.start();
    expect(devServerStopsWatched()).toBe(true);
    terminal.foreground("node");
    terminal.push("Tip server ready at http://localhost:5199/\n");
    terminal.push(
      "Error: The tip server fell over\n    at Server.<anonymous> (server.js:7:39)\n",
    );
    terminal.foreground(null);
    await h.advance(0);
    await h.advance(BOT_SETTLE_MS);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].options.displayText).toBe("Dev server crashed");
    expect(h.sent[0].text).toContain("(localhost:5199) stopped on its own");
    expect(h.sent[0].text).toContain("Error: The tip server fell over");
    expect(h.sent[0].text).toContain("server.js:7:39");
    h.runner.stop();
    expect(devServerStopsWatched()).toBe(false);
    resetDevPreviews();
  });

  it("knows its own message before the chat renders it", async () => {
    const h = harness({ lagged: true });
    h.runner.start();
    h.sessions = [
      {
        id: "bot-chat",
        harness: "claude",
        model: "m",
        modelSettings: {},
        runtimeMode: "auto",
        title: "Jelly",
        cwd: PATH,
        worktreeCwd: COPY,
        providerSessionId: "sess",
        blocks: [{ id: "old-message", role: "user", text: "earlier" }],
      },
    ];
    updateProjectBot(PATH, (bot) => ({ ...bot, sessionId: "bot-chat" }));
    await h.finish("chat-a");
    await h.advance(BOT_SETTLE_MS);
    expect(h.sent).toHaveLength(1);
    // The chat has not rendered the wake-up yet; the turn ends with a fix.
    h.copy.diff.mockResolvedValueOnce({
      files: [
        {
          path: "a.ts",
          status: "modified",
          additions: 2,
          deletions: 1,
          binary: false,
        },
      ],
      additions: 2,
      deletions: 1,
      hash: "h3",
    });
    await h.reply("Fixed it.");
    expect(getProjectBot(PATH)!.fixes![0].turnId).toBe("turn-1");
    // Its chat going idle reads nothing twice.
    h.runner.observe(h.sessions);
    await h.advance(1);
    expect(h.announced).toHaveLength(1);
    h.runner.stop();
  });

  it("stops a job when the bot is turned off between its steps", async () => {
    const h = harness();
    h.runner.start();
    let release: (value: {
      root: string;
      base: string;
      uncommitted: boolean;
      untracked: boolean;
    }) => void = () => {};
    h.copy.sync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await h.finish("chat-a");
    await h.advance(BOT_SETTLE_MS);
    updateProjectBot(PATH, (bot) => ({ ...bot, on: false }));
    release({
      root: PATH,
      base: "c".repeat(40),
      uncommitted: false,
      untracked: false,
    });
    await h.advance(1);
    expect(h.sent).toHaveLength(0);
    const bot = getProjectBot(PATH)!;
    expect(bot.base).toBeUndefined();
    expect(bot.job).toBeUndefined();
    expect(bot.runs).toBeUndefined();
    h.runner.stop();
  });

  it("removes a copy made while the bot was being turned off, and keeps one a new turn-on owns", async () => {
    const h = harness();
    h.runner.start();
    updateProjectBot(PATH, (bot) => ({ ...bot, onAt: 1 }));
    let made: () => void = () => {};
    h.copy.prepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          made = () =>
            resolve({
              path: COPY,
              branch: "aven/bot/jelly",
              root: PATH,
              gitDir: `${PATH}/.git`,
            });
        }),
    );
    await h.finish("chat-a");
    await h.advance(BOT_SETTLE_MS);
    // Turned off while its copy is being made.
    updateProjectBot(PATH, (bot) => ({ ...bot, on: false, onAt: undefined }));
    made();
    await h.advance(1);
    expect(h.copy.remove).toHaveBeenCalledWith(PATH, COPY, "aven/bot/jelly");
    expect(h.copy.sync).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);

    // Off and on again meanwhile: the new bot keeps its copy.
    h.copy.remove.mockClear();
    updateProjectBot(PATH, (bot) => ({ ...bot, on: true, onAt: 2 }));
    h.copy.prepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          made = () =>
            resolve({
              path: COPY,
              branch: "aven/bot/jelly",
              root: PATH,
              gitDir: `${PATH}/.git`,
            });
        }),
    );
    await h.finish("chat-b");
    await h.advance(BOT_SETTLE_MS);
    updateProjectBot(PATH, (bot) => ({ ...bot, onAt: 3 }));
    made();
    await h.advance(1);
    expect(h.copy.remove).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);
    h.runner.stop();
  });

  it("holds what you type while a wake-up readies the copy, then sends it after", async () => {
    const h = harness();
    h.runner.start();
    updateProjectBot(PATH, (bot) => ({ ...bot, sessionId: "bot-chat" }));
    h.sessions = [
      {
        id: "bot-chat",
        harness: "claude",
        model: "m",
        modelSettings: {},
        runtimeMode: "auto",
        title: "Jelly",
        cwd: PATH,
        worktreeCwd: COPY,
        providerSessionId: "sess",
        blocks: [],
      },
    ];
    let synced: () => void = () => {};
    h.copy.sync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          synced = () =>
            resolve({
              root: PATH,
              base: BASE,
              uncommitted: false,
              untracked: false,
            });
        }),
    );
    await h.finish("chat-a");
    await h.advance(BOT_SETTLE_MS);
    // The copy is being reset: your message waits, nothing runs.
    expect(h.runner.message("bot-chat", "Also check the footer", [])).toBe(
      true,
    );
    expect(h.sent).toHaveLength(0);
    expect(h.plain).toHaveLength(0);
    synced();
    await h.advance(1);
    // The wake-up went first; yours follows it as in any chat.
    expect(h.sent.map((item) => item.options.displayText)).toEqual([
      "Chat finished · Add sign-up flow",
    ]);
    expect(h.plain).toEqual([
      { sessionId: "bot-chat", text: "Also check the footer" },
    ]);
    h.runner.stop();
  });

  it("never wipes changes no one has read: they become the waiting fix", async () => {
    const h = harness();
    h.runner.start();
    updateProjectBot(PATH, (bot) => ({ ...bot, base: BASE }));
    // Its copy holds edits from a turn whose end was never read.
    h.copy.diff.mockResolvedValueOnce({
      files: [
        {
          path: "b.ts",
          status: "modified",
          additions: 3,
          deletions: 0,
          binary: false,
        },
      ],
      additions: 3,
      deletions: 0,
      hash: "h4",
    });
    await h.finish("chat-a");
    await h.advance(BOT_SETTLE_MS);
    expect(h.copy.sync).not.toHaveBeenCalled();
    expect(getProjectBot(PATH)!.fixes![0]).toMatchObject({
      state: "ready",
      files: 1,
      paths: ["b.ts"],
      hash: "h4",
    });
    // It waits for you, with the event, rather than working over it.
    expect(h.sent).toHaveLength(0);
    expect(h.runner.pendingEvents(PATH)).toHaveLength(1);
    h.runner.stop();
  });

  it("counts only wake-ups that went toward the day's runs", async () => {
    const h = harness();
    h.runner.start();
    updateProjectBot(PATH, (bot) => ({ ...bot, sessionId: "bot-chat" }));
    h.sessions = [
      {
        id: "bot-chat",
        harness: "claude",
        model: "m",
        modelSettings: {},
        runtimeMode: "auto",
        title: "Jelly",
        cwd: PATH,
        worktreeCwd: COPY,
        queuedMessages: [{ id: "q", text: "later", attachments: [] }],
        queueStatus: "paused",
        blocks: [],
      },
    ];
    await h.finish("chat-a");
    await h.advance(BOT_SETTLE_MS);
    expect(h.sent).toHaveLength(0);
    expect(getProjectBot(PATH)?.runs).toBeUndefined();
    expect(getProjectBot(PATH)?.job).toBeUndefined();
    h.runner.stop();
  });
});
