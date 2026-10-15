import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendUser } from "./harness/apply";
import {
  capRelay,
  createDiscussion,
  discussionEndNote,
  discussionReply,
  DiscussionStore,
  DISCUSSIONS_KEY,
  discussionRound,
  planDiscussions,
  readDiscussion,
  relayBlockMeta,
  relayPrompt,
  RELOAD_REASON,
  settleDiscussion,
  sidebarDiscussions,
  sidebarTalks,
  speakingSide,
  type Discussion,
  type DiscussionParty,
} from "./discussions";
import { newSession, type Block, type Session } from "./session";

const A: DiscussionParty = {
  sessionId: "chat-a",
  harness: "claude",
  model: "Opus",
  title: "Caching plan",
  cwd: "/work/site",
};
const B: DiscussionParty = {
  sessionId: "chat-b",
  harness: "codex",
  model: "GPT-5",
  title: "Review",
  cwd: "/work/api",
};

function fresh(rounds = 3): Discussion {
  return createDiscussion({
    id: "d1",
    owner: "main",
    a: A,
    b: B,
    topic: "Should we cache the lookups?",
    rounds,
    now: 1,
  });
}

function reply(discussion: Discussion, text: string): Discussion {
  return settleDiscussion(discussion, { status: "completed", text }, 2);
}

function chat(id: string, patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", "/work/site"), id, ...patch };
}

function memoryStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("relay rules", () => {
  it("opens with the topic for A, framed with who B is", () => {
    const discussion = fresh();
    expect(speakingSide(discussion)).toBe("a");
    expect(discussion.relay).toBe("Should we cache the lookups?");
    const prompt = relayPrompt(discussion);
    expect(prompt).toContain(
      "discuss a topic with another agent: GPT-5 (Codex) in the chat “Review”",
    );
    expect(prompt).toContain("lasts 3 rounds");
    expect(prompt).toContain("Topic: Should we cache the lookups?");
    expect(relayBlockMeta(discussion)).toEqual({
      id: "d1",
      turn: 0,
      rounds: 3,
      partner: {
        harness: "codex",
        model: "GPT-5",
        title: "Review",
        cwd: "/work/api",
      },
    });
  });

  it("alternates A and B, counting a round as one reply from each", () => {
    let discussion = fresh(2);
    const order: string[] = [];
    const rounds: number[] = [];
    while (discussion.status !== "ended") {
      order.push(speakingSide(discussion));
      rounds.push(discussionRound(discussion));
      discussion = reply(discussion, `reply ${order.length}`);
    }
    expect(order).toEqual(["a", "b", "a", "b"]);
    expect(rounds).toEqual([1, 1, 2, 2]);
    expect(discussion.ended).toEqual({ kind: "completed" });
    expect(discussion.notes).toEqual(["a", "b"]);
    expect(discussionEndNote(discussion)).toBe(
      "Discussion ended after 2 rounds.",
    );
  });

  it("frames B's first message and labels every relayed reply", () => {
    const toB = reply(fresh(), "Yes, with a short TTL.");
    expect(speakingSide(toB)).toBe("b");
    const first = relayPrompt(toB);
    expect(first).toContain(
      "another agent: Opus (Claude Code) in the chat “Caching plan”",
    );
    expect(first).toContain("Topic: Should we cache the lookups?");
    expect(first).toContain(
      "Opus in “Caching plan” says:\n\nYes, with a short TTL.",
    );
    expect(first).toContain("(Round 1 of 3.)");
    expect(relayBlockMeta(toB).partner.title).toBe("Caching plan");

    const toA = reply(toB, "Agreed, but invalidate on writes.");
    const second = relayPrompt(toA);
    expect(second).not.toContain("would like you to discuss");
    expect(second).toContain(
      "GPT-5 in “Review” says:\n\nAgreed, but invalidate on writes.",
    );
    expect(second).toContain("(Round 2 of 3.)");
  });

  it("tells each agent when it is giving its last reply", () => {
    let discussion = fresh(1);
    discussion = reply(discussion, "Opening thoughts");
    expect(relayPrompt(discussion)).toContain(
      "This is your last reply in this discussion.",
    );
  });

  it("caps long replies, notes the truncation and marks the block", () => {
    const long = `${"word ".repeat(2_000)}tail`;
    const capped = capRelay(long, 100);
    expect(capped.truncated).toBe(true);
    expect(capped.text.length).toBeLessThanOrEqual(101);
    expect(capped.text.endsWith("…")).toBe(true);

    const discussion = reply(fresh(), "x".repeat(9_000));
    expect(discussion.truncated).toBe(true);
    expect(discussion.relay.length).toBeLessThanOrEqual(8_001);
    expect(relayPrompt(discussion)).toContain(
      "[Aven shortened this message to 8,000 characters.]",
    );
    expect(relayBlockMeta(discussion).truncated).toBe(true);
    expect(reply(discussion, "short").truncated).toBeUndefined();
  });

  it("ends on an error or a stopped turn, naming the chat", () => {
    const failed = settleDiscussion(
      reply(fresh(), "first"),
      { status: "failed", text: "" },
      3,
    );
    expect(failed.status).toBe("ended");
    expect(failed.ended).toEqual({ kind: "failed", side: "b" });
    expect(discussionEndNote(failed)).toBe(
      "Discussion ended: “Review” ran into an error.",
    );
    const cancelled = settleDiscussion(
      fresh(),
      { status: "cancelled", text: "partial" },
      3,
    );
    expect(discussionEndNote(cancelled)).toBe(
      "Discussion ended: “Caching plan” was stopped.",
    );
  });

  it("pauses when a turn leaves nothing to relay", () => {
    const paused = reply(fresh(), "   ");
    expect(paused.status).toBe("paused");
    expect(paused.settled).toBe(0);
    expect(paused.reason).toContain("“Caching plan” finished without a reply");
  });

  it("says how far a stopped discussion got", () => {
    const store = new DiscussionStore(memoryStorage(), "main");
    store.start({ id: "d1", a: A, b: B, topic: "t", rounds: 3 });
    store.stop("d1");
    expect(discussionEndNote(store.get("d1")!)).toBe(
      "Discussion stopped during round 1 of 3.",
    );
    let later = reply(reply(reply(fresh(), "1"), "2"), "3");
    later = { ...later, status: "ended", ended: { kind: "stopped" } };
    expect(discussionEndNote(later)).toBe(
      "Discussion stopped after 1 round of 3.",
    );
  });
});

describe("reading replies from the transcript", () => {
  const relay = (turn: number, extra: Partial<Block> = {}): Block => ({
    id: `relay-${turn}`,
    role: "user",
    text: "relayed",
    startedAt: 1,
    discussion: relayBlockMeta({ ...fresh(), settled: turn }),
    ...extra,
  });

  it("takes the last assistant text of the relayed turn", () => {
    const blocks: Block[] = [
      { id: "u0", role: "user", text: "earlier", startedAt: 0 },
      { id: "x0", role: "assistant", text: "earlier answer" },
      relay(2),
      { id: "x1", role: "assistant", text: "Thinking out loud" },
      { id: "t1", role: "tool", text: "" },
      { id: "steer", role: "user", text: "also consider costs" },
      { id: "x2", role: "assistant", text: "Final answer" },
      { id: "u3", role: "user", text: "unrelated", startedAt: 5 },
      { id: "x3", role: "assistant", text: "Unrelated answer" },
    ];
    expect(discussionReply(blocks, "d1", 2)).toBe("Final answer");
    expect(discussionReply(blocks, "d1", 4)).toBeNull();
    expect(discussionReply([relay(2)], "d1", 2)).toBe("");
  });

  it("adds the relay card to the user block", () => {
    const meta = relayBlockMeta(fresh());
    const session = appendUser(chat("chat-a"), "topic", [], {
      discussion: meta,
    });
    expect(session.blocks.at(-1)?.discussion).toEqual(meta);
  });
});

describe("planning the broker's work", () => {
  const idle = () => [chat("chat-a"), chat("chat-b")];

  it("delivers to the speaking chat only from the owning window", () => {
    const discussion = fresh();
    expect(planDiscussions([discussion], "main", idle(), new Set())).toEqual([
      { kind: "deliver", id: "d1", sessionId: "chat-a" },
    ]);
    expect(planDiscussions([discussion], "other", idle(), new Set())).toEqual(
      [],
    );
    expect(
      planDiscussions(
        [{ ...discussion, preview: true }],
        "main",
        idle(),
        new Set(),
      ),
    ).toEqual([]);
  });

  it("pauses on an approval or question in either chat", () => {
    const approval = chat("chat-b", {
      busy: true,
      blocks: [
        {
          id: "ap",
          role: "approval",
          text: "Run tests?",
          approval: { requestId: 1 },
        },
      ],
    });
    expect(
      planDiscussions([fresh()], "main", [chat("chat-a"), approval], new Set()),
    ).toEqual([
      { kind: "pause", id: "d1", reason: "“Review” needs your approval." },
    ]);
    const question = chat("chat-a", {
      pendingQuestion: {
        requestId: 2,
        questions: [],
      } as unknown as Session["pendingQuestion"],
    });
    expect(
      planDiscussions([fresh()], "main", [question, chat("chat-b")], new Set()),
    ).toEqual([
      {
        kind: "pause",
        id: "d1",
        reason: "“Caching plan” has a question for you.",
      },
    ]);
  });

  it("pauses instead of joining a busy chat or the user's queue", () => {
    const busy = [chat("chat-a", { busy: true }), chat("chat-b")];
    expect(planDiscussions([fresh()], "main", busy, new Set())).toEqual([
      {
        kind: "pause",
        id: "d1",
        reason: "“Caching plan” is busy with another turn.",
      },
    ]);
    const queued = [
      chat("chat-a", {
        queuedMessages: [{ id: "q", text: "mine", attachments: [] }],
      }),
      chat("chat-b"),
    ];
    expect(planDiscussions([fresh()], "main", queued, new Set())[0]).toEqual({
      kind: "pause",
      id: "d1",
      reason: "“Caching plan” has your messages queued.",
    });
  });

  it("pauses when a chat is no longer open here", () => {
    expect(
      planDiscussions([fresh()], "main", [chat("chat-a")], new Set()),
    ).toEqual([
      {
        kind: "pause",
        id: "d1",
        reason: "“Review” isn't open in this window. Open it to continue.",
      },
    ]);
  });

  it("waits for its own turn, and recovers one lost to a reload", () => {
    const sent = { ...fresh(), delivered: true };
    const working = [chat("chat-a", { busy: true }), chat("chat-b")];
    expect(planDiscussions([sent], "main", working, new Set(["d1"]))).toEqual(
      [],
    );
    const answered = chat("chat-a", {
      blocks: [
        {
          id: "r",
          role: "user",
          text: "topic",
          startedAt: 1,
          discussion: relayBlockMeta(fresh()),
        },
        { id: "x", role: "assistant", text: "My view" },
      ],
    });
    expect(
      planDiscussions([sent], "main", [answered, chat("chat-b")], new Set()),
    ).toEqual([{ kind: "recover", id: "d1", turn: 0, reply: "My view" }]);
    expect(planDiscussions([sent], "main", idle(), new Set())).toEqual([
      { kind: "redeliver", id: "d1" },
    ]);
  });

  it("posts closing notes once each chat is idle", () => {
    const ended = {
      ...reply(reply(fresh(1), "one"), "two"),
    };
    expect(ended.status).toBe("ended");
    const sessions = [chat("chat-a", { busy: true })];
    expect(planDiscussions([ended], "main", sessions, new Set())).toEqual([
      {
        kind: "note",
        id: "d1",
        side: "b",
        text: "Discussion ended after 1 round.",
      },
    ]);
  });
});

describe("DiscussionStore", () => {
  it("persists under aven.discussions and shows a reload as paused", () => {
    const storage = memoryStorage();
    const store = new DiscussionStore(storage, "main", () => 5);
    store.start({ id: "d1", a: A, b: B, topic: "Topic", rounds: 4 });
    const saved = JSON.parse(storage.values.get(DISCUSSIONS_KEY)!);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: "d1", status: "active", rounds: 4 });

    const reloaded = new DiscussionStore(storage, "main", () => 6);
    expect(reloaded.get("d1")).toMatchObject({
      status: "paused",
      reason: RELOAD_REASON,
    });
    expect(JSON.parse(storage.values.get(DISCUSSIONS_KEY)!)[0].status).toBe(
      "paused",
    );
  });

  it("leaves another window's discussions to that window", () => {
    const storage = memoryStorage();
    const theirs = new DiscussionStore(storage, "other");
    theirs.start({ id: "d1", a: A, b: B, topic: "Topic", rounds: 3 });
    const mine = new DiscussionStore(storage, "main");
    // Another window's active discussion is not paused by this one loading.
    expect(mine.get("d1")?.status).toBe("active");
    mine.pause("d1", "nope");
    mine.stop("d1");
    expect(mine.get("d1")?.status).toBe("active");

    mine.start({
      id: "d2",
      a: { ...A, sessionId: "c" },
      b: { ...B, sessionId: "d" },
      topic: "Other",
      rounds: 2,
    });
    const stored = JSON.parse(storage.values.get(DISCUSSIONS_KEY)!);
    expect(stored.map((entry: Discussion) => entry.id).sort()).toEqual([
      "d1",
      "d2",
    ]);

    theirs.pause("d1", "Waiting");
    mine.sync();
    expect(mine.get("d1")?.status).toBe("paused");
    expect(mine.get("d2")?.status).toBe("active");
  });

  it("refuses a chat that is already discussing", () => {
    const store = new DiscussionStore(memoryStorage(), "main");
    store.start({ a: A, b: B, topic: "Topic", rounds: 3 });
    expect(() =>
      store.start({
        a: { ...A, sessionId: "x" },
        b: B,
        topic: "Again",
        rounds: 3,
      }),
    ).toThrow("“Review” is already in a discussion.");
    expect(() =>
      store.start({ a: A, b: A, topic: "Self", rounds: 3 }),
    ).toThrow();
  });

  it("settles only the turn it is waiting for, and clears after the notes", () => {
    const store = new DiscussionStore(memoryStorage(), "main");
    store.start({ id: "d1", a: A, b: B, topic: "Topic", rounds: 1 });
    store.markDelivered("d1");
    store.settle("d1", 1, { status: "completed", text: "stale" });
    expect(store.get("d1")?.settled).toBe(0);
    store.settle("d1", 0, { status: "completed", text: "A says" });
    expect(store.get("d1")).toMatchObject({ settled: 1, delivered: false });
    store.settle("d1", 1, { status: "completed", text: "B says" });
    expect(store.get("d1")?.status).toBe("ended");
    store.notePosted("d1", "a");
    expect(store.get("d1")?.notes).toEqual(["b"]);
    store.notePosted("d1", "b");
    expect(store.get("d1")).toBeUndefined();
  });

  it("keeps a development preview out of storage", () => {
    const storage = memoryStorage();
    const store = new DiscussionStore(storage, "main");
    store.start({
      id: "p",
      a: A,
      b: B,
      topic: "Look",
      rounds: 3,
      preview: true,
    });
    expect(storage.values.has(DISCUSSIONS_KEY)).toBe(false);
    store.flipPreviews();
    expect(speakingSide(store.get("p")!)).toBe("b");
    store.stop("p");
    expect(store.get("p")).toBeUndefined();
  });

  it("ignores storage that is not a discussion list", () => {
    const storage = memoryStorage({ [DISCUSSIONS_KEY]: "{not json" });
    expect(new DiscussionStore(storage, "main").snapshot()).toEqual([]);
    expect(readDiscussion({ id: "d1" })).toBeNull();
    expect(
      readDiscussion({ ...fresh(), a: { ...A, harness: "nobody" } }),
    ).toBeNull();
    expect(readDiscussion(JSON.parse(JSON.stringify(fresh())))).toEqual(
      fresh(),
    );
  });
});

describe("sidebar data", () => {
  it("names both rows, who is answering, and leaves out ended ones", () => {
    const talking = reply(fresh(), "first");
    const ended = { ...fresh(), id: "d2", status: "ended" as const };
    const data = sidebarDiscussions([talking, ended]);
    expect(data).toEqual([
      {
        id: "d1",
        a: { sessionId: "chat-a", title: "Caching plan" },
        b: { sessionId: "chat-b", title: "Review" },
        speaking: "b",
        paused: false,
      },
    ]);
    const talks = sidebarTalks(data);
    expect(talks.get("chat-a")).toEqual({
      id: "d1",
      partnerId: "chat-b",
      partnerTitle: "Review",
      speaking: false,
      paused: false,
    });
    expect(talks.get("chat-b")?.speaking).toBe(true);
  });
});
