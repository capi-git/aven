import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "./activity";
import {
  BOT_FRESH_MS,
  botBrief,
  buildDirectMessage,
  buildWakeMessage,
  coalesceEvents,
  isNothingToReport,
  lastLines,
  replyHeadline,
  wakeLabel,
  wakesFromActivity,
  type BotChatFinished,
  type BotDevServerStopped,
} from "./projectBotWake";

const PATH = "/Users/me/Orbit";
const NOW = 1_000_000;
const bot = {
  path: PATH,
  sessionId: "bot-chat",
  copy: { path: "/data/bots/orbit-1", branch: "aven/bot/jelly", root: PATH },
};
const context = {
  now: NOW,
  botChats: new Set(["bot-chat", "other-bot"]),
  scheduledChats: new Set(["nightly"]),
};

function entry(patch: Partial<ActivityEntry> = {}): ActivityEntry {
  const sessionId = patch.sessionId ?? "chat";
  return {
    id: `${sessionId}:turn:abc:completed`,
    sessionId,
    outcome: "completed",
    title: "Add sign-up flow",
    summary: "Added the sign-up form.",
    cwd: PATH,
    harness: "claude",
    model: "sonnet",
    createdAt: NOW - 1000,
    readAt: null,
    resolvedAt: null,
    ...patch,
  };
}

function finished(patch: Partial<BotChatFinished> = {}): BotChatFinished {
  return {
    kind: "chatFinished",
    id: "e1",
    at: NOW,
    sessionId: "chat",
    title: "Add sign-up flow",
    outcome: "completed",
    ...patch,
  };
}

function crashed(
  patch: Partial<BotDevServerStopped> = {},
): BotDevServerStopped {
  return {
    kind: "devServer",
    id: "s1",
    at: NOW,
    label: "localhost:3000",
    output: "TypeError: boom\n    at x.ts:1",
    ...patch,
  };
}

describe("what wakes a bot", () => {
  it("wakes for a chat in its project finishing or failing", () => {
    expect(wakesFromActivity(entry(), bot, context)).toBe(true);
    expect(
      wakesFromActivity(
        entry({ outcome: "failed", id: "chat:turn:abc:failed" }),
        bot,
        context,
      ),
    ).toBe(true);
    expect(wakesFromActivity(entry({ cwd: `${PATH}/web` }), bot, context)).toBe(
      true,
    );
    // A run of agents finishing is news too.
    expect(
      wakesFromActivity(
        entry({
          id: "lead:run:p:finished:1",
          sessionId: "lead",
          team: { id: "orchestrate:lead", kind: "orchestrate" },
        }),
        bot,
        context,
      ),
    ).toBe(true);
  });

  it("never wakes for itself, another bot, a team member, a notice or a scheduled run", () => {
    const no = (patch: Partial<ActivityEntry>) =>
      expect(wakesFromActivity(entry(patch), bot, context)).toBe(false);
    no({ sessionId: "bot-chat" });
    no({ sessionId: "other-bot" });
    no({ sessionId: "nightly" });
    no({ team: { id: "race:r", kind: "race", member: true } });
    no({ team: { id: "discuss:d", kind: "discuss" } });
    no({ team: { id: "race:r", kind: "race" } });
    no({
      team: { id: "orchestrate:lead", kind: "orchestrate", need: true },
      outcome: "failed",
    });
    no({ id: "chat:ship:1" });
    no({ outcome: "approval" });
    no({ outcome: "stopped" });
    no({ cwd: "/Users/me/Other" });
    no({ cwd: "/data/bots/orbit-1" });
    no({ createdAt: NOW - BOT_FRESH_MS - 1 });
  });

  it("holds each thing once, newest first replacing an older one of the same", () => {
    let pending = coalesceEvents([], finished());
    pending = coalesceEvents(pending, finished());
    expect(pending).toHaveLength(1);
    pending = coalesceEvents(pending, finished({ id: "e2", title: "Again" }));
    expect(pending.map((event) => event.id)).toEqual(["e2"]);
    pending = coalesceEvents(
      pending,
      finished({ id: "e3", sessionId: "chat-b" }),
    );
    pending = coalesceEvents(pending, crashed());
    pending = coalesceEvents(pending, crashed({ id: "s2" }));
    expect(pending.map((event) => event.id)).toEqual(["e2", "e3", "s2"]);
    for (let i = 0; i < 12; i++)
      pending = coalesceEvents(
        pending,
        finished({ id: `x${i}`, sessionId: `c${i}` }),
      );
    expect(pending).toHaveLength(8);
    expect(pending.at(-1)?.id).toBe("x11");
  });
});

describe("what the bot is told", () => {
  it("tags a wake-up in a few words", () => {
    expect(wakeLabel([finished()])).toBe("Chat finished · Add sign-up flow");
    expect(wakeLabel([finished({ outcome: "failed" })])).toBe(
      "Chat stopped · Add sign-up flow",
    );
    expect(wakeLabel([crashed()])).toBe("Dev server crashed");
    expect(wakeLabel([finished(), finished({ id: "2", sessionId: "b" })])).toBe(
      "2 chats finished",
    );
    expect(wakeLabel([finished(), crashed()])).toBe(
      "Chat finished · Add sign-up flow · Dev server crashed",
    );
    expect(wakeLabel([finished({ title: "  " })])).toBe(
      "Chat finished · Untitled chat",
    );
  });

  it("says what changed, what the tests did and that the copy was synced", () => {
    const text = buildWakeMessage({
      events: [
        finished({
          files: [{ path: "src/auth.ts", additions: 12, deletions: 3 }],
          tests: {
            command: "npm test",
            status: "failed",
            passed: 46,
            failed: 2,
          },
        }),
        crashed(),
      ],
      sync: {
        kind: "synced",
        base: "abcdef1234567890",
        uncommitted: true,
        untracked: true,
      },
      canFix: true,
    });
    expect(text).toContain("“Add sign-up flow” finished");
    expect(text).toContain("src/auth.ts (+12 −3)");
    expect(text).toContain("`npm test` failed (2 failed, 46 passed)");
    expect(text).toContain("dev server (localhost:3000) stopped on its own");
    expect(text).toContain("TypeError: boom");
    expect(text).toContain(
      "commit abcdef1234, including their uncommitted changes",
    );
    expect(text).toContain("not in your copy");
    expect(text).toContain('reply exactly "Nothing to report."');
    // Tests known not to have run are said so; unknown says nothing.
    expect(
      buildWakeMessage({
        events: [finished({ tests: null, files: [] })],
        sync: null,
        canFix: true,
      }),
    ).toContain("didn't run any tests");
    expect(
      buildWakeMessage({ events: [finished()], sync: null, canFix: true }),
    ).not.toContain("tests");
  });

  it("tells it not to start another fix while one waits", () => {
    const text = buildWakeMessage({
      events: [finished()],
      sync: { kind: "fix-waiting" },
      canFix: true,
    });
    expect(text).toContain("don't start another fix");
    const noFix = buildWakeMessage({
      events: [finished()],
      sync: { kind: "failed", error: "git broke" },
      canFix: false,
    });
    expect(noFix).toContain("couldn't update your copy (git broke)");
    expect(noFix).toContain("without changing files");
  });

  it("briefs it once on who it is, where it works and what it never does alone", () => {
    const brief = botBrief({
      name: "Jelly",
      project: PATH,
      copyPath: "/data/bots/orbit-1",
      can: { fix: true },
    });
    expect(brief).toContain("You are Jelly, Orbit's bot");
    expect(brief).toContain("own copy of the project at /data/bots/orbit-1");
    expect(brief).toContain(`never in the user's folder (${PATH})`);
    expect(brief).toContain('"Nothing to report."');
    expect(brief).toMatch(
      /Never push, open or merge pull requests, commit, deploy, publish/,
    );
    expect(
      botBrief({
        name: "J",
        project: PATH,
        copyPath: "/c",
        can: { fix: false },
      }),
    ).toContain("Don't change files");
    const wake = buildWakeMessage({
      events: [finished()],
      sync: null,
      canFix: true,
      brief,
    });
    expect(wake.startsWith(brief)).toBe(true);
    expect(
      buildDirectMessage({
        text: "Push your branch",
        sync: {
          kind: "synced",
          base: "1".repeat(40),
          uncommitted: false,
          untracked: false,
        },
      }),
    ).toBe(
      "Note from Aven: Aven synced your copy to the user's current files (commit 1111111111).\n\nPush your branch",
    );
    expect(buildDirectMessage({ text: "Hi", sync: null })).toBe("Hi");
  });

  it("knows its quiet reply, and a reply's first line", () => {
    for (const reply of [
      "Nothing to report.",
      "nothing to report",
      "**Nothing to report.**",
      " Nothing to report! ",
      "“Nothing to report.”",
    ])
      expect(isNothingToReport(reply)).toBe(true);
    expect(isNothingToReport("Nothing to report, but tests are slow.")).toBe(
      false,
    );
    expect(isNothingToReport("")).toBe(false);
    expect(
      replyHeadline("**Fixed** the test.\n\nDetails here.\n```ts\nx\n```"),
    ).toBe("Fixed the test.");
    expect(replyHeadline("a".repeat(200), 20)).toHaveLength(20);
    expect(lastLines("1\n2\n3\n\n", 2)).toBe("2\n3");
  });
});
