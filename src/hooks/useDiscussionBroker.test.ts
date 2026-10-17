// @vitest-environment happy-dom
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DiscussionStore,
  type Discussion,
  type DiscussionHost,
  type DiscussionSummary,
} from "../lib/discussions";
import type { DiscussionTranscripts } from "../lib/discussionThread";
import { appendUser, stopStreaming } from "../lib/harness/apply";
import {
  newSession,
  type DiscussionRelayMeta,
  type DiscussionWrapUpMeta,
  type Session,
} from "../lib/session";
import {
  discussionChatTitle,
  useDiscussionBroker,
  type DiscussionTurnOptions,
} from "./useDiscussionBroker";

type Sent = {
  sessionId: string;
  text: string;
  options: DiscussionTurnOptions;
};

let root: Root;
let store: DiscussionStore;
let sent: Sent[];
/** Messages sent as the user, such as a wrap-up's build request. */
let messages: { sessionId: string; text: string }[];
let focused: string[];
let notes: { sessionId: string; text: string }[];
/** What closing notes carried to show where they landed. */
let wrapUps: { sessionId: string; wrapUp: DiscussionWrapUpMeta }[];
/** Where they landed, copied into a note once written. */
let recorded: { sessionId: string; wrapUp: DiscussionWrapUpMeta }[];
/** Discussions this window started, and those that used up their rounds. */
let started: string[];
let endedIds: string[];
/** The other chat's last reply, copied into the starting chat. */
let replies: { sessionId: string; text: string; meta: DiscussionRelayMeta }[];
let host: DiscussionHost;
let setSessions: (update: (sessions: Session[]) => Session[]) => void;
let ref: () => Session[];
let accept: boolean;
/** Chats this window parked, which `loadChat` brings back. */
let parked: Map<string, Session>;
let openPartner: ReturnType<typeof vi.fn>;
let openView: ReturnType<typeof vi.fn<(id: string) => void>>;
let summarise: ReturnType<
  typeof vi.fn<
    (
      discussion: Discussion,
      transcripts: DiscussionTranscripts,
    ) => Promise<DiscussionSummary>
  >
>;

function chat(id: string, title: string): Session {
  return {
    ...newSession("claude", "/work/site"),
    id,
    title: `claude · ${title}`,
  };
}

function Harness({ initial }: { initial: Session[] }) {
  const [sessions, set] = useState(initial);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  ref = () => sessionsRef.current;
  setSessions = (update) => {
    sessionsRef.current = update(sessionsRef.current);
    set(sessionsRef.current);
  };
  const broker = useDiscussionBroker({
    sessions,
    sessionsRef,
    store,
    onSubmit: (sessionId, text, _attachments, options) => {
      if (!accept) return false;
      if (!("discussion" in options)) {
        messages.push({ sessionId, text });
        setSessions((list) =>
          list.map((session) =>
            session.id === sessionId ? appendUser(session, text, []) : session,
          ),
        );
        return undefined;
      }
      sent.push({ sessionId, text, options });
      setSessions((list) =>
        list.map((session) =>
          session.id === sessionId
            ? appendUser(session, options.displayText, [], {
                discussion: options.discussion,
              })
            : session,
        ),
      );
      return undefined;
    },
    postNote: (sessionId, text, wrapUp) => {
      notes.push({ sessionId, text });
      if (wrapUp) wrapUps.push({ sessionId, wrapUp });
    },
    recordWrapUp: (sessionId, wrapUp) => recorded.push({ sessionId, wrapUp }),
    postReply: (sessionId, text, meta) => {
      replies.push({ sessionId, text, meta });
      setSessions((list) =>
        list.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                blocks: [
                  ...session.blocks,
                  {
                    id: crypto.randomUUID(),
                    role: "system",
                    text,
                    discussionReply: meta,
                  },
                ],
              }
            : session,
        ),
      );
    },
    openPartner: openPartner as never,
    openView,
    onStarted: (id) => started.push(id),
    onEnded: (discussion) => endedIds.push(discussion.id),
    focusChat: (sessionId) => focused.push(sessionId),
    loadChat: async (sessionId) => {
      const session = parked.get(sessionId);
      if (!session) return null;
      parked.delete(sessionId);
      setSessions((list) => [...list, session]);
      return session;
    },
    summarise,
  });
  host = broker.host;
  return null;
}

async function mount(sessions: Session[]) {
  await act(async () =>
    root.render(createElement(Harness, { initial: sessions })),
  );
}

/** The agent in `sessionId` answers and its turn ends. */
async function finish(sessionId: string, reply: string) {
  const turn = sent.filter((entry) => entry.sessionId === sessionId).at(-1)!;
  await act(async () => {
    setSessions((list) =>
      list.map((session) =>
        session.id === sessionId
          ? stopStreaming({
              ...session,
              blocks: [
                ...session.blocks,
                { id: crypto.randomUUID(), role: "assistant", text: reply },
              ],
            })
          : session,
      ),
    );
  });
  await act(async () =>
    turn.options.onSettled({ status: "completed", text: "every message" }),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  store = new DiscussionStore(localStorage, "main");
  sent = [];
  messages = [];
  focused = [];
  notes = [];
  wrapUps = [];
  recorded = [];
  replies = [];
  started = [];
  endedIds = [];
  summarise = vi.fn(async () => ({ status: "failed" as const }));
  accept = true;
  parked = new Map();
  openPartner = vi.fn();
  openView = vi.fn<(id: string) => void>();
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("useDiscussionBroker", () => {
  it("relays each final reply at turn end and closes with a note in both chats", async () => {
    await mount([chat("a", "Caching"), chat("b", "Review")]);
    let error: string | null = "unset";
    await act(async () => {
      error = host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Cache the lookups?",
        rounds: 1,
      });
    });
    expect(error).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0].sessionId).toBe("a");
    expect(sent[0].text).toContain("in the chat “Review”");
    expect(sent[0].text).toContain("Topic: Cache the lookups?");
    expect(sent[0].options.displayText).toBe("Cache the lookups?");
    expect(sent[0].options.discussion).toMatchObject({ turn: 0, rounds: 1 });
    // The user's topic keeps skills and @ references; relayed replies don't.
    expect(sent[0].options.verbatim).toBe(false);

    await finish("a", "Yes, briefly.");
    expect(sent).toHaveLength(2);
    expect(sent[1].sessionId).toBe("b");
    // The final assistant text is relayed, not everything streamed.
    expect(sent[1].text).toContain("in “Caching” says:\n\nYes, briefly.");
    expect(sent[1].options.displayText).toBe("Yes, briefly.");
    expect(sent[1].options.discussion.partner.title).toBe("Caching");
    expect(sent[1].options.verbatim).toBe(true);

    await finish("b", "Agreed.");
    expect(sent).toHaveLength(2);
    expect(notes).toEqual([
      { sessionId: "a", text: "Discussion ended after 1 round." },
      { sessionId: "b", text: "Discussion ended after 1 round." },
    ]);
    // Finished: kept for the team panel, with nothing left to do.
    expect(store.snapshot()).toEqual([
      expect.objectContaining({ status: "ended", settled: 2, notes: [] }),
    ]);
  });

  it("gives the other chat its role once, in its first relayed message", async () => {
    await mount([chat("a", "Caching"), chat("b", "Review")]);
    await act(async () => {
      host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Cache the lookups?",
        rounds: 2,
        role: "skeptic",
      });
    });
    expect(store.snapshot()[0].b.role).toBe("skeptic");
    expect(sent[0].text).not.toContain("Your role");
    await finish("a", "Yes, briefly.");
    const brief =
      "Your role in this discussion: Skeptic. Push back on weak points and look for what could go wrong; agree only when convinced.";
    expect(sent[1].sessionId).toBe("b");
    expect(sent[1].text.split(brief)).toHaveLength(2);
    // Shown in its transcript as part of the relayed message.
    expect(sent[1].options.displayText).toBe(`${brief}\n\nYes, briefly.`);
    await finish("b", "Not so fast.");
    await finish("a", "Fair.");
    expect(sent.map((entry) => entry.sessionId)).toEqual(["a", "b", "a", "b"]);
    expect(sent[3].text).not.toContain("Your role");
    expect(sent[3].options.displayText).toBe("Fair.");
  });

  it("opens the discussion in the panel only on request", async () => {
    await mount([chat("a", "Caching"), chat("b", "Review")]);
    await act(async () => {
      host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Topic",
        rounds: 2,
      });
    });
    const id = store.snapshot()[0].id;
    // It plays out in the chat that started it.
    expect(openView).not.toHaveBeenCalled();
    host.open?.(id);
    expect(openView).toHaveBeenCalledExactlyOnceWith(id);
    // Nothing to open for a discussion this window has never heard of.
    host.open?.("unknown");
    expect(openView).toHaveBeenCalledTimes(1);
  });

  it("opens nothing when the start is refused", async () => {
    await mount([chat("a", "Caching")]);
    let error: string | null = null;
    await act(async () => {
      error = host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "gone" },
        topic: "Topic",
        rounds: 2,
      });
    });
    expect(error).toBe("That chat is no longer open.");
    expect(openView).not.toHaveBeenCalled();
  });

  it("pauses for an approval, and resume continues with the reply", async () => {
    await mount([chat("a", "Caching"), chat("b", "Review")]);
    await act(async () => {
      host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Topic",
        rounds: 2,
      });
    });
    await act(async () =>
      setSessions((list) =>
        list.map((session) =>
          session.id === "a"
            ? {
                ...session,
                blocks: [
                  ...session.blocks,
                  {
                    id: "ap",
                    role: "approval",
                    text: "Run it?",
                    approval: { requestId: 1 },
                  },
                ],
              }
            : session,
        ),
      ),
    );
    expect(store.snapshot()[0]).toMatchObject({
      status: "paused",
      reason: "“Caching” needs your approval.",
    });
    // Resuming while it still waits pauses again.
    await act(async () => store.resume(store.snapshot()[0].id));
    expect(store.snapshot()[0].status).toBe("paused");

    await finish("a", "Done thinking.");
    expect(sent).toHaveLength(1);
    // The pause now says it can go on, rather than asking for approval.
    expect(store.snapshot()[0]).toMatchObject({
      settled: 1,
      status: "paused",
      reason: "Ready to continue.",
    });
    await act(async () => store.resume(store.snapshot()[0].id));
    expect(sent).toHaveLength(2);
    expect(sent[1].sessionId).toBe("b");
    expect(sent[1].text).toContain("Done thinking.");
  });

  it("waits for the user's own queued messages by pausing", async () => {
    await mount([chat("a", "Caching"), chat("b", "Review")]);
    await act(async () => {
      host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Topic",
        rounds: 2,
      });
    });
    await act(async () =>
      setSessions((list) =>
        list.map((session) =>
          session.id === "b"
            ? {
                ...session,
                queuedMessages: [{ id: "q", text: "mine", attachments: [] }],
              }
            : session,
        ),
      ),
    );
    await finish("a", "Reply");
    expect(sent).toHaveLength(1);
    expect(store.snapshot()[0]).toMatchObject({
      status: "paused",
      reason: "“Review” has your messages queued.",
    });
  });

  it("ends when a chat's turn is stopped", async () => {
    await mount([chat("a", "Caching"), chat("b", "Review")]);
    await act(async () => {
      host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Topic",
        rounds: 2,
      });
    });
    await act(async () => {
      setSessions((list) => list.map((session) => stopStreaming(session)));
    });
    await act(async () =>
      sent[0].options.onSettled({ status: "cancelled", text: "" }),
    );
    expect(notes.map((note) => note.text)).toEqual([
      "Discussion ended: “Caching” was stopped.",
      "Discussion ended: “Caching” was stopped.",
    ]);
  });

  it("pauses on an error, and resume sends the message again", async () => {
    await mount([chat("a", "Caching"), chat("b", "Review")]);
    await act(async () => {
      host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Topic",
        rounds: 2,
      });
    });
    await act(async () => {
      setSessions((list) => list.map((session) => stopStreaming(session)));
    });
    await act(async () =>
      sent[0].options.onSettled({ status: "failed", text: "" }),
    );
    expect(store.snapshot()[0]).toMatchObject({
      status: "paused",
      reason: "“Caching” ran into an error. Resume to try again.",
    });
    expect(notes).toEqual([]);
    await act(async () => store.resume(store.snapshot()[0].id));
    expect(sent).toHaveLength(2);
    expect(sent[1].sessionId).toBe("a");
    expect(sent[1].options.discussion.turn).toBe(0);
  });

  it("pauses when the chat refuses the message", async () => {
    accept = false;
    await mount([chat("a", "Caching"), chat("b", "Review")]);
    await act(async () => {
      host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Topic",
        rounds: 2,
      });
    });
    expect(store.snapshot()[0]).toMatchObject({
      status: "paused",
      delivered: false,
      reason: "Couldn't send to “Caching”. Resume to try again.",
    });
  });

  it("starts with a new chat it does not show", async () => {
    await mount([chat("a", "Caching")]);
    openPartner.mockImplementation(() => {
      setSessions((list) => [...list, chat("new", "Discuss: Topic")]);
      return "new";
    });
    await act(async () => {
      host.start({
        sessionId: "a",
        partner: { kind: "new", harness: "codex", model: "gpt-5" },
        topic: "Topic",
        rounds: 3,
      });
    });
    expect(openPartner).toHaveBeenCalledWith(
      "a",
      "codex",
      "gpt-5",
      "Discuss: Topic",
    );
    expect(store.snapshot()[0].b.sessionId).toBe("new");
    expect(sent[0].sessionId).toBe("a");
    // Nothing opens: neither the new chat nor the page.
    expect(openView).not.toHaveBeenCalled();
    expect(focused).toEqual([]);
  });

  it("leaves a chat that is already open where it is", async () => {
    await mount([chat("a", "Caching"), chat("b", "Review")]);
    await act(async () => {
      host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Topic",
        rounds: 2,
      });
    });
    expect(openPartner).not.toHaveBeenCalled();
    expect(focused).toEqual([]);
    expect(openView).not.toHaveBeenCalled();
  });

  it("shows either side's chat when the page asks", async () => {
    await mount([chat("a", "Caching")]);
    openPartner.mockImplementation(() => {
      setSessions((list) => [...list, chat("new", "Discuss: Topic")]);
      return "new";
    });
    await act(async () => {
      host.start({
        sessionId: "a",
        partner: { kind: "new", harness: "codex", model: "gpt-5" },
        topic: "Topic",
        rounds: 2,
      });
    });
    const id = store.snapshot()[0].id;
    host.show?.(id, "b");
    host.show?.(id, "a");
    host.show?.("unknown", "a");
    expect(focused).toEqual(["new", "a"]);
  });

  it("lists other chats and refuses busy ones", async () => {
    const busy = { ...chat("b", "Review"), busy: true };
    await mount([chat("a", "Caching"), busy, chat("c", "Docs")]);
    const options = host.options("a");
    expect(options.blocked).toBeUndefined();
    expect(options.candidates.map((candidate) => candidate.sessionId)).toEqual([
      "c",
      "b",
    ]);
    expect(options.candidates[1].blocked).toBe("working");
    let error: string | null = null;
    await act(async () => {
      error = host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Topic",
        rounds: 3,
      });
    });
    expect(error).toBe("“Review” is busy with another turn.");
    expect(host.options("b").blocked).toBe(
      "This chat is busy with another turn.",
    );
  });

  it("never drives another window's discussion", async () => {
    const other = new DiscussionStore(localStorage, "other");
    other.start({
      id: "theirs",
      a: {
        sessionId: "a",
        harness: "claude",
        model: "m",
        title: "A",
        cwd: "/",
      },
      b: {
        sessionId: "b",
        harness: "claude",
        model: "m",
        title: "B",
        cwd: "/",
      },
      topic: "Topic",
      rounds: 1,
    });
    store = new DiscussionStore(localStorage, "main");
    await mount([chat("a", "A"), chat("b", "B")]);
    expect(sent).toEqual([]);
    expect(store.get("theirs")?.status).toBe("active");
  });

  it("names a new partner chat after the topic", () => {
    expect(discussionChatTitle("  Cache?\nmore")).toBe("Discuss: Cache?");
    expect(discussionChatTitle("")).toBe("Discussion");
  });
});

describe("useDiscussionBroker with the user jumping in", () => {
  async function start(rounds: number) {
    await mount([chat("a", "Caching"), chat("b", "Review")]);
    await act(async () => {
      host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Cache the lookups?",
        rounds,
      });
    });
    return store.snapshot()[0].id;
  }

  it("never interrupts a turn, then carries the message to both chats", async () => {
    const id = await start(2);
    await finish("a", "Yes, briefly.");
    // B is answering; the user adds something.
    await act(async () => {
      expect(store.interject(id, "Keep it small.")).toBeNull();
    });
    expect(sent).toHaveLength(2);
    expect(sent[1].text).not.toContain("Keep it small.");

    await finish("b", "For how long?");
    expect(sent[2].sessionId).toBe("a");
    expect(sent[2].text).toContain(
      "says:\n\nFor how long?\n\nThe user adds: Keep it small.",
    );
    // The chat that started it shows the reply, then the user's message
    // as their own.
    expect(sent[2].options.displayText).toBe("For how long?");
    expect(sent[2].options.discussion.added).toEqual({
      after: ["Keep it small."],
    });

    await finish("a", "Five minutes.");
    expect(sent[3].sessionId).toBe("b");
    expect(sent[3].text).toContain(
      "The user adds: Keep it small.\n\nClaude Sonnet 5 in “Caching” says:\n\nFive minutes.",
    );
    await finish("b", "Agreed.");
    expect(sent).toHaveLength(4);
    expect(
      sent.filter((entry) => entry.text.includes("Keep it small.")),
    ).toHaveLength(2);
  });

  it("resumes a paused discussion with the message", async () => {
    const id = await start(2);
    await act(async () => store.pause(id, "Paused for a test."));
    expect(sent).toHaveLength(1);
    await finish("a", "Yes, briefly.");
    // Settled while paused: nothing goes until the user jumps in.
    expect(sent).toHaveLength(1);
    await act(async () => {
      store.interject(id, "Carry on.");
    });
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toContain("The user adds: Carry on.");
  });

  it("continues an ended discussion for one round, passing on the last reply", async () => {
    const id = await start(1);
    await finish("a", "Yes, briefly.");
    await finish("b", "Agreed, five minutes.");
    expect(store.get(id)?.status).toBe("ended");
    await act(async () => {
      expect(store.interject(id, "Now eviction?")).toBeNull();
    });
    expect(store.get(id)).toMatchObject({ rounds: 2, status: "active" });
    expect(sent).toHaveLength(3);
    expect(sent[2].sessionId).toBe("a");
    // B's last reply was never relayed; it is read back from B's chat.
    expect(sent[2].text).toContain(
      "says:\n\nAgreed, five minutes.\n\nThe user adds: Now eviction?",
    );
    expect(sent[2].options.discussion).toMatchObject({ turn: 2, rounds: 2 });
    await finish("a", "LRU.");
    expect(sent[3].text).toContain("The user adds: Now eviction?");
    await finish("b", "Agreed.");
    expect(store.get(id)).toMatchObject({
      status: "ended",
      settled: 4,
      ended: { kind: "completed" },
    });
    expect(notes.map((note) => note.text)).toEqual([
      "Discussion ended after 1 round.",
      "Discussion ended after 1 round.",
      "Discussion ended after 2 rounds.",
      "Discussion ended after 2 rounds.",
    ]);
  });

  it("brings back a parked partner to continue, instead of pausing", async () => {
    const id = await start(1);
    await finish("a", "Yes, briefly.");
    await finish("b", "Agreed, five minutes.");
    const b = ref().find((session) => session.id === "b")!;
    parked.set("b", b);
    await act(async () =>
      setSessions((list) => list.filter((session) => session.id !== "b")),
    );
    await act(async () => {
      expect(store.interject(id, "Now eviction?")).toBeNull();
    });
    await finish("a", "LRU.");
    // The partner is loaded and gets its turn; nothing paused.
    expect(store.get(id)?.status).toBe("active");
    expect(sent.at(-1)?.sessionId).toBe("b");
    expect(ref().some((session) => session.id === "b")).toBe(true);
  });

  it("pauses for a partner that can't be brought back, and tries again on Resume", async () => {
    const id = await start(1);
    await finish("a", "Yes, briefly.");
    await finish("b", "Agreed.");
    const b = ref().find((session) => session.id === "b")!;
    await act(async () =>
      setSessions((list) => list.filter((session) => session.id !== "b")),
    );
    await act(async () => {
      store.interject(id, "Now eviction?");
    });
    await finish("a", "LRU.");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(store.get(id)).toMatchObject({
      status: "paused",
      reason:
        "“Review” couldn't be opened. Open it from the sidebar to continue.",
    });
    // It can be opened again (unarchived, say): Resume tries once more.
    parked.set("b", b);
    await act(async () => {
      store.resume(id);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(store.get(id)?.status).toBe("active");
    expect(ref().some((session) => session.id === "b")).toBe(true);
  });

  it("copies the partner's last reply in when its turn ended before a reload", async () => {
    const id = await start(1);
    await finish("a", "Yes, briefly.");
    // B answers, but this page never hears its turn end (a reload).
    const turn = sent.at(-1)!;
    await act(async () =>
      setSessions((list) =>
        list.map((session) =>
          session.id === "b"
            ? stopStreaming({
                ...session,
                blocks: [
                  ...session.blocks,
                  { id: "late", role: "assistant", text: "Agreed, later." },
                ],
              })
            : session,
        ),
      ),
    );
    expect(turn.sessionId).toBe("b");
    // A new page drives it: its turn in flight is forgotten.
    await act(async () => root.unmount());
    root = createRoot(document.createElement("div"));
    await mount(ref());
    expect(store.get(id)).toMatchObject({ status: "ended", settled: 2 });
    expect(replies.map((reply) => reply.text)).toEqual(["Agreed, later."]);
    expect(endedIds).toEqual([id]);
  });
});

describe("useDiscussionBroker's wrap-up", () => {
  async function complete() {
    await mount([chat("a", "Caching"), chat("b", "Review")]);
    await act(async () => {
      host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Cache the lookups?",
        rounds: 1,
      });
    });
    const id = store.snapshot()[0].id;
    await finish("a", "Cache by URL.");
    await finish("b", "Agreed, with a TTL.");
    return id;
  }

  it("sums a finished discussion up once, from both transcripts", async () => {
    summarise.mockResolvedValue({
      status: "done",
      agreed: ["Cache by URL", "Add a TTL"],
      open: [],
      model: "Claude Haiku 4.5",
    });
    const id = await complete();
    expect(summarise).toHaveBeenCalledTimes(1);
    const [discussion, transcripts] = summarise.mock.calls[0];
    expect(discussion.id).toBe(id);
    expect(transcripts.a?.some((block) => block.text === "Cache by URL.")).toBe(
      true,
    );
    expect(
      transcripts.b?.some((block) => block.text === "Agreed, with a TTL."),
    ).toBe(true);
    expect(store.get(id)?.summary).toMatchObject({ status: "done" });
    // Later changes to the chats never ask again.
    await act(async () =>
      setSessions((list) => list.map((session) => ({ ...session }))),
    );
    expect(summarise).toHaveBeenCalledTimes(1);
  });

  it("sums up a continued discussion's new ending even while the old summary runs", async () => {
    let finishFirst: (summary: DiscussionSummary) => void = () => {};
    summarise.mockImplementationOnce(
      () =>
        new Promise<DiscussionSummary>((resolve) => {
          finishFirst = resolve;
        }),
    );
    summarise.mockResolvedValue({
      status: "done",
      agreed: ["Evict by version"],
      open: [],
      model: "Claude Haiku 4.5",
    });
    const id = await complete();
    expect(store.get(id)?.summary?.status).toBe("running");
    await act(async () => {
      store.interject(id, "And eviction?");
    });
    await finish("a", "By version.");
    await finish("b", "Agreed.");
    expect(summarise).toHaveBeenCalledTimes(2);
    expect(store.get(id)?.summary).toMatchObject({
      status: "done",
      agreed: ["Evict by version"],
    });
    // The first ending's late answer changes nothing.
    await act(async () =>
      finishFirst({ status: "done", agreed: ["Old"], open: [], model: "M" }),
    );
    expect(store.get(id)?.summary).toMatchObject({
      agreed: ["Evict by version"],
    });
  });

  it("shows where they landed under the starting chat's closing note, and keeps the lists there", async () => {
    let write: (summary: DiscussionSummary) => void = () => {};
    summarise.mockImplementationOnce(
      () =>
        new Promise<DiscussionSummary>((resolve) => {
          write = resolve;
        }),
    );
    const id = await complete();
    // Both chats get the note; only the starting chat's shows the wrap-up,
    // which is still being written.
    expect(notes.map((note) => note.sessionId)).toEqual(["a", "b"]);
    expect(wrapUps).toEqual([{ sessionId: "a", wrapUp: { id, settled: 2 } }]);
    expect(recorded).toEqual([]);
    await act(async () =>
      write({
        status: "done",
        agreed: ["Cache by URL"],
        open: ["Errors"],
        model: "Claude Haiku 4.5",
      }),
    );
    expect(recorded).toEqual([
      {
        sessionId: "a",
        wrapUp: { id, settled: 2, agreed: ["Cache by URL"], open: ["Errors"] },
      },
    ]);
    // Nothing is sent to either agent.
    expect(sent).toHaveLength(2);
    expect(messages).toEqual([]);
  });

  it("copies the other chat's last reply into the starting chat, shown only", async () => {
    const id = await complete();
    expect(replies).toEqual([
      {
        sessionId: "a",
        text: "Agreed, with a TTL.",
        meta: expect.objectContaining({
          id,
          turn: 2,
          partner: expect.objectContaining({ title: "Review", sessionId: "b" }),
          self: expect.objectContaining({ sessionId: "a" }),
          at: expect.any(Number),
        }),
      },
    ]);
    // Neither agent is sent anything more.
    expect(sent).toHaveLength(2);
    // Continued from the chat: that reply is passed on to the starting chat
    // again, but not shown twice.
    await act(async () => {
      store.interject(id, "And eviction?");
    });
    expect(sent).toHaveLength(3);
    expect(sent[2].sessionId).toBe("a");
    expect(sent[2].text).toContain("Agreed, with a TTL.");
    expect(sent[2].options.displayText).toBe("");
    expect(sent[2].options.discussion).toMatchObject({
      turn: 2,
      replyShown: true,
      added: { after: ["And eviction?"] },
    });
  });

  it("opens the panel when one starts, and says so when it used up its rounds", async () => {
    const id = await complete();
    expect(started).toEqual([id]);
    expect(endedIds).toEqual([id]);
  });

  it("copies nothing when the discussion was stopped", async () => {
    await mount([chat("a", "Caching"), chat("b", "Review")]);
    await act(async () => {
      host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Topic",
        rounds: 2,
      });
    });
    await finish("a", "Cache by URL.");
    await act(async () => store.stop(store.snapshot()[0].id));
    await finish("b", "Too late.");
    expect(replies).toEqual([]);
    expect(endedIds).toEqual([]);
  });

  it("puts the lists in the note itself when they are written first", async () => {
    summarise.mockResolvedValue({
      status: "done",
      agreed: ["Cache by URL"],
      open: [],
      model: "Claude Haiku 4.5",
    });
    await mount([chat("a", "Caching"), chat("b", "Review")]);
    await act(async () => {
      host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Cache the lookups?",
        rounds: 1,
      });
    });
    const id = store.snapshot()[0].id;
    await finish("a", "Cache by URL.");
    // The starting chat is busy with your own turn when the discussion ends.
    await act(async () =>
      setSessions((list) =>
        list.map((session) =>
          session.id === "a" ? { ...session, busy: true } : session,
        ),
      ),
    );
    await finish("b", "Agreed.");
    expect(store.get(id)?.summary?.status).toBe("done");
    expect(wrapUps).toEqual([]);
    await act(async () =>
      setSessions((list) =>
        list.map((session) =>
          session.id === "a" ? { ...session, busy: false } : session,
        ),
      ),
    );
    expect(wrapUps).toEqual([
      {
        sessionId: "a",
        wrapUp: { id, settled: 2, agreed: ["Cache by URL"], open: [] },
      },
    ]);
  });

  it("shows no wrap-up after a stopped discussion's note", async () => {
    await mount([chat("a", "Caching"), chat("b", "Review")]);
    await act(async () => {
      host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Topic",
        rounds: 2,
      });
    });
    await act(async () => store.stop(store.snapshot()[0].id));
    // The starting chat's note waits for the turn it was sent to end.
    await finish("a", "Cache by URL.");
    expect(notes.map((note) => note.sessionId).sort()).toEqual(["a", "b"]);
    expect(wrapUps).toEqual([]);
  });

  it("keeps a failed summary as failed and never retries it", async () => {
    summarise.mockRejectedValue(new Error("No model"));
    const id = await complete();
    expect(store.get(id)?.summary).toEqual({ status: "failed" });
    // No lists to keep.
    expect(recorded).toEqual([]);
    await act(async () =>
      setSessions((list) => list.map((session) => ({ ...session }))),
    );
    expect(summarise).toHaveBeenCalledTimes(1);
  });

  it("does not sum up a stopped discussion", async () => {
    await mount([chat("a", "Caching"), chat("b", "Review")]);
    await act(async () => {
      host.start({
        sessionId: "a",
        partner: { kind: "chat", sessionId: "b" },
        topic: "Topic",
        rounds: 2,
      });
    });
    await act(async () => store.stop(store.snapshot()[0].id));
    expect(summarise).not.toHaveBeenCalled();
  });

  it("builds through the normal send path: shows the chat and sends as the user", async () => {
    summarise.mockResolvedValue({
      status: "done",
      agreed: ["Cache by URL", "Add a TTL"],
      open: ["Errors"],
      model: "Claude Haiku 4.5",
    });
    const id = await complete();
    let refused: string | null = "unset";
    await act(async () => {
      refused = await host.build!(id, "b");
    });
    expect(refused).toBeNull();
    expect(focused).toEqual(["b"]);
    expect(messages).toEqual([
      {
        sessionId: "b",
        text: "Please carry out the plan from your discussion with Claude Sonnet 5. You agreed on:\n\n- Cache by URL\n- Add a TTL",
      },
    ]);
    // It appears in the chat like any message the user sent.
    expect(
      ref()
        .find((session) => session.id === "b")
        ?.blocks.at(-1),
    ).toMatchObject({ role: "user", text: messages[0].text });
    // Nothing new is relayed.
    expect(sent).toHaveLength(2);
  });

  it("brings back a chat that was parked once the discussion ended, then builds", async () => {
    const id = await complete();
    // The new partner had no tab: it was parked after the closing notes.
    const b = ref().find((session) => session.id === "b")!;
    parked.set("b", b);
    await act(async () =>
      setSessions((list) => list.filter((session) => session.id !== "b")),
    );
    let refused: string | null = "unset";
    await act(async () => {
      refused = await host.build!(id, "b");
    });
    expect(refused).toBeNull();
    expect(messages.map((message) => message.sessionId)).toEqual(["b"]);
    expect(focused).toEqual(["b"]);
  });

  it("says why it can't build when the chat is gone or refuses", async () => {
    const id = await complete();
    await act(async () =>
      setSessions((list) => list.filter((session) => session.id !== "a")),
    );
    expect(await host.build!(id, "a")).toBe("Couldn't open “Caching”.");
    accept = false;
    expect(await host.build!(id, "b")).toBe("Couldn't send to “Review”.");
    expect(await host.build!("gone", "b")).toBe(
      "This discussion is no longer available.",
    );
  });
});
