import { describe, expect, it } from "vitest";
import {
  captureDiscussionWrapUp,
  DiscussionStore,
  discussionWrapUpMeta,
  planDiscussions,
  readDiscussionWrapUpMeta,
  SUMMARY_ITEM_LIMIT,
  type DiscussionAction,
  type DiscussionParty,
} from "./discussions";
import { applyHarnessEvent } from "./harness/apply";
import { newSession, type Session } from "./session";
import { sanitizeSessionForPersist } from "./sessionStore";

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

/** A one-round discussion in `store` that used up its rounds. */
function complete(store: DiscussionStore, id = "d1") {
  store.start({ id, a: A, b: B, topic: "Topic", rounds: 1 });
  store.markDelivered(id);
  store.settle(id, 0, { status: "completed", text: "A" });
  store.markDelivered(id);
  store.settle(id, 1, { status: "completed", text: "B" });
}

function chat(id: string): Session {
  return { ...newSession("claude", "/work/site"), id };
}

const notes = (actions: DiscussionAction[]) =>
  actions.filter((action) => action.kind === "note");

describe("the closing note in the chat that started a discussion", () => {
  it("carries where they landed only for the starting chat of a finished one", () => {
    const store = new DiscussionStore(memoryStorage(), "main");
    complete(store);
    const sessions = [chat("chat-a"), chat("chat-b")];
    expect(
      notes(planDiscussions(store.snapshot(), "main", sessions, new Set())),
    ).toEqual([
      expect.objectContaining({
        side: "a",
        sessionId: "chat-a",
        text: "Discussion finished after 1 round.",
        wrapUp: { id: "d1", settled: 2 },
      }),
      {
        kind: "note",
        id: "d1",
        side: "b",
        sessionId: "chat-b",
        text: "Discussion finished after 1 round.",
      },
    ]);
    // Once summed up, the note posted then copies the lists.
    store.claimSummary("d1");
    store.finishSummary("d1", 2, {
      status: "done",
      agreed: ["Cache by URL"],
      open: ["Errors"],
      model: "Haiku",
    });
    expect(
      notes(planDiscussions(store.snapshot(), "main", sessions, new Set()))[0],
    ).toMatchObject({
      wrapUp: {
        id: "d1",
        settled: 2,
        agreed: ["Cache by URL"],
        open: ["Errors"],
      },
    });
  });

  it("carries nothing for a stopped discussion, in either chat", () => {
    const store = new DiscussionStore(memoryStorage(), "main");
    store.start({ id: "d1", a: A, b: B, topic: "Topic", rounds: 2 });
    store.stop("d1");
    const planned = notes(
      planDiscussions(
        store.snapshot(),
        "main",
        [chat("chat-a"), chat("chat-b")],
        new Set(),
      ),
    );
    expect(planned).toHaveLength(2);
    for (const note of planned) expect(note).not.toHaveProperty("wrapUp");
    expect(discussionWrapUpMeta(store.get("d1")!)).toBeUndefined();
  });

  it("adds a block that shows the wrap-up without reaching the agent", () => {
    const session = applyHarnessEvent(chat("chat-a"), {
      type: "status",
      text: "Discussion finished after 1 round.",
      discussionEnd: { id: "d1", settled: 2 },
    });
    expect(session.blocks).toEqual([
      expect.objectContaining({
        role: "system",
        text: "Discussion finished after 1 round.",
        discussionEnd: { id: "d1", settled: 2 },
      }),
    ]);
    // An identical plain status after it is still dropped as a repeat, but
    // not a note for another ending.
    const again = applyHarnessEvent(session, {
      type: "status",
      text: "Discussion finished after 1 round.",
      discussionEnd: { id: "d1", settled: 2 },
    });
    expect(again).toBe(session);
    const later = applyHarnessEvent(session, {
      type: "status",
      text: "Discussion finished after 1 round.",
      discussionEnd: { id: "d1", settled: 4 },
    });
    expect(later.blocks).toHaveLength(2);
  });
});

describe("copying where they landed into the closing note", () => {
  const ended = (settled: number) => ({
    id: `note-${settled}`,
    role: "system" as const,
    text: "Discussion finished after 1 round.",
    discussionEnd: { id: "d1", settled },
  });
  const lists = { agreed: ["Cache by URL"], open: [] };

  it("fills in that ending's note and nothing else", () => {
    const session = {
      ...chat("chat-a"),
      blocks: [
        ended(2),
        { id: "reply", role: "assistant" as const, text: "Hi" },
        ended(4),
      ],
    };
    const next = captureDiscussionWrapUp(session, {
      id: "d1",
      settled: 2,
      ...lists,
    });
    expect(next.blocks[0].discussionEnd).toEqual({
      id: "d1",
      settled: 2,
      ...lists,
    });
    expect(next.blocks[1]).toBe(session.blocks[1]);
    expect(next.blocks[2]).toBe(session.blocks[2]);
    // Already there, without lists, or no such note: unchanged.
    expect(
      captureDiscussionWrapUp(next, { id: "d1", settled: 2, ...lists }),
    ).toBe(next);
    expect(captureDiscussionWrapUp(session, { id: "d1", settled: 2 })).toBe(
      session,
    );
    expect(
      captureDiscussionWrapUp(session, { id: "d9", settled: 2, ...lists }),
    ).toBe(session);
  });

  it("is saved with the transcript, only on system notes, kept small", () => {
    const long = "x".repeat(400);
    const session: Session = {
      ...chat("chat-a"),
      blocks: [
        { id: "u", role: "user", text: "Hi" },
        {
          ...ended(2),
          discussionEnd: {
            id: "d1",
            settled: 2,
            agreed: Array.from({ length: 9 }, (_, index) => `Point ${index}`),
            open: [long, "  "],
          },
        },
        {
          id: "stray",
          role: "assistant",
          text: "Hi",
          discussionEnd: { id: "d1", settled: 2 },
        },
      ],
    };
    const [, note, stray] = sanitizeSessionForPersist(session).blocks;
    expect(note.discussionEnd?.agreed).toHaveLength(SUMMARY_ITEM_LIMIT);
    expect(note.discussionEnd?.open).toEqual([]);
    expect(stray.discussionEnd).toBeUndefined();
    expect(readDiscussionWrapUpMeta({ id: "d1", settled: 2 })).toEqual({
      id: "d1",
      settled: 2,
    });
    for (const bad of [null, [], { id: "", settled: 1 }, { id: "d1" }])
      expect(readDiscussionWrapUpMeta(bad)).toBeNull();
    expect(readDiscussionWrapUpMeta({ id: "d1", settled: -1 })).toBeNull();
  });
});
