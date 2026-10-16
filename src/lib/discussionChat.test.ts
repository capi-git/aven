import { describe, expect, it } from "vitest";
import {
  isDiscussionAside,
  lastStartingChatRelay,
  pendingJumpIns,
  relayVoices,
  startingChatRelay,
} from "./discussionChat";
import {
  DiscussionStore,
  discussionCompanions,
  keptDiscussionChats,
  relayBlockMeta,
  type Discussion,
  type DiscussionParty,
} from "./discussions";
import { discussionVoices } from "./discussionVoices";
import type { Block, DiscussionRelayMeta } from "./session";

const A: DiscussionParty = {
  sessionId: "chat-a",
  harness: "claude",
  model: "Opus 5.5",
  title: "Caching plan",
  cwd: "/work/site",
};
const B: DiscussionParty = {
  sessionId: "chat-b",
  harness: "codex",
  model: "GPT-5.4",
  title: "Review",
  cwd: "/work/site",
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

function relay(turn: number): DiscussionRelayMeta {
  return {
    id: "d1",
    turn,
    rounds: 2,
    partner: {
      harness: B.harness,
      model: B.model,
      title: B.title,
      sessionId: B.sessionId,
    },
    self: { sessionId: A.sessionId, harness: A.harness, model: A.model },
  };
}

/** Turn `turn` of a two-round discussion, its relay sent or not. */
function at(turn: number, delivered: boolean): Discussion {
  const store = new DiscussionStore(memoryStorage(), "main");
  store.start({ id: "d1", a: A, b: B, topic: "Cache?", rounds: 2 });
  for (let settled = 0; settled < turn; settled += 1) {
    store.markDelivered("d1");
    store.settle("d1", settled, { status: "completed", text: `r${settled}` });
  }
  if (delivered) store.markDelivered("d1");
  return store.get("d1")!;
}

describe("a discussion in the chat that started it", () => {
  it("knows its relayed messages from their own marks", () => {
    const toA: Block = {
      id: "u",
      role: "user",
      text: "Cache?",
      discussion: relay(0),
    };
    const toB: Block = { ...toA, discussion: relay(1) };
    expect(startingChatRelay(toA)).toBe(toA.discussion);
    // The other chat shows its relays as before.
    expect(startingChatRelay(toB)).toBeNull();
    expect(startingChatRelay({ id: "x", role: "user", text: "Hi" })).toBeNull();
    expect(startingChatRelay(undefined)).toBeNull();

    const reply: Block = {
      id: "r",
      role: "system",
      text: "Agreed.",
      discussionReply: relay(4),
    };
    const note: Block = {
      id: "n",
      role: "system",
      text: "Discussion ended after 2 rounds.",
      discussionEnd: { id: "d1", settled: 4 },
    };
    expect(isDiscussionAside(reply)).toBe(true);
    expect(isDiscussionAside(note)).toBe(true);
    expect(isDiscussionAside({ ...note, discussionEnd: undefined })).toBe(
      false,
    );
  });

  it("names both sides as the page does, once per message", () => {
    const meta = relay(2);
    const voices = relayVoices(meta, { harness: "claude", model: "" });
    const page = discussionVoices({ a: A, b: B });
    expect(voices.a).toMatchObject({
      name: "Claude · Opus 5.5",
      mascot: page.a.mascot,
      color: page.a.color,
    });
    expect(voices.b).toMatchObject({
      name: "Codex · GPT-5.4",
      mascot: page.b.mascot,
      color: page.b.color,
    });
    expect(relayVoices(meta, { harness: "claude", model: "" })).toBe(voices);
    // A message from before both sides were recorded names this chat's
    // own model.
    const old = { ...meta, self: undefined };
    expect(
      relayVoices(old, { harness: "claude", model: "claude:sonnet-5" }).a.name,
    ).toBe("Claude · Sonnet 5");
  });

  it("counts the relays the starting chat has received", () => {
    expect(lastStartingChatRelay(at(0, false))).toBe(-2);
    expect(lastStartingChatRelay(at(0, true))).toBe(0);
    expect(lastStartingChatRelay(at(1, true))).toBe(0);
    expect(lastStartingChatRelay(at(2, false))).toBe(0);
    expect(lastStartingChatRelay(at(2, true))).toBe(2);
    // Ended after its rounds: the copied-in last reply counts.
    expect(lastStartingChatRelay(at(4, false))).toBe(4);
  });

  it("keeps what the user added at the end until a relay brings it to this chat", () => {
    const store = new DiscussionStore(memoryStorage(), "main", () => 1);
    store.start({ id: "d1", a: A, b: B, topic: "Cache?", rounds: 2 });
    store.markDelivered("d1");
    store.settle("d1", 0, { status: "completed", text: "By URL." });
    store.markDelivered("d1");
    // B answers; the user adds something: it goes to A with B's reply.
    store.interject("d1", "Keep it small.");
    expect(pendingJumpIns(store.get("d1")!)).toEqual([
      { id: expect.any(String), text: "Keep it small.", state: "queued" },
    ]);
    store.settle("d1", 1, { status: "completed", text: "How long?" });
    // The relay to A carries it, so A's transcript now shows it there.
    expect(relayBlockMeta(store.get("d1")!).added).toEqual({
      after: ["Keep it small."],
    });
    store.markDelivered("d1");
    expect(pendingJumpIns(store.get("d1")!)).toEqual([]);
    // Added while A answers: it reaches B first, and A with B's next reply.
    store.interject("d1", "And errors?");
    expect(pendingJumpIns(store.get("d1")!).map((entry) => entry.text)).toEqual(
      ["And errors?"],
    );
    store.stop("d1");
    expect(pendingJumpIns(store.get("d1")!)).toEqual([
      { id: expect.any(String), text: "And errors?", state: "unsent" },
    ]);
  });
});

describe("keeping a discussion's chats loaded", () => {
  it("keeps both chats while it runs, is paused or owes a closing note, then lets go", () => {
    const store = new DiscussionStore(memoryStorage(), "main");
    store.start({ id: "d1", a: A, b: B, topic: "Cache?", rounds: 1 });
    expect(keptDiscussionChats(store.snapshot(), "main")).toEqual([
      "chat-a",
      "chat-b",
    ]);
    store.pause("d1", "Waiting");
    expect(keptDiscussionChats(store.snapshot(), "main")).toHaveLength(2);
    store.resume("d1");
    store.markDelivered("d1");
    store.settle("d1", 0, { status: "completed", text: "A" });
    store.markDelivered("d1");
    store.settle("d1", 1, { status: "completed", text: "B" });
    // Ended: kept until both closing notes are posted.
    expect(store.get("d1")?.status).toBe("ended");
    expect(keptDiscussionChats(store.snapshot(), "main")).toHaveLength(2);
    store.notePosted("d1", "a");
    expect(keptDiscussionChats(store.snapshot(), "main")).toHaveLength(2);
    store.notePosted("d1", "b");
    expect(keptDiscussionChats(store.snapshot(), "main")).toEqual([]);
  });

  it("keeps only this window's real discussions", () => {
    const storage = memoryStorage();
    new DiscussionStore(storage, "other").start({
      id: "theirs",
      a: { ...A, sessionId: "x" },
      b: { ...B, sessionId: "y" },
      topic: "T",
      rounds: 1,
    });
    const store = new DiscussionStore(storage, "main");
    store.start({
      id: "preview",
      a: A,
      b: B,
      topic: "T",
      rounds: 1,
      preview: true,
    });
    expect(keptDiscussionChats(store.snapshot(), "main")).toEqual([]);
  });

  it("still keeps them after a reload, paused", () => {
    const storage = memoryStorage();
    new DiscussionStore(storage, "main").start({
      id: "d1",
      a: A,
      b: B,
      topic: "Cache?",
      rounds: 2,
    });
    const reloaded = new DiscussionStore(storage, "main");
    expect(reloaded.get("d1")?.status).toBe("paused");
    expect(keptDiscussionChats(reloaded.snapshot(), "main")).toEqual([
      "chat-a",
      "chat-b",
    ]);
  });

  it("pairs the starting chat with its partner while kept", () => {
    const store = new DiscussionStore(memoryStorage(), "main");
    store.start({ id: "d1", a: A, b: B, topic: "Cache?", rounds: 1 });
    expect([...discussionCompanions(store.snapshot())]).toEqual([
      ["chat-a", ["chat-b"]],
    ]);
    store.stop("d1");
    store.notePosted("d1", "a");
    store.notePosted("d1", "b");
    expect(discussionCompanions(store.snapshot()).size).toBe(0);
  });
});
