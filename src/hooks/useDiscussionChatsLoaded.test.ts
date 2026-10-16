// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscussionStore, type DiscussionParty } from "../lib/discussions";
import { useDiscussionChatsLoaded } from "./useDiscussionChatsLoaded";

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

let root: Root;

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

function Probe(props: {
  ensure: (id: string) => Promise<unknown>;
  loaded: () => string[];
  store: DiscussionStore;
}) {
  useDiscussionChatsLoaded(props.ensure, props.loaded, props.store);
  return null;
}

async function open(store: DiscussionStore, loaded: string[]) {
  const ensure = vi.fn(async (id: string) => id);
  const props = { ensure, loaded: () => loaded, store };
  await act(async () => root.render(createElement(Probe, props)));
  // Re-rendering the window never asks again.
  await act(async () => root.render(createElement(Probe, { ...props })));
  return ensure;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("a discussion's chats after a reload", () => {
  it("brings back the partner chat, which has no tab, once", async () => {
    const storage = memoryStorage();
    new DiscussionStore(storage, "main").start({
      id: "d1",
      a: A,
      b: B,
      topic: "Cache?",
      rounds: 2,
    });
    // The window reloads: the starting chat comes back with its tab.
    const ensure = await open(new DiscussionStore(storage, "main"), ["chat-a"]);
    expect(ensure).toHaveBeenCalledExactlyOnceWith("chat-b");
  });

  it("leaves finished discussions' chats alone", async () => {
    const store = new DiscussionStore(memoryStorage(), "main");
    store.start({ id: "d1", a: A, b: B, topic: "Cache?", rounds: 1 });
    store.stop("d1");
    store.notePosted("d1", "a");
    store.notePosted("d1", "b");
    expect(await open(store, [])).not.toHaveBeenCalled();
  });
});
