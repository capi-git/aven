// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discussionStore,
  resetDiscussionStore,
  type DiscussionParty,
} from "../lib/discussions";
import { newSession, type Block, type Session } from "../lib/session";

const rendered = vi.hoisted(() => [] as string[]);
vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => {
    rendered.push(text);
    return createElement("div", { "data-markdown": "" }, text);
  },
}));

import { DiscussionView } from "./DiscussionView";

const A: DiscussionParty = {
  sessionId: "a",
  harness: "claude",
  model: "Claude Sonnet 5",
  title: "Caching plan",
  cwd: "/work/site",
};
const B: DiscussionParty = {
  sessionId: "b",
  harness: "codex",
  model: "GPT-5",
  title: "Review",
  cwd: "/work/site",
};
const TOPIC = "Should we cache the lookups?";

let root: Root;
let container: HTMLDivElement;
let sessions: { a: Session; b: Session };

function chat(party: DiscussionParty): Session {
  return {
    ...newSession(party.harness, party.cwd),
    id: party.sessionId,
    title: party.title,
  };
}

/** Relay `turn` into its chat, as the broker does, and let it answer. */
function answer(turn: number, reply: string, rounds: number) {
  const side = turn % 2 === 0 ? "a" : "b";
  const blocks: Block[] = [
    {
      id: `relay-${turn}`,
      role: "user",
      text: "relayed",
      startedAt: turn,
      discussion: {
        id: "d1",
        turn,
        rounds,
        partner: { harness: "codex", model: "GPT-5", title: "Review" },
      },
    },
    { id: `reply-${turn}`, role: "assistant", text: reply },
  ];
  sessions = {
    ...sessions,
    [side]: {
      ...sessions[side],
      blocks: [...sessions[side].blocks, ...blocks],
    },
  };
  const store = discussionStore();
  store.markDelivered("d1");
  store.settle("d1", turn, { status: "completed", text: reply });
}

async function render() {
  await act(async () =>
    root.render(
      createElement(DiscussionView, {
        discussionId: "d1",
        a: sessions.a,
        b: sessions.b,
      }),
    ),
  );
}

const all = (selector: string) => [
  ...container.querySelectorAll<HTMLElement>(selector),
];
const text = (selector: string) =>
  container.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  resetDiscussionStore("main");
  rendered.length = 0;
  sessions = { a: chat(A), b: chat(B) };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetDiscussionStore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DiscussionView", () => {
  it("shows both sides as a conversation with the topic first", async () => {
    discussionStore().start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
    answer(0, "Yes, briefly.", 2);
    answer(1, "For how long?", 2);
    answer(2, "Five minutes.", 2);
    await render();

    // The cast: each side's mascot, name and part.
    const cast = container.querySelector("[data-discussion-cast]")!;
    expect(
      [...cast.querySelectorAll<HTMLElement>("[data-discussion-avatar]")].map(
        (avatar) => avatar.dataset.discussionAvatar,
      ),
    ).toEqual(["a", "b"]);
    expect(cast.textContent).toContain("Claude · Sonnet 5");
    expect(cast.textContent).toContain("Opened the topic");
    expect(cast.textContent).toContain("Codex · GPT-5");
    expect(cast.textContent).toContain("Responding");
    const [avatarA, avatarB] = all("[data-discussion-cast] .discussion-avatar");
    expect(avatarA.dataset.mascot).not.toBe(avatarB.dataset.mascot);
    expect(avatarA.style.getPropertyValue("--discussion-voice")).toBe(
      "#d97757",
    );
    expect(avatarB.style.getPropertyValue("--discussion-voice")).toBe(
      "#7a9dff",
    );

    // Topic, then rounds and alternating bubbles, each with its avatar.
    const order = all(
      "[data-discussion-topic], [data-discussion-round], [data-discussion-message], [data-discussion-typing]",
    ).map((item) =>
      item.dataset.discussionTopic !== undefined
        ? "topic"
        : item.dataset.discussionRound
          ? `round ${item.dataset.discussionRound}`
          : item.dataset.discussionTyping
            ? `typing ${item.dataset.discussionTyping}`
            : `${item.dataset.side}: ${item.querySelector("[data-markdown]")?.textContent}`,
    );
    expect(order).toEqual([
      "topic",
      "round 1",
      "a: Yes, briefly.",
      "b: For how long?",
      "round 2",
      "a: Five minutes.",
      "typing b",
    ]);
    expect(text("[data-discussion-topic]")).toContain(TOPIC);
    for (const message of all("[data-discussion-message]"))
      expect(
        message
          .querySelector("[data-discussion-avatar]")
          ?.getAttribute("data-discussion-avatar"),
      ).toBe(message.dataset.side);
    expect(text("[data-discussion-round='2']")).toBe("Round 2 of 2");

    // Only the answering side types, with its avatar stepping.
    const typing = container.querySelector("[data-discussion-typing]")!;
    expect(typing.querySelector(".discussion-avatar")).toHaveProperty(
      "dataset.typing",
      "true",
    );
    expect(typing.querySelector("svg.mascot-active")).not.toBeNull();
    expect(all("[data-discussion-message] svg.mascot-active")).toHaveLength(0);
    expect(text("[data-discussion-header] [role='status']")).toBe(
      "Round 2 of 2 · Codex · GPT-5 is replying…",
    );
  });

  it("folds a long reply behind Show more", async () => {
    discussionStore().start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
    answer(0, "Long. ".repeat(300), 2);
    await render();
    const bubble = container.querySelector<HTMLElement>(
      "[data-discussion-message='0'] .discussion-bubble",
    )!;
    expect(bubble.dataset.folded).toBe("true");
    const more = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Show more",
    )!;
    await act(async () => more.click());
    expect(bubble.dataset.folded).toBeUndefined();
    expect(more.textContent).toBe("Show less");
    expect(more.getAttribute("aria-expanded")).toBe("true");
  });

  it("re-renders no message while the answering side streams", async () => {
    discussionStore().start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
    answer(0, "Yes, briefly.", 2);
    await render();
    const before = rendered.length;
    for (const chunk of ["For", "For how", "For how long"]) {
      sessions = {
        ...sessions,
        b: {
          ...sessions.b,
          busy: true,
          blocks: [
            ...sessions.b.blocks.filter((block) => block.id !== "live"),
            { id: "live", role: "assistant", text: chunk, streaming: true },
          ],
        },
      };
      await render();
    }
    expect(rendered.length).toBe(before);
    expect(container.querySelector("[data-discussion-typing='b']")).not.toBe(
      null,
    );
  });

  it("pauses with the reason and Resume, and Stop ends it", async () => {
    const store = discussionStore();
    store.start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
    answer(0, "Yes, briefly.", 2);
    store.pause("d1", "“Review” needs your approval.");
    await render();
    expect(container.querySelector("[data-discussion-typing]")).toBeNull();
    expect(text("[data-discussion-paused]")).toContain(
      "Paused · “Review” needs your approval.",
    );
    const resume = container.querySelector<HTMLButtonElement>(
      "[data-discussion-paused] button",
    )!;
    await act(async () => resume.click());
    expect(store.get("d1")?.status).toBe("active");
    expect(container.querySelector("[data-discussion-typing='b']")).not.toBe(
      null,
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Stop discussion"]')!
        .click(),
    );
    expect(store.get("d1")?.status).toBe("ended");
    expect(text("[data-discussion-closing]")).toBe(
      "Discussion stopped during round 1 of 2.",
    );
    expect(container.querySelector('[aria-label="Stop discussion"]')).toBe(
      null,
    );
  });

  it("ends with the closing note and one happy hop on each side's last message", async () => {
    vi.useFakeTimers();
    discussionStore().start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 1 });
    answer(0, "Yes, briefly.", 1);
    await render();
    expect(all("svg.mascot-reacting")).toHaveLength(0);
    await act(async () => answer(1, "Agreed.", 1));
    await render();
    expect(text("[data-discussion-closing='completed']")).toBe(
      "Discussion ended after 1 round.",
    );
    expect(container.querySelector("[data-discussion-typing]")).toBeNull();
    const hopping = all("[data-discussion-message] svg.mascot-reacting");
    expect(hopping).toHaveLength(2);
    expect(hopping.every((svg) => svg.dataset.reaction === "cheer")).toBe(true);
    await act(async () => vi.advanceTimersByTime(1_200));
    expect(all("svg.mascot-reacting")).toHaveLength(0);
  });

  it("does not hop when opened on a finished discussion", async () => {
    discussionStore().start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 1 });
    answer(0, "Yes, briefly.", 1);
    answer(1, "Agreed.", 1);
    await render();
    expect(container.querySelector("[data-discussion-closing]")).not.toBe(null);
    expect(all("svg.mascot-reacting")).toHaveLength(0);
  });

  it("says so when the discussion is gone", async () => {
    await render();
    expect(container.textContent).toContain(
      "This discussion is no longer available.",
    );
  });
});

it("takes the keyboard when its pane is focused", async () => {
  discussionStore().start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
  const field = document.createElement("textarea");
  document.body.append(field);
  field.focus();
  await act(async () =>
    root.render(
      createElement(DiscussionView, {
        discussionId: "d1",
        a: sessions.a,
        b: sessions.b,
        focused: true,
      }),
    ),
  );
  expect(document.activeElement).toBe(
    container.querySelector(".discussion-scroll"),
  );
  field.remove();
});
