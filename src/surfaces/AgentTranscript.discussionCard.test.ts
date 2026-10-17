// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discussionStore,
  resetDiscussionStore,
  type DiscussionHost,
  type DiscussionParty,
} from "../lib/discussions";
import type { Block, DiscussionRelayMeta } from "../lib/session";

/** Every markdown render, by text: a reply drawn again shows up twice. */
const markdown = vi.hoisted(() => [] as string[]);
/** Every mascot drawn: the card draws two each time it renders. */
const avatars = vi.hoisted(() => ({ count: 0 }));
vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => {
    markdown.push(text);
    return createElement("div", { "data-markdown": "" }, text);
  },
}));
vi.mock("../chrome/DiscussionAvatar", () => ({
  DiscussionAvatar: ({ voice }: { voice: { side: string } }) => {
    avatars.count += 1;
    return createElement("span", { "data-discussion-avatar": voice.side });
  },
}));
vi.mock("../lib/harness/registry", () => ({
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

import { DiscussionActions } from "../chrome/DiscussionWrapUpNote";
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
let host: DiscussionHost & {
  open: ReturnType<typeof vi.fn<(id: string) => void>>;
  show: ReturnType<typeof vi.fn<(id: string, side: "a" | "b") => void>>;
};

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

/** The starting chat after three of four turns, its own reply to B done. */
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

/** The rest of it in the starting chat once it ended. */
const ending: Block[] = [
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
];

/** The same discussion in the store, the other chat answering turn 3. */
function startDiscussion() {
  const store = discussionStore();
  store.start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
  const replies = ["Cache by URL.", "Not quite, add a TTL.", "Thirty seconds."];
  for (let turn = 0; turn < 3; turn += 1) {
    store.markDelivered("d1");
    store.settle("d1", turn, { status: "completed", text: replies[turn] });
  }
  store.markDelivered("d1");
}

async function render(blocks: Block[], busy = false) {
  await act(async () =>
    root.render(
      createElement(
        DiscussionActions,
        { host },
        createElement(AgentTranscript, {
          blocks,
          busy,
          harness: "claude",
          model: "claude:opus-5.5",
          cwd: "/work/site",
        }),
      ),
    ),
  );
}

const one = (selector: string) =>
  container.querySelector<HTMLElement>(selector);
const text = (element: Element | null) =>
  element?.textContent?.replace(/\s+/g, " ").trim();
const card = () => one("[data-discussion-card='d1']");
const press = async (selector: string) =>
  act(async () => one(selector)!.click());
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
  avatars.count = 0;
  host = {
    options: () => ({ candidates: [] }),
    start: () => null,
    open: vi.fn<(id: string) => void>(),
    show: vi.fn<(id: string, side: "a" | "b") => void>(),
  };
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

describe("a discussion's card in the chat that started it", () => {
  it("folds the discussion into one live card after the topic", async () => {
    startDiscussion();
    await render(midway());
    const topic = [
      ...container.querySelectorAll(".personal-user-message"),
    ].find((message) => message.textContent?.includes(TOPIC))!;
    expect(card()?.dataset.state).toBe("live");
    expect(follows(topic, card())).toBe(true);
    expect(text(card()!.querySelector(".team-card-title"))).toBe(
      "Claude and Codex are discussing",
    );
    expect(text(card()!.querySelector("[data-discussion-card-badge]"))).toBe(
      "Round 2 of 2",
    );
    // The latest line: the reply just relayed, by who wrote it.
    expect(text(card()!.querySelector(".team-card-status"))).toBe(
      "Claude: “Thirty seconds.”",
    );
    expect(card()!.querySelectorAll("[data-discussion-avatar]")).toHaveLength(
      2,
    );
    // The turns it stands for are not drawn at all.
    expect(container.textContent).not.toContain("Cache by URL.");
    expect(container.textContent).not.toContain(PARTNER);
    expect(one("[data-discussion-message]")).toBeNull();

    await press("[data-discussion-card-watch]");
    expect(host.open).toHaveBeenCalledExactlyOnceWith("d1");
    // Stop is the bar's, in the message box: the card offers no second one.
    expect(one("[data-discussion-card-stop]")).toBeNull();
    await act(async () => discussionStore().stop("d1"));
    expect(discussionStore().get("d1")?.ended?.kind).toBe("stopped");
    expect(card()?.dataset.state).toBe("stopped");
  });

  it("turns amber when it needs you, with a way to that chat", async () => {
    startDiscussion();
    discussionStore().pause("d1", "“Review” needs your approval.", B.sessionId);
    await render(midway());
    expect(card()?.dataset.state).toBe("needs-you");
    expect(text(card()!.querySelector("[data-discussion-card-badge]"))).toBe(
      "Needs you",
    );
    expect(text(card()!.querySelector(".team-card-status"))).toBe(
      "“Review” needs your approval.",
    );
    expect(text(one("[data-discussion-card-goto]"))).toBe("Go to Codex");
    await press("[data-discussion-card-goto]");
    expect(host.show).toHaveBeenCalledExactlyOnceWith("d1", "b");

    // Paused for no one chat, such as by a reload: Resume.
    await act(async () => {
      const store = discussionStore();
      store.resume("d1");
      store.pause("d1", "Paused when its window reloaded.");
    });
    await press("[data-discussion-card-resume]");
    expect(discussionStore().get("d1")?.status).toBe("active");
  });

  it("opens around this chat's own approval, and the card shows it", async () => {
    startDiscussion();
    await act(async () =>
      discussionStore().pause(
        "d1",
        "“Caching plan” needs your approval.",
        "chat-a",
      ),
    );
    const asking: Block[] = [
      ...midway(),
      {
        id: "relay-4",
        role: "user",
        text: "Thirty seconds.",
        startedAt: 4,
        discussion: meta(4),
      },
      {
        id: "ask",
        role: "tool",
        text: "Run npm test",
        tool: { kind: "shell", status: "pending" },
        approval: { requestId: 9 },
      },
    ];
    await render(asking, true);
    // Unfolded by itself: Allow and Deny are right there.
    expect(one("[data-approval-pending]")).not.toBeNull();
    // This chat is the one waiting: no "Go to" itself.
    expect(one("[data-discussion-card-goto]")).toBeNull();
    expect(text(one("[data-discussion-card-show-approval]"))).toBe(
      "Show approval",
    );
    await press("[data-discussion-card-show-approval]");
    expect(document.activeElement?.textContent).toBe("Allow");
    // Decided: it folds back.
    await render(
      asking.map((block) =>
        block.id === "ask"
          ? { ...block, approval: { requestId: 9, decided: "allow" } }
          : block,
      ),
      true,
    );
    expect(one("[data-approval-pending]")).toBeNull();
    expect(
      container.querySelector("[data-discussion-span='d1']"),
    ).not.toBeNull();
  });

  it("folds on Hide in chat even while open for an approval, and shows no Show approval without one", async () => {
    startDiscussion();
    await act(async () =>
      discussionStore().pause(
        "d1",
        "“Caching plan” needs your approval.",
        "chat-a",
      ),
    );
    const asking: Block[] = [
      ...midway(),
      {
        id: "relay-4",
        role: "user",
        text: "Thirty seconds.",
        startedAt: 4,
        discussion: meta(4),
      },
      {
        id: "ask",
        role: "tool",
        text: "Run npm test",
        tool: { kind: "shell", status: "pending" },
        approval: { requestId: 9 },
      },
    ];
    await render(asking, true);
    expect(one("[data-approval-pending]")).not.toBeNull();
    await press("[data-discussion-card-toggle]");
    // Folded as asked, though the approval still waits.
    expect(one("[data-approval-pending]")).toBeNull();
    expect(text(one("[data-discussion-card-toggle]"))).not.toBe("Hide in chat");
    // Show approval opens it again, onto Allow; hide it once more.
    await press("[data-discussion-card-show-approval]");
    expect(document.activeElement?.textContent).toBe("Allow");
    await press("[data-discussion-card-toggle]");
    expect(one("[data-approval-pending]")).toBeNull();
    // Decided: it stays folded, not left open.
    await render(
      asking.map((block) =>
        block.id === "ask"
          ? { ...block, approval: { requestId: 9, decided: "allow" } }
          : block,
      ),
      true,
    );
    expect(text(one("[data-discussion-card-toggle]"))).not.toBe("Hide in chat");
    // Waiting on this chat's own turn, not an approval: no Show approval.
    await render(midway(), true);
    expect(one("[data-discussion-card-show-approval]")).toBeNull();
  });

  it("unfolds itself for a jump to a turn inside it", async () => {
    startDiscussion();
    let reveal: ((blockId: string) => boolean) | undefined;
    await act(async () =>
      root.render(
        createElement(
          DiscussionActions,
          { host },
          createElement(AgentTranscript, {
            blocks: midway(),
            busy: false,
            harness: "claude",
            model: "claude:opus-5.5",
            cwd: "/work/site",
            onRevealReady: (next: (blockId: string) => boolean) => {
              reveal = next;
            },
          }),
        ),
      ),
    );
    expect(container.textContent).not.toContain("Thirty seconds it is.");
    await act(async () => {
      expect(reveal?.("relay-2")).toBe(true);
    });
    // The prompt outline's mark lands on that turn, not the top of the chat.
    expect(container.textContent).toContain("Thirty seconds it is.");
  });

  it("becomes Discussed for N rounds with Open, followed by where they landed", async () => {
    startDiscussion();
    discussionStore().settle("d1", 3, { status: "completed", text: LAST });
    await render([...midway(), ...ending]);
    expect(card()?.dataset.state).toBe("done");
    expect(text(card()!.querySelector(".team-card-title"))).toBe(
      "Discussed for 2 rounds",
    );
    expect(one("[data-discussion-card-stop]")).toBeNull();
    expect(text(one("[data-discussion-card-watch]"))).toBe("Open");
    await press("[data-discussion-card-watch]");
    expect(host.open).toHaveBeenCalledWith("d1");
    const wrapUp = one("[data-discussion-wrapup-note='d1']");
    expect(follows(card(), wrapUp)).toBe(true);
    // The closing note and the last reply are inside the fold.
    expect(container.textContent).not.toContain(LAST);
    expect(container.textContent).not.toContain(
      "Discussion ended after 2 rounds.",
    );
  });

  it("shows the turns in the chat on request, and hides them again", async () => {
    startDiscussion();
    discussionStore().settle("d1", 3, { status: "completed", text: LAST });
    await render([...midway(), ...ending]);
    await press("[data-discussion-card-toggle]");
    expect(text(one("[data-discussion-card-toggle]"))).toBe("Hide in chat");
    // The raw turns: this chat's replies, the relayed reply with what you
    // added, the other chat's last reply and the closing note.
    expect(container.textContent).toContain("Cache by URL.");
    const relayed = [...container.querySelectorAll(".personal-user-message")]
      .map((message) => text(message))
      .find((line) => line?.includes(PARTNER));
    expect(relayed).toContain("You added: Keep it small.");
    expect(one("[data-discussion-partner='3']")?.textContent).toContain(LAST);
    expect(container.textContent).toContain("Discussion ended after 2 rounds.");
    // The card stays at the top of its turns.
    expect(follows(card(), one("[data-discussion-partner='3']"))).toBe(true);

    await press("[data-discussion-card-toggle]");
    expect(container.textContent).not.toContain("Cache by URL.");
  });

  it("draws everything outside a discussion as before", async () => {
    startDiscussion();
    await render(midway());
    expect(text(container.querySelector(".personal-user-message"))).toBe(
      "What does the cache hold?",
    );
    expect(container.textContent).toContain("Lookups by URL.");
    await render(midway().slice(0, 2));
    expect(card()).toBeNull();
  });

  it("re-renders the card only when what it shows changes, never while the chat streams", async () => {
    startDiscussion();
    const blocks = midway();
    await render(blocks, true);
    const drawn = avatars.count;
    // Tokens arrive for this chat's latest reply.
    for (const reply of ["Thirty", "Thirty seconds", "Thirty seconds it is."])
      await render(
        [...blocks.slice(0, -1), { id: "a-2", role: "assistant", text: reply }],
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
    expect(avatars.count).toBe(drawn);
    // This one moves on: the card updates.
    await act(async () =>
      discussionStore().settle("d1", 3, { status: "completed", text: LAST }),
    );
    expect(avatars.count).toBeGreaterThan(drawn);
    expect(card()?.dataset.state).toBe("done");
  });

  it("keeps unfolded turns as they are while the chat streams", async () => {
    startDiscussion();
    const blocks = midway();
    await render(blocks, true);
    await press("[data-discussion-card-toggle]");
    const drawn = () =>
      markdown.filter((entry) => entry === "Cache by URL.").length;
    const before = drawn();
    expect(before).toBeGreaterThan(0);
    for (const reply of ["Thirty", "Thirty seconds it is."])
      await render(
        [...blocks.slice(0, -1), { id: "a-2", role: "assistant", text: reply }],
        true,
      );
    expect(drawn()).toBe(before);
  });
});
