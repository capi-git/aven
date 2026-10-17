// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  discussionStore,
  resetDiscussionStore,
  type DiscussionParty,
} from "../lib/discussions";
import type { DiscussionRelayMeta } from "../lib/session";
import {
  DiscussionOpenContext,
  DiscussionRelayCard,
} from "./DiscussionRelayCard";

vi.mock("./ProjectMark", () => ({
  ProjectMark: ({ path }: { path?: string }) =>
    createElement("span", { "data-project-mark": path }),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  resetDiscussionStore("main");
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  resetDiscussionStore();
  vi.unstubAllGlobals();
});

const meta = (patch: Partial<DiscussionRelayMeta>): DiscussionRelayMeta => ({
  id: "d1",
  turn: 0,
  rounds: 3,
  partner: {
    harness: "codex",
    model: "GPT-5",
    title: "Review",
    cwd: "/work/api",
  },
  ...patch,
});

async function render(value: DiscussionRelayMeta) {
  await act(async () =>
    root.render(createElement(DiscussionRelayCard, { meta: value })),
  );
}

it("labels the opening topic with the chat it will discuss with", async () => {
  await render(meta({}));
  expect(container.textContent).toBe(
    "Discussion withGPT-5 in “Review”· 3 rounds",
  );
  expect(
    container.querySelector('[data-project-mark="/work/api"]'),
  ).not.toBeNull();
});

it("marks a relayed reply with its sender, round and shortening", async () => {
  await render(meta({ turn: 3, truncated: true }));
  expect(container.textContent).toBe(
    "Relayed fromGPT-5 in “Review”· round 2 of 3 · shortened",
  );
});

const party = (sessionId: string, title: string): DiscussionParty => ({
  sessionId,
  harness: "codex",
  model: "GPT-5",
  title,
  cwd: "/work/api",
});

/** A chat pane in a window that drives discussions provides the opener. */
async function renderInChat(value: DiscussionRelayMeta, open = vi.fn()) {
  await act(async () =>
    root.render(
      createElement(
        DiscussionOpenContext.Provider,
        { value: open },
        createElement(DiscussionRelayCard, { meta: value }),
      ),
    ),
  );
  return open;
}
const link = () =>
  container.querySelector<HTMLButtonElement>("button[data-discussion-open]");

it("opens its discussion's page while it runs and after it has ended", async () => {
  const store = discussionStore();
  store.start({
    id: "d1",
    a: party("a", "Caching"),
    b: party("b", "Review"),
    topic: "Topic",
    rounds: 3,
  });
  const open = await renderInChat(meta({ turn: 1 }));
  expect(link()?.dataset.discussionRelay).toBe("d1");
  // The same words as a plain card.
  expect(container.textContent).toBe(
    "Relayed fromGPT-5 in “Review”· round 1 of 3",
  );
  await act(async () => link()!.click());
  expect(open).toHaveBeenCalledExactlyOnceWith("d1");

  // Finished, its notes posted and its tab long closed: kept as history.
  await act(async () => {
    store.stop("d1");
    store.notePosted("d1", "a");
    store.notePosted("d1", "b");
  });
  expect(store.get("d1")?.status).toBe("ended");
  await act(async () => link()!.click());
  expect(open).toHaveBeenCalledTimes(2);
});

it("stays openable however many finish after it, until its chat is deleted", async () => {
  // Each finished discussion is newer than the one before.
  let clock = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => (clock += 1));
  const store = discussionStore();
  const finish = (id: string) => {
    store.start({
      id,
      a: party(`${id}-a`, "Caching"),
      b: party(`${id}-b`, "Review"),
      topic: "Topic",
      rounds: 1,
    });
    store.stop(id);
    store.notePosted(id, "a");
    store.notePosted(id, "b");
  };
  finish("d1");
  await renderInChat(meta({}));
  expect(link()).not.toBeNull();
  await act(async () => {
    // More than the twenty finished discussions once kept.
    for (let index = 0; index < 25; index += 1) finish(`later-${index}`);
  });
  expect(store.get("d1")).toBeDefined();
  expect(link()).not.toBeNull();
  // The chat that started it is deleted: the discussion goes with it.
  await act(async () => store.forgetChat("d1-a"));
  expect(store.get("d1")).toBeUndefined();
  expect(link()).toBeNull();
  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelector("[data-discussion-relay='d1']")).not.toBe(
    null,
  );
  vi.restoreAllMocks();
});

it("is plain text where nothing can open the page", async () => {
  discussionStore().start({
    id: "d1",
    a: party("a", "Caching"),
    b: party("b", "Review"),
    topic: "Topic",
    rounds: 3,
  });
  await render(meta({}));
  expect(container.querySelector("button")).toBeNull();
});
