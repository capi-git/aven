// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOT_JOB_STALE_MS,
  PROJECT_BOTS_KEY,
  botBranch,
  botChatInCopy,
  botForChat,
  botHeadline,
  botName,
  botPauseReason,
  botStatus,
  botWakeDecision,
  claimBotJob,
  defaultBotName,
  fixForTurn,
  formatClockMinutes,
  getProjectBot,
  inQuietHours,
  isBotChat,
  isBotCopyPath,
  localDay,
  newProjectBot,
  pendingFix,
  readProjectBot,
  releaseBotJob,
  resetProjectBotsCache,
  resolveFix,
  runsToday,
  skipKeepsEvents,
  subscribeProjectBots,
  updateProjectBot,
  withReadyFix,
  withRunCounted,
  type ProjectBot,
} from "./projectBots";

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

/** Local time on 2026-10-23 at `hour:minute`. */
function at(hour: number, minute = 0, day = 23): number {
  return new Date(2026, 9, day, hour, minute).getTime();
}

function onBot(patch: Partial<ProjectBot> = {}): ProjectBot {
  return { ...newProjectBot(PATH, 1), on: true, ...patch };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProjectBotsCache();
});

describe("project bot settings", () => {
  it("is off, watching chats and the dev server and allowed to fix, by default", () => {
    const bot = newProjectBot(`${PATH}/`, 5);
    expect(bot).toMatchObject({
      path: PATH,
      on: false,
      wakes: { chatFinished: true, devServer: true },
      can: { fix: true },
      limits: {
        runsPerDay: 15,
        pauseAtPercent: 80,
        quiet: { on: true, start: 23 * 60, end: 8 * 60 },
      },
    });
  });

  it("reads stored bots tolerantly: fills defaults, clamps numbers and drops junk", () => {
    const bot = readProjectBot({
      path: PATH,
      on: true,
      name: "  Jelly  ",
      wakes: { chatFinished: false, github: true },
      can: { fix: false, browser: false },
      limits: { runsPerDay: 9999, pauseAtPercent: 1, quiet: { start: -5 } },
      fixes: [
        { id: "f", base: "b", turnId: "t", state: "ready", files: 2 },
        { id: "bad", state: "exploded" },
      ],
      lastSkip: { at: 1, reason: "nonsense" },
      job: { owner: "w", since: 1, heartbeat: 2 },
    })!;
    expect(bot.on).toBe(true);
    expect(bot.name).toBe("Jelly");
    expect(bot.wakes).toEqual({ chatFinished: false, devServer: true });
    expect(bot.can).toEqual({ fix: false });
    expect(bot.limits.runsPerDay).toBe(200);
    expect(bot.limits.pauseAtPercent).toBe(10);
    expect(bot.limits.quiet).toEqual({ on: true, start: 0, end: 8 * 60 });
    expect(bot.fixes?.map((fix) => fix.id)).toEqual(["f"]);
    expect(bot.lastSkip).toBeUndefined();
    expect(bot.job).toEqual({ owner: "w", since: 1, heartbeat: 2 });
    expect(readProjectBot({ on: true })).toBeNull();
    expect(readProjectBot("nope")).toBeNull();
  });

  it("saves to its own key, ignores a broken store, and tells listeners", () => {
    localStorage.setItem(PROJECT_BOTS_KEY, "{not json");
    expect(getProjectBot(PATH)).toBeUndefined();
    const heard = vi.fn();
    const stop = subscribeProjectBots(heard);
    updateProjectBot(PATH, (bot) => ({ ...bot, on: true, name: "Jelly" }));
    expect(heard).toHaveBeenCalledTimes(1);
    const raw = JSON.parse(localStorage.getItem(PROJECT_BOTS_KEY)!);
    expect(raw.version).toBe(1);
    expect(raw.bots[PATH]).toMatchObject({ on: true, name: "Jelly" });
    // Another build's write is read back through the same rules.
    resetProjectBotsCache();
    expect(getProjectBot(`${PATH}/`)?.name).toBe("Jelly");
    // No change writes nothing, and a missing bot is never made by a no-op.
    updateProjectBot(PATH, (bot) => bot);
    updateProjectBot("/elsewhere", (bot) => bot);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(getProjectBot("/elsewhere")).toBeUndefined();
    stop();
  });

  it("keeps a bot of another scope, like a later all-projects bot, as it was", () => {
    const overview = {
      scope: "all",
      on: true,
      name: "Scout",
      projects: ["/work/a", "/work/b"],
    };
    localStorage.setItem(
      PROJECT_BOTS_KEY,
      JSON.stringify({ version: 1, bots: { "all-projects": overview } }),
    );
    resetProjectBotsCache();
    // It is not a project's bot, so nothing here runs or shows it.
    expect(getProjectBot("all-projects")).toBeUndefined();
    updateProjectBot(PATH, (bot) => ({ ...bot, on: true }));
    const raw = JSON.parse(localStorage.getItem(PROJECT_BOTS_KEY)!);
    expect(raw.bots["all-projects"]).toEqual(overview);
    expect(raw.bots[PATH]).toMatchObject({ scope: "project", on: true });
  });

  it("finds a bot by its chat and its copy, only while it is on", () => {
    updateProjectBot(PATH, (bot) => ({
      ...bot,
      on: true,
      sessionId: "chat-1",
      copy: {
        path: "/data/bots/orbit-1",
        branch: "aven/bot/jelly",
        root: PATH,
      },
    }));
    expect(botForChat("chat-1")?.path).toBe(PATH);
    expect(isBotChat("chat-1")).toBe(true);
    expect(isBotChat("chat-2")).toBe(false);
    expect(isBotCopyPath("/data/bots/orbit-1/src/a.ts")).toBe(true);
    expect(isBotCopyPath(PATH)).toBe(false);
    updateProjectBot(PATH, (bot) => ({ ...bot, on: false }));
    expect(isBotChat("chat-1")).toBe(false);
  });

  it("names a bot after its critter unless you named it", () => {
    const fallback = defaultBotName(PATH);
    expect(fallback).toMatch(/^[A-Z][a-z]+$/);
    expect(defaultBotName(PATH, "jelly")).toBe("Jelly");
    expect(defaultBotName(PATH, "fox")).toBe("Fox");
    expect(botName({ path: PATH }, "owl")).toBe("Owl");
    expect(botName({ path: PATH, name: "Sam" }, "owl")).toBe("Sam");
    expect(botBranch("Jelly", PATH)).toMatch(/^aven\/bot\/jelly-[0-9a-f]{4}$/);
    expect(botBranch("  Mr. Bot 2! ", PATH)).toMatch(
      /^aven\/bot\/mr-bot-2-[0-9a-f]{4}$/,
    );
    expect(botBranch("🦊", PATH)).toMatch(/^aven\/bot\/bot-[0-9a-f]{4}$/);
    // Two projects in one repository never share a branch.
    expect(botBranch("Jelly", `${PATH}/web`)).not.toBe(
      botBranch("Jelly", PATH),
    );
    expect(botBranch("Jelly", `${PATH}/`)).toBe(botBranch("Jelly", PATH));
  });
});

describe("a bot's chat works only in its copy", () => {
  const copy = "/data/bots/orbit-1a2b";
  const chat = {
    id: "bot-chat",
    harness: "claude",
    model: "claude:claude-sonnet-5",
    modelSettings: { effort: "high" },
    runtimeMode: "auto",
    worktreeCwd: copy,
    providerSessionId: "sess_1",
  };
  const claude = () => "claude:claude-opus-5";

  it("leaves a chat that is already right alone", () => {
    expect(botChatInCopy(chat, copy, claude)).toBeNull();
  });

  it("puts a chat that would run in your folder into the copy, as a new conversation", () => {
    // Turned on while it was an ordinary chat in the project folder.
    const fix = botChatInCopy(
      { ...chat, worktreeCwd: undefined, runtimeMode: "full-access" },
      copy,
      claude,
    )!;
    expect(fix.restart).toBe(true);
    expect(fix.chat).toMatchObject({
      worktreeCwd: copy,
      runtimeMode: "auto",
      providerSessionId: undefined,
      model: "claude:claude-sonnet-5",
    });
  });

  it("moves a chat on another agent to Claude, and a Full access chat back to auto", () => {
    const codex = botChatInCopy(
      { ...chat, harness: "codex", model: "codex:gpt-6" },
      copy,
      claude,
    )!;
    expect(codex.chat).toMatchObject({
      harness: "claude",
      model: "claude:claude-opus-5",
      modelSettings: {},
    });
    const full = botChatInCopy(
      { ...chat, runtimeMode: "full-access" },
      copy,
      claude,
    )!;
    expect(full).toEqual({
      chat: { ...chat, runtimeMode: "auto" },
      restart: false,
    });
  });
});

describe("when a bot may wake", () => {
  const decide = (
    bot: ProjectBot,
    now: number,
    extra: Partial<Parameters<typeof botWakeDecision>[0]> = {},
  ) =>
    botWakeDecision({
      bot,
      kinds: ["chatFinished"],
      now,
      weeklyUsed: 10,
      busy: false,
      owner: "me",
      ...extra,
    });

  it("runs for the kinds it watches", () => {
    expect(decide(onBot(), at(14))).toEqual({
      run: true,
      kinds: ["chatFinished"],
    });
    expect(
      decide(
        onBot({ wakes: { chatFinished: false, devServer: true } }),
        at(14),
        {
          kinds: ["chatFinished", "devServer"],
        },
      ),
    ).toEqual({ run: true, kinds: ["devServer"] });
    expect(
      decide(
        onBot({ wakes: { chatFinished: false, devServer: true } }),
        at(14),
      ),
    ).toEqual({ skip: "kind-off" });
    expect(decide({ ...onBot(), on: false }, at(14))).toEqual({ skip: "off" });
    expect(decide(onBot({ paused: true }), at(14))).toEqual({
      skip: "paused",
    });
  });

  it("keeps quiet hours that run past midnight", () => {
    const quiet = { on: true, start: 23 * 60, end: 8 * 60 };
    expect(inQuietHours(quiet, at(22, 59))).toBe(false);
    expect(inQuietHours(quiet, at(23, 0))).toBe(true);
    expect(inQuietHours(quiet, at(0, 30))).toBe(true);
    expect(inQuietHours(quiet, at(7, 59))).toBe(true);
    expect(inQuietHours(quiet, at(8, 0))).toBe(false);
    // Daytime quiet hours, and turned off or empty ones.
    expect(
      inQuietHours({ on: true, start: 12 * 60, end: 13 * 60 }, at(12, 30)),
    ).toBe(true);
    expect(
      inQuietHours({ on: true, start: 12 * 60, end: 13 * 60 }, at(13, 30)),
    ).toBe(false);
    expect(inQuietHours({ ...quiet, on: false }, at(2))).toBe(false);
    expect(inQuietHours({ on: true, start: 60, end: 60 }, at(1))).toBe(false);
    expect(decide(onBot(), at(2))).toEqual({ skip: "quiet-hours" });
  });

  it("counts runs per local day, starting again at local midnight", () => {
    let bot = onBot({ limits: { ...onBot().limits, runsPerDay: 2 } });
    bot = withRunCounted(bot, at(9));
    bot = withRunCounted(bot, at(21));
    expect(runsToday(bot, at(22))).toBe(2);
    expect(decide(bot, at(22))).toEqual({ skip: "daily-cap" });
    // Just after midnight it is a new day.
    expect(localDay(at(0, 1, 24))).toBe("2026-10-24");
    expect(runsToday(bot, at(8, 30, 24))).toBe(0);
    expect(decide(bot, at(8, 30, 24))).toMatchObject({ run: true });
    expect(withRunCounted(bot, at(9, 0, 24)).runs).toEqual({
      day: "2026-10-24",
      count: 1,
    });
  });

  it("pauses while the weekly usage is at its limit", () => {
    expect(decide(onBot(), at(14), { weeklyUsed: 79 })).toMatchObject({
      run: true,
    });
    expect(decide(onBot(), at(14), { weeklyUsed: 80 })).toEqual({
      skip: "usage",
    });
    expect(decide(onBot(), at(14), { weeklyUsed: null })).toMatchObject({
      run: true,
    });
  });

  it("holds events while it is busy here or leased by another window", () => {
    expect(decide(onBot(), at(14), { busy: true })).toEqual({ skip: "busy" });
    const leased = onBot({
      job: { owner: "other", since: at(14), heartbeat: at(14) },
    });
    expect(decide(leased, at(14, 1))).toEqual({ skip: "leased" });
    // A lease nobody renews is over.
    expect(decide(leased, at(14) + BOT_JOB_STALE_MS + 1)).toMatchObject({
      run: true,
    });
    expect(skipKeepsEvents("busy")).toBe(true);
    expect(skipKeepsEvents("leased")).toBe(true);
    expect(skipKeepsEvents("quiet-hours")).toBe(false);
    expect(skipKeepsEvents("daily-cap")).toBe(false);
  });

  it("lets one window at a time claim a bot's job", () => {
    updateProjectBot(PATH, (bot) => ({ ...bot, on: true }));
    expect(claimBotJob(PATH, "a", at(14))).toBe(true);
    expect(claimBotJob(PATH, "b", at(14, 1))).toBe(false);
    expect(claimBotJob(PATH, "a", at(14, 1))).toBe(true);
    releaseBotJob(PATH, "b");
    expect(getProjectBot(PATH)?.job?.owner).toBe("a");
    releaseBotJob(PATH, "a");
    expect(getProjectBot(PATH)?.job).toBeUndefined();
    expect(claimBotJob(PATH, "b", at(14, 2))).toBe(true);
    // A bot that is off is never claimed.
    expect(claimBotJob("/off", "a", at(14))).toBe(false);
  });
});

describe("fixes and the bot's word", () => {
  const fix = {
    base: "b".repeat(40),
    turnId: "turn-1",
    files: 2,
    additions: 14,
    deletions: 6,
    paths: ["a.ts", "b.ts"],
    at: 5,
  };

  it("keeps one waiting fix, moved to the newest turn as it grows", () => {
    let bot = withReadyFix(onBot(), fix);
    const id = pendingFix(bot)!.id;
    bot = withReadyFix(bot, { ...fix, turnId: "turn-2", files: 3 });
    expect(bot.fixes).toHaveLength(1);
    expect(pendingFix(bot)).toMatchObject({ id, turnId: "turn-2", files: 3 });
    expect(fixForTurn(bot, "turn-1")).toBeUndefined();
    bot = resolveFix(bot, id, "applied", 9);
    expect(pendingFix(bot)).toBeUndefined();
    expect(fixForTurn(bot, "turn-2")).toMatchObject({
      state: "applied",
      resolvedAt: 9,
    });
    // A later fix is a new one; the applied card stays as it was.
    bot = withReadyFix(bot, { ...fix, turnId: "turn-3" });
    expect(bot.fixes?.map((item) => item.state)).toEqual(["applied", "ready"]);
  });

  it("says what it is doing in one of five words", () => {
    const idle = { busy: false, needsInput: false };
    expect(botStatus(onBot(), idle, 1)).toBe("watching");
    expect(botStatus(onBot(), { ...idle, busy: true }, 1)).toBe("working");
    expect(
      botStatus(
        onBot({ job: { owner: "x", since: 1, heartbeat: 1 } }),
        undefined,
        2,
      ),
    ).toBe("working");
    expect(botStatus(withReadyFix(onBot(), fix), idle, 1)).toBe("fix-ready");
    expect(
      botStatus(
        withReadyFix(onBot(), fix),
        { busy: true, needsInput: true },
        1,
      ),
    ).toBe("needs-you");
    expect(botStatus(onBot({ paused: true }), idle, 1)).toBe("paused");
    expect(botHeadline(withReadyFix(onBot(), fix), "fix-ready")).toBe(
      "Fix ready: 2 files",
    );
    expect(
      botHeadline(
        onBot({ lastPost: { at: 1, text: "Tests pass again." } }),
        "watching",
      ),
    ).toBe("Tests pass again.");
    expect(
      botHeadline(
        onBot({ lastPost: { at: 1, text: "Checked", quiet: true } }),
        "watching",
      ),
    ).toBe("Watching");
  });

  it("never reads Watching while something keeps it from looking, and says why", () => {
    const idle = { busy: false, needsInput: false };
    const now = new Date(2026, 9, 23, 15, 0).getTime();
    const capped = onBot({
      lastSkip: { at: now - 60_000, reason: "daily-cap" },
    });
    expect(botStatus(capped, idle, now)).toBe("paused");
    expect(botPauseReason(capped, now)).toBe(
      "Resting until tomorrow: 15 checks today",
    );
    // A new day: it looks again.
    expect(botStatus(capped, idle, now + 24 * 3600_000)).toBe("watching");
    const resting = onBot({ lastSkip: { at: now, reason: "usage" } });
    expect(botHeadline(resting, botStatus(resting, idle, now), now)).toBe(
      "Paused while Claude is over 80% for the week",
    );
    const broken = onBot({
      lastError: {
        at: now,
        text: "Couldn't make its copy: Bots need a Git project with at least one commit.",
      },
    });
    expect(botStatus(broken, idle, now)).toBe("paused");
    expect(botPauseReason(broken, now)).toMatch(/^Couldn't make its copy/);
    // Quiet hours are expected, not a pause.
    expect(
      botStatus(
        onBot({ lastSkip: { at: now, reason: "quiet-hours" } }),
        idle,
        now,
      ),
    ).toBe("watching");
    expect(botPauseReason(onBot({ paused: true }), now)).toBe("Paused");
  });

  it("writes clock times plainly", () => {
    expect(formatClockMinutes(23 * 60)).toBe("11 pm");
    expect(formatClockMinutes(8 * 60)).toBe("8 am");
    expect(formatClockMinutes(0)).toBe("12 am");
    expect(formatClockMinutes(12 * 60 + 30)).toBe("12:30 pm");
  });
});
