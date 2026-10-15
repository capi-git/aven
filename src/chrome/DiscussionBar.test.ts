// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DiscussionStore,
  discussionStore,
  resetDiscussionStore,
  type DiscussionParty,
} from "../lib/discussions";
import { DiscussionBar } from "./DiscussionBar";

const A: DiscussionParty = {
  sessionId: "a",
  harness: "claude",
  model: "Opus",
  title: "Caching",
  cwd: "/work/site",
};
const B: DiscussionParty = {
  sessionId: "b",
  harness: "codex",
  model: "GPT-5",
  title: "Review",
  cwd: "/work/site",
};

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
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetDiscussionStore();
  vi.unstubAllGlobals();
});

async function render(sessionId: string) {
  await act(async () =>
    root.render(createElement(DiscussionBar, { sessionId })),
  );
}
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((entry) =>
    entry.textContent?.includes(label),
  );

describe("DiscussionBar", () => {
  it("names the other chat and the round, and stops the discussion", async () => {
    const store = discussionStore();
    store.start({ id: "d1", a: A, b: B, topic: "Topic", rounds: 3 });
    await render("a");
    expect(container.textContent).toContain(
      "Discussing with GPT-5 in “Review”",
    );
    expect(container.textContent).toContain("round 1 of 3");
    await act(async () => button("Stop")!.click());
    expect(store.get("d1")?.status).toBe("ended");
    expect(container.querySelector("[data-discussion-bar]")).toBeNull();
  });

  it("shows the pause reason with Resume", async () => {
    const store = discussionStore();
    store.start({ id: "d1", a: A, b: B, topic: "Topic", rounds: 2 });
    store.pause("d1", "“Review” needs your approval.");
    await render("b");
    expect(container.textContent).toContain(
      "Paused · “Review” needs your approval.",
    );
    await act(async () => button("Resume")!.click());
    expect(store.get("d1")?.status).toBe("active");
    expect(container.textContent).toContain(
      "Discussing with Opus in “Caching”",
    );
  });

  it("stays out of chats whose discussion another window drives", async () => {
    new DiscussionStore(localStorage, "other").start({
      id: "theirs",
      a: A,
      b: B,
      topic: "Topic",
      rounds: 2,
    });
    resetDiscussionStore("main");
    await render("a");
    expect(container.querySelector("[data-discussion-bar]")).toBeNull();
  });
});
