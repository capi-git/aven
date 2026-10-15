// @vitest-environment happy-dom
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscussionStore, type DiscussionHost } from "../lib/discussions";
import { appendUser, stopStreaming } from "../lib/harness/apply";
import { newSession, type Session } from "../lib/session";
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
let notes: { sessionId: string; text: string }[];
let host: DiscussionHost;
let setSessions: (update: (sessions: Session[]) => Session[]) => void;
let accept: boolean;
let openPartner: ReturnType<typeof vi.fn>;

function chat(id: string, title: string): Session {
  return {
    ...newSession("claude", "/work/site"),
    id,
    title: `claude · ${title}`,
  };
}

function Harness({ initial }: { initial: Session[] }) {
  const [sessions, set] = useState(initial);
  const ref = useRef(sessions);
  ref.current = sessions;
  setSessions = (update) => {
    ref.current = update(ref.current);
    set(ref.current);
  };
  const broker = useDiscussionBroker({
    sessions,
    sessionsRef: ref,
    store,
    onSubmit: (sessionId, text, _attachments, options) => {
      if (!accept) return false;
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
    postNote: (sessionId, text) => notes.push({ sessionId, text }),
    openPartner: openPartner as never,
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
  notes = [];
  accept = true;
  openPartner = vi.fn();
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

    await finish("a", "Yes, briefly.");
    expect(sent).toHaveLength(2);
    expect(sent[1].sessionId).toBe("b");
    // The final assistant text is relayed, not everything streamed.
    expect(sent[1].text).toContain("in “Caching” says:\n\nYes, briefly.");
    expect(sent[1].options.displayText).toBe("Yes, briefly.");
    expect(sent[1].options.discussion.partner.title).toBe("Caching");

    await finish("b", "Agreed.");
    expect(sent).toHaveLength(2);
    expect(notes).toEqual([
      { sessionId: "a", text: "Discussion ended after 1 round." },
      { sessionId: "b", text: "Discussion ended after 1 round." },
    ]);
    expect(store.snapshot()).toEqual([]);
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
    expect(store.snapshot()[0]).toMatchObject({ settled: 1, status: "paused" });
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

  it("starts with a new chat opened beside this one", async () => {
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
