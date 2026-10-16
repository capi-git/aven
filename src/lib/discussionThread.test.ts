import { describe, expect, it } from "vitest";
import {
  buildDiscussionThread,
  isLongReply,
  lastReplyKeys,
  typingSide,
  type DiscussionThreadItem,
} from "./discussionThread";
import {
  createDiscussion,
  endDiscussion,
  pauseDiscussion,
  settleDiscussion,
  type Discussion,
  type DiscussionParty,
} from "./discussions";
import type { Block } from "./session";

const A: DiscussionParty = {
  sessionId: "chat-a",
  harness: "claude",
  model: "Claude Sonnet 5",
  title: "Caching plan",
  cwd: "/work/site",
};
const B: DiscussionParty = {
  sessionId: "chat-b",
  harness: "codex",
  model: "GPT-5",
  title: "Review",
  cwd: "/work/site",
};

function start(rounds = 2): Discussion {
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

/** Both transcripts as the broker leaves them: each relay, then the reply. */
function transcripts(replies: string[], rounds = 2) {
  const a: Block[] = [];
  const b: Block[] = [];
  replies.forEach((reply, turn) => {
    const target = turn % 2 === 0 ? a : b;
    target.push(
      {
        id: `relay-${turn}`,
        role: "user",
        text: turn === 0 ? "Should we cache the lookups?" : replies[turn - 1],
        startedAt: turn,
        discussion: {
          id: "d1",
          turn,
          rounds,
          partner: { harness: "codex", model: "GPT-5", title: "Review" },
        },
      },
      // A note mid-turn, then the final reply the broker relays.
      { id: `note-${turn}`, role: "assistant", text: "Looking…" },
      { id: `tool-${turn}`, role: "tool", text: "" },
      { id: `reply-${turn}`, role: "assistant", text: `${reply}\n` },
    );
  });
  return { a, b };
}

function settle(discussion: Discussion, replies: string[]): Discussion {
  return replies.reduce(
    (current, text) =>
      settleDiscussion(current, { status: "completed", text }, 2),
    discussion,
  );
}

const shape = (items: readonly DiscussionThreadItem[]) =>
  items.map((item) =>
    item.kind === "reply"
      ? `${item.side}:${item.text}`
      : item.kind === "round"
        ? `round ${item.round}/${item.rounds}`
        : item.kind === "closing"
          ? `closing:${item.text}`
          : `topic:${item.text}`,
  );

describe("buildDiscussionThread", () => {
  it("opens with the topic and the first round while A answers", () => {
    const discussion = start();
    expect(shape(buildDiscussionThread(discussion, transcripts([])))).toEqual([
      "topic:Should we cache the lookups?",
      "round 1/2",
    ]);
    expect(typingSide(discussion)).toBe("a");
  });

  it("alternates sides in reply order with a divider for each round", () => {
    const replies = ["Yes, briefly.", "For how long?", "Five minutes."];
    const discussion = settle(start(), replies);
    const thread = buildDiscussionThread(discussion, transcripts(replies));
    expect(shape(thread)).toEqual([
      "topic:Should we cache the lookups?",
      "round 1/2",
      "a:Yes, briefly.",
      "b:For how long?",
      "round 2/2",
      "a:Five minutes.",
    ]);
    expect(typingSide(discussion)).toBe("b");
    expect(thread.map((item) => item.key)).toEqual([
      "topic",
      "round-1",
      "turn-0",
      "turn-1",
      "round-2",
      "turn-2",
    ]);
  });

  it("ends with the closing note both chats received", () => {
    const replies = ["One", "Two", "Three", "Four"];
    const discussion = settle(start(), replies);
    expect(discussion.status).toBe("ended");
    const thread = buildDiscussionThread(discussion, transcripts(replies));
    expect(shape(thread).slice(-3)).toEqual([
      "a:Three",
      "b:Four",
      "closing:Discussion ended after 2 rounds.",
    ]);
    expect(thread.at(-1)).toMatchObject({ completed: true });
    expect(typingSide(discussion)).toBeNull();
    expect([...lastReplyKeys(thread)]).toEqual(["turn-2", "turn-3"]);
  });

  it("shows a stopped discussion's note without an empty round", () => {
    const replies = ["One", "Two"];
    const discussion = endDiscussion(
      settle(start(3), replies),
      { kind: "stopped" },
      3,
    );
    const thread = buildDiscussionThread(discussion, transcripts(replies, 3));
    expect(shape(thread)).toEqual([
      "topic:Should we cache the lookups?",
      "round 1/3",
      "a:One",
      "b:Two",
      "closing:Discussion stopped after 1 round of 3.",
    ]);
    expect(thread.at(-1)).toMatchObject({ completed: false });
  });

  it("keeps the round in progress while paused, with nobody typing", () => {
    const replies = ["One", "Two"];
    const discussion = pauseDiscussion(
      settle(start(3), replies),
      "“Caching plan” needs your approval.",
      3,
    );
    expect(
      shape(buildDiscussionThread(discussion, transcripts(replies, 3))),
    ).toEqual([
      "topic:Should we cache the lookups?",
      "round 1/3",
      "a:One",
      "b:Two",
      "round 2/3",
    ]);
    expect(typingSide(discussion)).toBeNull();
  });

  it("marks a reply it cannot read when that chat is not open here", () => {
    const replies = ["One", "Two"];
    const discussion = settle(start(), replies);
    const { a } = transcripts(replies);
    const thread = buildDiscussionThread(discussion, { a });
    expect(thread.find((item) => item.key === "turn-1")).toMatchObject({
      side: "b",
      text: null,
    });
    expect(thread.find((item) => item.key === "turn-0")).toMatchObject({
      text: "One",
    });
  });

  it("stays the same object while the answering side streams", () => {
    const replies = ["Yes, briefly."];
    const discussion = settle(start(), replies);
    const first = transcripts(replies);
    const thread = buildDiscussionThread(discussion, first);
    // B starts streaming its reply: a new transcript, the same thread.
    const streaming = {
      a: first.a,
      b: [
        ...first.b,
        {
          id: "relay-1",
          role: "user" as const,
          text: "Yes, briefly.",
          startedAt: 1,
          discussion: {
            id: "d1",
            turn: 1,
            rounds: 2,
            partner: { harness: "claude" as const, model: "", title: "" },
          },
        },
        {
          id: "live",
          role: "assistant" as const,
          text: "For how",
          streaming: true,
        },
      ],
    };
    expect(buildDiscussionThread(discussion, streaming, thread)).toBe(thread);
    // B's reply settles: only the new items are new objects.
    const next = settle(discussion, ["For how long?"]);
    const settled = buildDiscussionThread(
      next,
      transcripts([...replies, "For how long?"]),
      thread,
    );
    expect(settled).not.toBe(thread);
    expect(settled.slice(0, thread.length)).toEqual(thread);
    thread.forEach((item, index) => expect(settled[index]).toBe(item));
    expect(shape(settled).slice(-2)).toEqual(["b:For how long?", "round 2/2"]);
  });
});

it("shows a development preview's topic with only the typing side", () => {
  const preview = {
    ...createDiscussion({
      id: "d1",
      owner: "main",
      a: A,
      b: B,
      topic: "Preview",
      rounds: 2,
      now: 1,
      preview: true,
    }),
    settled: 3,
  };
  expect(shape(buildDiscussionThread(preview, {}))).toEqual([
    "topic:Preview",
    "round 1/2",
  ]);
  expect(typingSide(preview)).toBe("b");
});

describe("isLongReply", () => {
  it("folds replies past the character or line limit", () => {
    expect(isLongReply("Short.")).toBe(false);
    expect(isLongReply("x".repeat(901))).toBe(true);
    expect(
      isLongReply(Array.from({ length: 15 }, () => "line").join("\n")),
    ).toBe(true);
    expect(
      isLongReply(Array.from({ length: 14 }, () => "line").join("\n")),
    ).toBe(false);
  });
});
