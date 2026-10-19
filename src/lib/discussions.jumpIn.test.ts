import { describe, expect, it } from "vitest";
import {
  continuationRelay,
  createDiscussion,
  DiscussionStore,
  DISCUSSION_ROUNDS_LIMIT,
  DISCUSSIONS_KEY,
  endDiscussion,
  INTERJECTION_CHAR_LIMIT,
  INTERJECTION_LIMIT,
  interjectDiscussion,
  jumpInPlan,
  pauseDiscussion,
  finalReplyMeta,
  readDiscussion,
  relayBlockMeta,
  relayDisplayText,
  relayInterjections,
  relayPrompt,
  settleDiscussion,
  unseenFinalReply,
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

function fresh(rounds = 2): Discussion {
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

/** The speaking chat was sent its turn and answered. */
function answer(discussion: Discussion, text: string): Discussion {
  return settleDiscussion(
    { ...discussion, delivered: true },
    { status: "completed", text },
    2,
  );
}

let ids = 0;
function add(discussion: Discussion, text: string): Discussion {
  ids += 1;
  return interjectDiscussion(discussion, { id: `u${ids}`, text, now: 10 });
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("jumping in", () => {
  it("while a turn runs: waits for the next relay, then reaches both chats once", () => {
    // A answered; B is answering turn 1 now.
    const running = { ...answer(fresh(2), "Cache by URL."), delivered: true };
    expect(jumpInPlan(running)).toEqual({ kind: "queue", turn: 2, rounds: 2 });
    const added = add(running, "Keep it under 50 lines.");
    // The turn under way is left alone.
    expect(added).toMatchObject({
      status: "active",
      delivered: true,
      settled: 1,
      rounds: 2,
    });
    expect(added.interjections).toEqual([
      {
        id: expect.any(String),
        text: "Keep it under 50 lines.",
        turn: 2,
        at: 10,
      },
    ]);
    expect(relayPrompt(added)).not.toContain("The user adds");

    // Turn 2 goes to A: B's reply first, then what the user added since.
    const toA = answer(added, "Agreed, with a TTL.");
    const promptA = relayPrompt(toA);
    expect(promptA.indexOf("GPT-5 in “Review” says:")).toBeLessThan(
      promptA.indexOf("The user adds: Keep it under 50 lines."),
    );
    expect(promptA.indexOf("The user adds:")).toBeLessThan(
      promptA.indexOf("(Round 2 of 2."),
    );
    // The chat that started it shows the reply alone, and the user's
    // message as their own, after it.
    expect(relayDisplayText(toA)).toBe("Agreed, with a TTL.");
    expect(relayBlockMeta(toA).added).toEqual({
      after: ["Keep it under 50 lines."],
    });

    // Turn 3 goes to B, which A answered having seen it: the user's message
    // comes first this time.
    const toB = answer(toA, "Fine, 30 seconds.");
    const promptB = relayPrompt(toB);
    expect(
      promptB.indexOf("The user adds: Keep it under 50 lines."),
    ).toBeLessThan(promptB.indexOf("Opus in “Caching plan” says:"));
    expect(relayDisplayText(toB)).toBe(
      "You added: Keep it under 50 lines.\n\nFine, 30 seconds.",
    );
    expect(relayBlockMeta(toB).added).toBeUndefined();
    expect(relayInterjections(toB, 4)).toEqual({ carried: [], fresh: [] });
  });

  it("before the relay is sent: goes with it", () => {
    const due = answer(fresh(2), "Cache by URL.");
    expect(due.delivered).toBe(false);
    const added = add(due, "Mind the locale.");
    expect(added.interjections?.[0].turn).toBe(1);
    expect(relayPrompt(added)).toContain("The user adds: Mind the locale.");
  });

  it("keeps several messages in order and puts multi-line ones on their own lines", () => {
    let running = { ...fresh(2), delivered: true };
    running = add(running, "First.");
    running = add(running, "Second\nwith detail.");
    const next = answer(running, "My take.");
    const prompt = relayPrompt(next);
    expect(prompt.indexOf("The user adds: First.")).toBeLessThan(
      prompt.indexOf("The user adds:\n\nSecond\nwith detail."),
    );
  });

  it("while paused: resumes with the message", () => {
    const due = answer(fresh(2), "Cache by URL.");
    const paused = pauseDiscussion(due, "“Review” is busy.", 3, "chat-b");
    expect(jumpInPlan(paused)).toEqual({ kind: "resume", turn: 1, rounds: 2 });
    const resumed = add(paused, "Go on without the flag.");
    expect(resumed.status).toBe("active");
    expect(resumed.reason).toBeUndefined();
    expect(resumed.blockedBy).toBeUndefined();
    expect(relayPrompt(resumed)).toContain(
      "The user adds: Go on without the flag.",
    );
  });

  it("during the last reply: adds one more round so both chats still see it", () => {
    let discussion = answer(fresh(1), "Cache by URL.");
    discussion = { ...discussion, delivered: true };
    expect(jumpInPlan(discussion)).toEqual({
      kind: "extend",
      turn: 2,
      rounds: 2,
    });
    discussion = add(discussion, "One more thing: logging.");
    expect(discussion.rounds).toBe(2);
    // B's reply no longer ends it: A answers the user next.
    discussion = answer(discussion, "Agreed.");
    expect(discussion.status).toBe("active");
    expect(relayPrompt(discussion)).toContain(
      "The user adds: One more thing: logging.",
    );
  });

  it("after it ended: continues for one more round from the user's message", () => {
    const ended = answer(answer(fresh(1), "Cache by URL."), "Agreed.");
    expect(ended).toMatchObject({
      status: "ended",
      settled: 2,
      summary: { status: "pending" },
    });
    expect(jumpInPlan(ended)).toEqual({
      kind: "continue",
      turn: 2,
      rounds: 2,
    });
    const continued = add(ended, "Now consider eviction.");
    expect(continued).toMatchObject({
      status: "active",
      rounds: 2,
      settled: 2,
      delivered: false,
      relay: "",
    });
    expect(continued.ended).toBeUndefined();
    expect(continued.notes).toBeUndefined();
    expect(continued.summary).toBeUndefined();
    // A gets the user's message even when B's last reply can't be read.
    const prompt = relayPrompt(continued);
    expect(prompt).toContain("The user adds: Now consider eviction.");
    expect(prompt).not.toContain("says:");
    expect(prompt).toContain("(Round 2 of 2.");
  });

  it("after a stop mid-round: finishes that round, then one more, and sends what never went", () => {
    // A answered turn 0; B was stopped while answering turn 1, with a
    // message waiting for turn 2.
    let discussion = { ...answer(fresh(3), "Cache by URL."), delivered: true };
    discussion = add(discussion, "Waited.");
    const stopped = endDiscussion(discussion, { kind: "stopped" }, 5);
    expect(stopped.summary).toBeUndefined();
    expect(jumpInPlan(stopped)).toEqual({
      kind: "continue",
      turn: 1,
      rounds: 2,
    });
    const continued = add(stopped, "And now?");
    expect(continued.rounds).toBe(2);
    expect(continued.interjections?.map((entry) => entry.turn)).toEqual([1, 1]);
    const prompt = relayPrompt({ ...continued, relay: "Cache by URL." });
    expect(prompt.indexOf("The user adds: Waited.")).toBeLessThan(
      prompt.indexOf("The user adds: And now?"),
    );
  });

  it("after a stop before any reply: passes the topic again", () => {
    const stopped = endDiscussion(fresh(2), { kind: "stopped" }, 5);
    const continued = add(stopped, "Start with reads.");
    expect(continued).toMatchObject({
      rounds: 1,
      settled: 0,
      relay: "Should we cache the lookups?",
    });
    expect(relayPrompt(continued)).toContain(
      "Topic: Should we cache the lookups?\n\nThe user adds: Start with reads.",
    );
    expect(relayDisplayText(continued)).toBe("Should we cache the lookups?");
    expect(relayBlockMeta(continued).added).toEqual({
      after: ["Start with reads."],
    });
  });

  it("refuses previews, more than the limit and more rounds than allowed", () => {
    expect(jumpInPlan({ ...fresh(), preview: true }).kind).toBe("blocked");
    let full = { ...fresh(2), delivered: true };
    for (let index = 0; index < INTERJECTION_LIMIT; index += 1)
      full = add(full, `Note ${index}`);
    expect(jumpInPlan(full)).toMatchObject({ kind: "blocked" });
    expect(add(full, "One too many")).toBe(full);
    const longest = {
      ...fresh(2),
      rounds: DISCUSSION_ROUNDS_LIMIT,
      settled: DISCUSSION_ROUNDS_LIMIT * 2,
      status: "ended" as const,
    };
    expect(jumpInPlan(longest)).toMatchObject({ kind: "blocked" });
    expect(add({ ...fresh(2), delivered: true }, "   ").interjections).toBe(
      undefined,
    );
  });

  it("keeps a message short", () => {
    const added = add(fresh(2), "x".repeat(INTERJECTION_CHAR_LIMIT + 500));
    expect(added.interjections?.[0].text.length).toBeLessThanOrEqual(
      INTERJECTION_CHAR_LIMIT + 1,
    );
  });
});

describe("continuationRelay", () => {
  function transcript(turn: number, reply: string): Block[] {
    return [
      {
        id: `relay-${turn}`,
        role: "user",
        text: "relayed",
        startedAt: turn,
        discussion: {
          id: "d1",
          turn,
          rounds: 1,
          partner: { harness: "claude", model: "Opus", title: "Caching plan" },
        },
      },
      { id: `reply-${turn}`, role: "assistant", text: reply },
    ];
  }
  const chat = (id: string, blocks: Block[]): Session => ({
    ...newSession("claude", "/work/site"),
    id,
    blocks,
  });

  it("reads the last reply back from the chat that wrote it", () => {
    const ended = answer(answer(fresh(1), "Cache by URL."), "Agreed.");
    const continued = add(ended, "Eviction?");
    expect(
      continuationRelay(continued, [chat("chat-b", transcript(1, "Agreed."))]),
    ).toEqual({ text: "Agreed.", truncated: false });
    expect(continuationRelay(continued, [])).toBeNull();
    expect(
      continuationRelay(continued, [chat("chat-b", transcript(0, "Old"))]),
    ).toEqual({ text: "", truncated: false });
  });
});

describe("unseenFinalReply", () => {
  const chat = (id: string, blocks: Block[]): Session => ({
    ...newSession("claude", "/work/site"),
    id,
    blocks,
  });
  /** B's chat: the relay it answered at turn 1, then its reply. */
  const partner = (reply: string) =>
    chat("chat-b", [
      {
        id: "relay-1",
        role: "user",
        text: "relayed",
        startedAt: 1,
        discussion: relayBlockMeta(answer(fresh(2), "Cache by URL.")),
      },
      { id: "reply-1", role: "assistant", text: reply },
    ]);

  it("finds B's last reply, which the starting chat never got", () => {
    const ended = answer(answer(fresh(1), "Cache by URL."), "Agreed.");
    expect(ended.status).toBe("ended");
    // Copied into the starting chat when it ended, shown only.
    const starter = chat("chat-a", [
      {
        id: "copy",
        role: "system",
        text: "Agreed.",
        discussionReply: finalReplyMeta(ended, false, 3),
      },
    ]);
    expect(unseenFinalReply(ended, [starter])).toEqual({
      text: "Agreed.",
      shown: true,
    });
    // Without the copy, read from B's chat when it is open here.
    expect(
      unseenFinalReply(ended, [chat("chat-a", []), partner("Agreed.")]),
    ).toEqual({ text: "Agreed.", shown: false });
    expect(unseenFinalReply(ended, [chat("chat-a", [])])).toBeNull();
  });

  it("finds one stopped before it was passed on, and nothing A already has", () => {
    const answered = answer(answer(fresh(2), "Cache by URL."), "Agreed.");
    const stopped = endDiscussion(answered, { kind: "stopped" }, 5);
    expect(unseenFinalReply(stopped, [partner("Agreed.")])).toEqual({
      text: "Agreed.",
      shown: false,
    });
    const passedOn = endDiscussion(
      { ...answered, delivered: true },
      { kind: "stopped" },
      5,
    );
    expect(unseenFinalReply(passedOn, [partner("Agreed.")])).toBeNull();
    // A spoke last: B has nothing A hasn't seen.
    const afterA = endDiscussion(
      answer(fresh(2), "Cache by URL."),
      { kind: "stopped" },
      5,
    );
    expect(unseenFinalReply(afterA, [partner("Agreed.")])).toBeNull();
  });
});

describe("DiscussionStore jumping in", () => {
  it("adds, persists and reloads the user's messages and a longer discussion", () => {
    const storage = memoryStorage();
    const store = new DiscussionStore(storage, "main", () => 7);
    store.start({ id: "d1", a: A, b: B, topic: "Topic", rounds: 6 });
    store.markDelivered("d1");
    expect(store.interject("d1", "  ")).toBe("Write something to add.");
    expect(store.interject("d1", "Mind the locale.")).toBeNull();
    expect(store.interject("gone", "Hello")).toBe(
      "This discussion is no longer available.",
    );
    const saved = JSON.parse(storage.values.get(DISCUSSIONS_KEY)!)[0];
    expect(saved.interjections).toEqual([
      { id: expect.any(String), text: "Mind the locale.", turn: 1, at: 7 },
    ]);

    // Six rounds, continued to seven, survive a reload.
    const long = readDiscussion({ ...saved, rounds: 7, settled: 13 });
    expect(long?.rounds).toBe(7);
    expect(long?.interjections).toHaveLength(1);
    // Broken entries are dropped, and only the limit is kept.
    const messy = readDiscussion({
      ...saved,
      interjections: [
        ...Array.from({ length: INTERJECTION_LIMIT + 2 }, (_, index) => ({
          id: `ok-${index}`,
          text: "fine",
          turn: 1,
          at: 1,
        })),
        { id: "bad", text: "", turn: 1 },
        { id: "bad-turn", text: "x", turn: 99 },
        "nonsense",
      ],
    });
    expect(messy?.interjections).toHaveLength(INTERJECTION_LIMIT);
    expect(
      messy?.interjections?.every((entry) => entry.id.startsWith("ok-")),
    ).toBe(true);
    expect(
      readDiscussion({
        ...saved,
        interjections: [{ id: "x", text: "y".repeat(5_000), turn: 1 }],
      })?.interjections,
    ).toBeUndefined();
  });

  it("resumes a paused one and adopts it from another window", () => {
    const storage = memoryStorage();
    const other = new DiscussionStore(storage, "other");
    other.start({ id: "d1", a: A, b: B, topic: "Topic", rounds: 2 });
    other.pause("d1", "Paused for a test.");
    const here = new DiscussionStore(storage, "main");
    expect(here.interject("d1", "Carry on.")).toBeNull();
    expect(here.get("d1")).toMatchObject({ owner: "main", status: "active" });
  });

  it("continues an ended one and keeps the reply it reads back", () => {
    const store = new DiscussionStore(memoryStorage(), "main");
    store.start({ id: "d1", a: A, b: B, topic: "Topic", rounds: 1 });
    store.markDelivered("d1");
    store.settle("d1", 0, { status: "completed", text: "A" });
    store.markDelivered("d1");
    store.settle("d1", 1, { status: "completed", text: "B" });
    store.notePosted("d1", "a");
    store.notePosted("d1", "b");
    expect(store.interject("d1", "One more?")).toBeNull();
    expect(store.get("d1")).toMatchObject({
      status: "active",
      rounds: 2,
      relay: "",
    });
    store.recoverRelay("d1", { text: "B", truncated: false });
    expect(store.get("d1")?.relay).toBe("B");
    expect(store.forSession(A.sessionId)?.id).toBe("d1");
  });
});
