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
import { newSession, type Block, type Session } from "../lib/session";

const rendered = vi.hoisted(() => [] as string[]);
vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => {
    rendered.push(text);
    return createElement("div", { "data-markdown": "" }, text);
  },
}));

import { DiscussionPanelContent, discussionStatus } from "./DiscussionPanel";
import { ACT_FAILED } from "../hooks/useTeamAct";
import { NO_ANSWER_TEXT } from "../lib/teamWatchBridge";

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
      createElement(DiscussionPanelContent, {
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

describe("DiscussionPanelContent", () => {
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
    expect(cast.textContent).toContain("Claude");
    expect(cast.textContent).toContain("Opened the topic");
    expect(cast.textContent).toContain("Codex");
    // The side answering now glows and says so.
    expect(cast.textContent).toContain("Replying…");
    expect(
      container.querySelector<HTMLElement>(
        "[data-discussion-cast] [data-speaking]",
      )?.dataset.side,
    ).toBe("b");
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
    expect(
      typing.querySelector('.dot-mark[data-state="working"]'),
    ).not.toBeNull();
    expect(
      all('[data-discussion-message] .dot-mark[data-state="working"]'),
    ).toHaveLength(0);
    expect(text("[data-discussion-cast] [role='status']")).toBe("Round 2 of 2");
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
        .querySelector<HTMLButtonElement>('[data-team-stop="discussion"]')!
        .click(),
    );
    expect(store.get("d1")?.status).toBe("ended");
    expect(text("[data-discussion-closing]")).toBe(
      "Discussion stopped during round 1 of 2.",
    );
    expect(container.querySelector('[data-team-stop="discussion"]')).toBe(null);
  });

  it("keeps its Stop in the footer, last, as a race's and a run's panel do", async () => {
    const store = discussionStore();
    store.start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
    answer(0, "Yes, briefly.", 2);
    store.pause("d1", "“Review” is busy with your own turn.", "b");
    await renderWith({
      options: () => ({ candidates: [] }),
      start: () => null,
      show: vi.fn(),
    });
    const footer = container.querySelector<HTMLElement>(
      "[data-discussion-actions]",
    )!;
    expect(footer.classList).toContain("team-watch-actions");
    // At the bottom of the panel, after the message box.
    expect(footer.parentElement?.lastElementChild).toBe(footer);
    expect(
      [...footer.querySelectorAll("button")].map((button) =>
        button.textContent?.trim(),
      ),
    ).toEqual(["Go to Codex", "Stop discussion"]);
  });

  it("shows why a press from a window of its own did nothing", async () => {
    const store = discussionStore();
    store.start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
    answer(0, "Yes, briefly.", 2);
    store.pause("d1", "“Review” needs your approval.");
    // As a popped-out panel acts: the owning window answers later.
    const act_ = vi.fn(async () => NO_ANSWER_TEXT);
    await act(async () =>
      root.render(
        createElement(DiscussionPanelContent, {
          discussionId: "d1",
          a: sessions.a,
          b: sessions.b,
          act: act_,
        }),
      ),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-discussion-paused] button")!
        .click(),
    );
    expect(act_).toHaveBeenCalledWith({ kind: "resume" });
    const problem = container.querySelector("[data-discussion-problem]");
    expect(problem?.getAttribute("role")).toBe("alert");
    expect(problem?.textContent).toBe(NO_ANSWER_TEXT);
    // A failure, not a refusal, is said plainly.
    act_.mockRejectedValueOnce(new Error("The owning workspace closed"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-team-stop="discussion"]')!
        .click(),
    );
    expect(text("[data-discussion-problem]")).toBe(ACT_FAILED);
  });

  it("ends with the closing note and one tick on each side's last message", async () => {
    vi.useFakeTimers();
    discussionStore().start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 1 });
    answer(0, "Yes, briefly.", 1);
    await render();
    expect(all(".dot-mark[data-reaction]")).toHaveLength(0);
    await act(async () => answer(1, "Agreed.", 1));
    await render();
    expect(text("[data-discussion-closing='completed']")).toBe(
      "Discussion finished after 1 round.",
    );
    expect(container.querySelector("[data-discussion-typing]")).toBeNull();
    const hopping = all("[data-discussion-message] .dot-mark[data-reaction]");
    expect(hopping).toHaveLength(2);
    expect(hopping.every((mark) => mark.dataset.reaction === "cheer")).toBe(
      true,
    );
    await act(async () => vi.advanceTimersByTime(1_200));
    expect(all(".dot-mark[data-reaction]")).toHaveLength(0);
  });

  it("does not hop when opened on a finished discussion", async () => {
    discussionStore().start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 1 });
    answer(0, "Yes, briefly.", 1);
    answer(1, "Agreed.", 1);
    await render();
    expect(container.querySelector("[data-discussion-closing]")).not.toBe(null);
    expect(all(".dot-mark[data-reaction]")).toHaveLength(0);
  });

  it("says so when the discussion is gone", async () => {
    await render();
    expect(container.textContent).toContain(
      "This discussion is no longer available.",
    );
  });
});

/** The window that drives discussions; the message box needs one. */
const HOST: DiscussionHost = {
  options: () => ({ candidates: [] }),
  start: () => null,
};

async function renderWith(host?: DiscussionHost) {
  await act(async () =>
    root.render(
      createElement(DiscussionPanelContent, {
        discussionId: "d1",
        a: sessions.a,
        b: sessions.b,
        host,
      }),
    ),
  );
}

const field = () =>
  container.querySelector<HTMLTextAreaElement>(
    "[data-discussion-jump] textarea",
  )!;

async function type(text: string) {
  await act(async () => {
    const element = field();
    element.focus();
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(key: string, shiftKey = false) {
  await act(async () => {
    field().dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

/** Thread items in order, as short labels. */
const order = () =>
  all(
    "[data-discussion-round], [data-discussion-message], [data-discussion-typing], [data-discussion-you], [data-discussion-closing]",
  ).map((item) =>
    item.dataset.discussionRound
      ? `round ${item.dataset.discussionRound}`
      : item.dataset.discussionTyping
        ? `typing ${item.dataset.discussionTyping}`
        : item.dataset.discussionYou !== undefined
          ? `you(${item.dataset.state}): ${item.querySelector(".discussion-you-bubble")?.textContent}`
          : item.dataset.discussionClosing
            ? "closing"
            : `${item.dataset.side}: ${item.querySelector("[data-markdown]")?.textContent}`,
  );

describe("DiscussionPanelContent: the cast", () => {
  it("opens either side's chat from its name or mascot", async () => {
    discussionStore().start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
    const show = vi.fn<(id: string, side: "a" | "b") => void>();
    await renderWith({ ...HOST, show });
    const party = (side: string) =>
      container.querySelector<HTMLElement>(
        `[data-discussion-cast] [data-discussion-party="${side}"]`,
      )!;
    expect(party("b").tagName).toBe("BUTTON");
    expect(party("b").title).toBe("Open “Review” · Codex · GPT-5");
    // The mascot is inside the button, so pressing it opens the chat too.
    expect(party("b").querySelector("[data-discussion-avatar]")).not.toBeNull();
    await act(async () => party("b").click());
    expect(show).toHaveBeenLastCalledWith("d1", "b");
    await act(async () =>
      party("a")
        .querySelector<HTMLElement>("[data-discussion-avatar]")!
        .click(),
    );
    expect(show).toHaveBeenLastCalledWith("d1", "a");
    expect(show).toHaveBeenCalledTimes(2);
  });

  it("names both sides without buttons where the window can't show chats", async () => {
    discussionStore().start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
    await renderWith(undefined);
    expect(container.querySelector("[data-discussion-party]")).toBeNull();
    expect(container.querySelectorAll(".discussion-side")).toHaveLength(2);
  });
});

describe("DiscussionPanelContent: jumping in", () => {
  it("sends with Enter, adds a line with Shift+Enter and leaves with Escape", async () => {
    const store = discussionStore();
    store.start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
    answer(0, "Yes, briefly.", 2);
    // B is answering now.
    store.markDelivered("d1");
    await renderWith(HOST);
    expect(field().placeholder).toBe("Add something for both of them…");
    expect(container.querySelector(".discussion-jump-hint")).toBeNull();

    await type("Keep it small.");
    await press("Enter", true);
    expect(store.get("d1")?.interjections).toBeUndefined();
    await press("Enter");
    expect(store.get("d1")?.interjections).toEqual([
      expect.objectContaining({ text: "Keep it small.", turn: 2 }),
    ]);
    expect(field().value).toBe("");
    // Queued behind the turn under way, below its typing.
    expect(order()).toEqual([
      "round 1",
      "a: Yes, briefly.",
      "typing b",
      "you(queued): Keep it small.",
    ]);
    expect(text("[data-discussion-you] .discussion-you-label")).toBe("You");
    expect(text(".discussion-you-note")).toBe("Goes with the next reply");

    // B answers: the message now sits where A reads it.
    answer(1, "For how long?", 2);
    await renderWith(HOST);
    expect(order()).toEqual([
      "round 1",
      "a: Yes, briefly.",
      "b: For how long?",
      "round 2",
      "you(queued): Keep it small.",
      "typing a",
    ]);
    store.markDelivered("d1");
    await renderWith(HOST);
    expect(order()).toContain("you(sent): Keep it small.");
    expect(container.querySelector(".discussion-you-note")).toBeNull();

    await type("Draft");
    await press("Escape");
    expect(document.activeElement).toBe(
      container.querySelector(".discussion-scroll"),
    );
  });

  it("resumes a paused discussion", async () => {
    const store = discussionStore();
    store.start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
    answer(0, "Yes, briefly.", 2);
    store.pause("d1", "“Review” is busy.");
    await renderWith(HOST);
    expect(text(".discussion-jump-hint")).toBe("Resumes the discussion");
    expect(
      container
        .querySelector("[data-discussion-jump] button[type='submit']")
        ?.getAttribute("aria-label"),
    ).toBe("Send to both and resume");
    await type("Go on.");
    await press("Enter");
    expect(store.get("d1")?.status).toBe("active");
    expect(container.querySelector("[data-discussion-typing='b']")).not.toBe(
      null,
    );
  });

  it("continues an ended discussion for one more round", async () => {
    const store = discussionStore();
    store.start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 1 });
    answer(0, "Yes, briefly.", 1);
    answer(1, "Agreed.", 1);
    await renderWith(HOST);
    expect(text(".discussion-jump-hint")).toBe("Continues for one more round");
    await type("And eviction?");
    await press("Enter");
    expect(store.get("d1")).toMatchObject({ status: "active", rounds: 2 });
    expect(order()).toEqual([
      "round 1",
      "a: Yes, briefly.",
      "b: Agreed.",
      "round 2",
      "you(queued): And eviction?",
      "typing a",
    ]);
    expect(text("[data-discussion-cast] [role='status']")).toContain(
      "Round 2 of 2",
    );
  });

  it("has no box where no window drives discussions", async () => {
    discussionStore().start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
    await renderWith(undefined);
    expect(container.querySelector("[data-discussion-jump]")).toBeNull();
  });

  it("has no box on a development preview", async () => {
    discussionStore().start({
      id: "d1",
      a: A,
      b: B,
      topic: TOPIC,
      rounds: 2,
      preview: true,
    });
    await renderWith(HOST);
    expect(container.querySelector("[data-discussion-jump]")).toBeNull();
  });
});

describe("DiscussionPanelContent: stance and reactions", () => {
  it("marks replies that agree or push back, subtly", async () => {
    discussionStore().start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
    answer(0, "Yes, briefly.", 2);
    answer(1, "Agreed, five minutes.", 2);
    answer(2, "Not quite: ten.", 2);
    await render();
    const mark = (turn: number) =>
      container.querySelector<HTMLElement>(
        `[data-discussion-message='${turn}'] .discussion-message-name [data-discussion-stance]`,
      );
    // The opener answers the topic, not another reply.
    expect(mark(0)).toBeNull();
    expect(mark(1)?.dataset.discussionStance).toBe("agree");
    expect(mark(1)?.title).toBe("Agrees");
    expect(mark(1)?.querySelector("svg")).not.toBeNull();
    expect(mark(2)?.dataset.discussionStance).toBe("pushback");
    expect(mark(2)?.title).toBe("Pushes back");
    expect(mark(2)?.textContent).toBe("↔");
  });

  it("nods or tilts once as a reply lands, and never again", async () => {
    vi.useFakeTimers();
    discussionStore().start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
    answer(0, "Yes, briefly.", 2);
    await render();
    expect(all(".dot-mark[data-reaction]")).toHaveLength(0);

    answer(1, "Agreed, five minutes.", 2);
    await render();
    const playing = all(".dot-mark[data-reaction]");
    expect(playing).toHaveLength(1);
    expect(playing[0].dataset.reaction).toBe("nod");
    expect(playing[0].closest("[data-discussion-message]")).toHaveProperty(
      "dataset.discussionMessage",
      "1",
    );
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(all(".dot-mark[data-reaction]")).toHaveLength(0);
    // Rendering again, or streaming in the other chat, plays nothing.
    await render();
    sessions = {
      ...sessions,
      a: {
        ...sessions.a,
        blocks: [
          ...sessions.a.blocks,
          { id: "live", role: "assistant", text: "Fi", streaming: true },
        ],
      },
    };
    await render();
    expect(all(".dot-mark[data-reaction]")).toHaveLength(0);

    answer(2, "Not quite: ten.", 2);
    await render();
    expect(
      all(".dot-mark[data-reaction]").map((mark) => mark.dataset.reaction),
    ).toEqual(["tilt"]);
    await act(async () => vi.advanceTimersByTime(1_000));

    // Reopening the page replays nothing.
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(all(".dot-mark[data-reaction]")).toHaveLength(0);
  });

  it("stays still for a neutral reply", async () => {
    discussionStore().start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
    answer(0, "Yes, briefly.", 2);
    await render();
    answer(1, "For how long?", 2);
    await render();
    expect(all(".dot-mark[data-reaction]")).toHaveLength(0);
    expect(container.querySelector("[data-discussion-stance]")).toBeNull();
  });
});

describe("DiscussionPanelContent: where they landed", () => {
  function host() {
    return {
      options: () => ({ candidates: [] }),
      start: () => null,
      // As the broker does: a plan that went is marked on the discussion.
      build: vi.fn<(id: string, side: "a" | "b") => string | null>(
        (id, side) => {
          discussionStore().markBuilt(id, side);
          return null;
        },
      ),
    } satisfies DiscussionHost;
  }

  async function complete(withHost?: DiscussionHost) {
    discussionStore().start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 1 });
    answer(0, "Cache by URL.", 1);
    answer(1, "Agreed, with a TTL.", 1);
    await renderWith(withHost);
  }

  it("sums up quietly, then shows both lists after the closing note", async () => {
    const actions = host();
    await complete(actions);
    const card = () =>
      container.querySelector<HTMLElement>("[data-discussion-wrapup]")!;
    expect(card().dataset.discussionWrapup).toBe("summing");
    expect(text(".discussion-wrapup-title")).toBe("Where they landed");
    expect(text(".discussion-wrapup-wait")).toBe("Summing up…");
    // After the closing note.
    const closing = container.querySelector("[data-discussion-closing]")!;
    expect(
      closing.compareDocumentPosition(card()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const store = discussionStore();
    await act(async () => {
      store.claimSummary("d1");
      store.finishSummary("d1", 2, {
        status: "done",
        agreed: ["Cache by URL", "Add a 30 s TTL"],
        open: [],
        model: "Claude Haiku 4.5",
      });
    });
    expect(card().dataset.discussionWrapup).toBe("done");
    expect(
      all("[data-discussion-list='agreed'] li").map((item) => item.textContent),
    ).toEqual(["Cache by URL", "Add a 30 s TTL"]);
    expect(text("[data-discussion-list='open'] h4")).toBe("Still open");
    expect(text("[data-discussion-list='open'] .discussion-wrapup-empty")).toBe(
      "Nothing left open.",
    );
    expect(text(".discussion-wrapup-model")).toBe(
      "Summed up by Claude Haiku 4.5",
    );
  });

  it("has a build button for each side, named by its app", async () => {
    const actions = host();
    await complete(actions);
    const buttons = all("[data-discussion-build]");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Have Claude build it",
      "Have Codex build it",
    ]);
    await act(async () => buttons[1].click());
    expect(actions.build).toHaveBeenCalledExactlyOnceWith("d1", "b");
    expect(buttons[1].dataset.sent).toBe("true");
    // Sent once: it says so and can't send the plan twice.
    expect(buttons[1].textContent).toBe("Sent to Codex");
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    await act(async () => buttons[1].click());
    expect(actions.build).toHaveBeenCalledOnce();
    actions.build.mockReturnValueOnce(
      "“Caching plan” isn't open in this window.",
    );
    await act(async () => buttons[0].click());
    expect(text(".discussion-wrapup-problem")).toBe(
      "“Caching plan” isn't open in this window.",
    );
  });

  it("says calmly when the summary failed, and tries again", async () => {
    await complete(host());
    await act(async () => {
      const store = discussionStore();
      store.claimSummary("d1");
      store.finishSummary("d1", 2, { status: "failed" });
    });
    expect(
      container.querySelector<HTMLElement>("[data-discussion-wrapup]")?.dataset
        .discussionWrapup,
    ).toBe("failed");
    expect(text(".discussion-wrapup-title")).toBe("Where they landed");
    expect(text(".discussion-wrapup-wait")).toBe("Couldn't sum this up.");
    expect(container.querySelector("[data-discussion-list]")).toBeNull();
    expect(all("[data-discussion-build]")).toHaveLength(2);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-discussion-wrapup-retry]")!
        .click(),
    );
    // Asked again: the window that drives it sums it up once more.
    expect(discussionStore().get("d1")?.summary?.status).toBe("pending");
    expect(text(".discussion-wrapup-wait")).toBe("Summing up…");
  });

  it("shows only the buttons for a stopped discussion", async () => {
    const store = discussionStore();
    store.start({ id: "d1", a: A, b: B, topic: TOPIC, rounds: 2 });
    answer(0, "Cache by URL.", 2);
    store.stop("d1");
    await renderWith(host());
    expect(
      container.querySelector<HTMLElement>("[data-discussion-wrapup]")?.dataset
        .discussionWrapup,
    ).toBe("stopped");
    expect(container.querySelector(".discussion-wrapup-title")).toBeNull();
    expect(container.querySelector(".discussion-wrapup-wait")).toBeNull();
    expect(all("[data-discussion-build]")).toHaveLength(2);
    // Without a window that can build, a stopped one shows no card.
    await renderWith(undefined);
    expect(container.querySelector("[data-discussion-wrapup]")).toBeNull();
  });
});

it("tells two chats of one provider apart by model while one replies", () => {
  const party = (sessionId: string, model: string) => ({
    sessionId,
    harness: "claude" as const,
    model,
    title: sessionId,
    cwd: "/work",
  });
  expect(
    discussionStatus({
      status: "active",
      settled: 1,
      a: party("a", "Opus 5.5"),
      b: party("b", "Sonnet 5"),
    }).text,
  ).toBe("Claude Sonnet 5 is replying…");
});
