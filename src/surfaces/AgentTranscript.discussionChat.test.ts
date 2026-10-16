// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discussionStore,
  resetDiscussionStore,
  type DiscussionParty,
} from "../lib/discussions";
import type { Block, DiscussionRelayMeta } from "../lib/session";

/** Every markdown render, by text: a reply drawn again shows up twice. */
const markdown = vi.hoisted(() => [] as string[]);
vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => {
    markdown.push(text);
    return createElement("div", { "data-markdown": "" }, text);
  },
}));
vi.mock("../lib/harness/registry", () => ({
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

import { AgentTranscript } from "./AgentTranscript";

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
const TOPIC = "Should we cache the lookups?";
const PARTNER = "Agreed, with a 30 second TTL.";
const LAST = "Fine, then evict by version.";

let root: Root;
let container: HTMLDivElement;

function meta(turn: number, extra: Partial<DiscussionRelayMeta> = {}) {
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
    ...extra,
  } satisfies DiscussionRelayMeta;
}

/** The starting chat after two of four turns, its own reply to B done. */
function midway(): Block[] {
  return [
    { id: "before", role: "user", text: "What does the cache hold?" },
    { id: "before-reply", role: "assistant", text: "Lookups by URL." },
    {
      id: "topic",
      role: "user",
      text: TOPIC,
      startedAt: 1,
      discussion: meta(0),
    },
    { id: "a-0", role: "assistant", text: "Cache by URL." },
    {
      id: "relay-2",
      role: "user",
      text: PARTNER,
      startedAt: 2,
      discussion: meta(2, { added: { after: ["Keep it small."] } }),
    },
    { id: "a-2", role: "assistant", text: "Thirty seconds it is." },
  ];
}

/** The same discussion, B answering the last turn. */
function startDiscussion() {
  const store = discussionStore();
  store.start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
  for (let turn = 0; turn < 3; turn += 1) {
    store.markDelivered("d1");
    store.settle("d1", turn, { status: "completed", text: `reply ${turn}` });
  }
  store.markDelivered("d1");
}

async function render(blocks: Block[], busy = false) {
  await act(async () =>
    root.render(
      createElement(AgentTranscript, {
        blocks,
        busy,
        harness: "claude",
        model: "claude:opus-5.5",
        cwd: "/work/site",
      }),
    ),
  );
}

const one = (selector: string) =>
  container.querySelector<HTMLElement>(selector);
const all = (selector: string) => [
  ...container.querySelectorAll<HTMLElement>(selector),
];
const text = (element: Element | null) =>
  element?.textContent?.replace(/\s+/g, " ").trim();
const follows = (first: Element | null, then: Element | null) =>
  !!first &&
  !!then &&
  !!(first.compareDocumentPosition(then) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  resetDiscussionStore("main");
  markdown.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetDiscussionStore();
  vi.unstubAllGlobals();
});

describe("a discussion in the chat that started it", () => {
  it("shows the other agent on the right, this chat under its name, and the rounds", async () => {
    startDiscussion();
    await render(midway());

    // The topic is your message, then round 1.
    const topic = all(".personal-user-message").find((message) =>
      message.textContent?.includes(TOPIC),
    )!;
    const rounds = all("[data-discussion-round]");
    expect(rounds.map(text)).toEqual(["Round 1 of 2", "Round 2 of 2"]);
    expect(follows(topic, rounds[0])).toBe(true);

    // This chat's turns: its mascot and name over its usual reply.
    const own = all("[data-discussion-own]");
    expect(own.map((turn) => turn.dataset.discussionOwn)).toEqual(["0", "2"]);
    expect(text(own[0].querySelector("[data-discussion-speaker]"))).toBe(
      "Claude · Opus 5.5",
    );
    expect(own[0].querySelector("[data-discussion-avatar]")).not.toBeNull();
    expect(own[0].textContent).toContain("Cache by URL.");

    // The other agent's reply: its message on the right, agreeing.
    const partner = one('[data-discussion-message="1"]')!;
    expect(partner.dataset.side).toBe("b");
    expect(text(partner.querySelector(".discussion-message-name"))).toBe(
      "Codex · GPT-5.4",
    );
    expect(
      partner.querySelector("[data-discussion-stance]")?.getAttribute("title"),
    ).toBe("Agrees");
    expect(partner.textContent).toContain(PARTNER);
    expect(follows(own[0], partner)).toBe(true);

    // Round 2 opens after it, then what you added, then this chat answers.
    const added = all(".personal-user-message").find((message) =>
      message.textContent?.includes("Keep it small."),
    )!;
    expect(follows(partner, rounds[1])).toBe(true);
    expect(follows(rounds[1], added)).toBe(true);
    expect(follows(added, own[1])).toBe(true);
    // Your message is your own bubble, not the other agent's.
    expect(added.closest("[data-discussion-message]")).toBeNull();

    // The other agent is answering: typing at the end.
    const typing = one("[data-discussion-tail] [data-discussion-typing]");
    expect(typing?.dataset.discussionTyping).toBe("b");
    expect(follows(own[1], typing)).toBe(true);
  });

  it("draws everything outside a discussion as before", async () => {
    await render(midway().slice(0, 2));
    expect(one("[data-discussion-own]")).toBeNull();
    expect(one("[data-discussion-round]")).toBeNull();
    expect(one("[data-discussion-message]")).toBeNull();
    expect(one("[data-discussion-tail]")).toBeNull();
    expect(text(one(".personal-user-message"))).toBe(
      "What does the cache hold?",
    );
  });

  it("shows what you added at the end until it reaches this chat", async () => {
    startDiscussion();
    discussionStore().interject("d1", "Mind the locale.");
    await render(midway());
    const tail = one("[data-discussion-tail]")!;
    const waiting = tail.querySelector("[data-discussion-jump-in]");
    expect(waiting?.textContent).toContain("Mind the locale.");
    expect(waiting?.textContent).toContain("Goes to both with the next reply");
    expect(
      follows(tail.querySelector("[data-discussion-typing]"), waiting),
    ).toBe(true);
  });

  it("ends with the other agent's last reply, the closing note and where they landed", async () => {
    startDiscussion();
    const store = discussionStore();
    store.settle("d1", 3, { status: "completed", text: LAST });
    await render([
      ...midway(),
      {
        id: "last",
        role: "system",
        text: LAST,
        discussionReply: meta(4, { at: 3 }),
      },
      {
        id: "note",
        role: "system",
        text: "Discussion ended after 2 rounds.",
        discussionEnd: { id: "d1", settled: 4 },
      },
    ]);
    const last = one('[data-discussion-message="3"]')!;
    expect(last.dataset.side).toBe("b");
    expect(last.textContent).toContain(LAST);
    // After this chat's last turn, not inside it.
    expect(last.closest("[data-discussion-own]")).toBeNull();
    const note = all(".personal-transcript-notice").find(
      (row) => row.textContent === "Discussion ended after 2 rounds.",
    )!;
    expect(follows(last, note)).toBe(true);
    expect(follows(note, one('[data-discussion-wrapup-note="d1"]'))).toBe(true);
    expect(one("[data-discussion-typing]")).toBeNull();
  });

  it("does not show a continued discussion's last reply twice", async () => {
    await render([
      ...midway(),
      {
        id: "last",
        role: "system",
        text: LAST,
        discussionReply: meta(4),
      },
      {
        id: "relay-4",
        role: "user",
        text: "",
        startedAt: 4,
        discussion: meta(4, {
          rounds: 3,
          replyShown: true,
          added: { after: ["And eviction?"] },
        }),
      },
    ]);
    expect(all('[data-discussion-message="3"]')).toHaveLength(1);
    expect(text(all("[data-discussion-round]").at(-1)!)).toBe("Round 3 of 3");
    expect(container.textContent).toContain("And eviction?");
  });

  it("keeps earlier messages as they are while this chat streams", async () => {
    startDiscussion();
    const blocks = midway();
    await render(blocks, true);
    const drawn = () => markdown.filter((entry) => entry === PARTNER).length;
    const before = drawn();
    expect(before).toBe(1);
    // Tokens arrive for this chat's latest reply.
    const streaming = blocks.slice(0, -1);
    for (const reply of ["Thirty", "Thirty seconds", "Thirty seconds it is."])
      await render(
        [...streaming, { id: "a-2", role: "assistant", text: reply }],
        true,
      );
    // Another discussion changes; this one does not.
    await act(async () => {
      discussionStore().start({
        id: "d2",
        a: { ...A, sessionId: "x" },
        b: { ...B, sessionId: "y" },
        topic: "Other",
        rounds: 1,
      });
    });
    expect(drawn()).toBe(before);
  });
});
