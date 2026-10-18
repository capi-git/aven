import { describe, expect, it } from "vitest";
import {
  DiscussionStore,
  DISCUSSIONS_KEY,
  discussionBuildSent,
  planDiscussions,
  readDiscussion,
  SUMMARY_ITEM_LIMIT,
  type DiscussionParty,
  type DiscussionSummary,
} from "./discussions";

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
  cwd: "/work/api",
};

const DONE: DiscussionSummary = {
  status: "done",
  agreed: ["Cache by URL"],
  open: ["Errors"],
  model: "Claude Haiku 4.5",
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
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

describe("a discussion's build buttons", () => {
  it("marks each side's plan as sent once, for every window and a restart", () => {
    const storage = memoryStorage();
    const store = new DiscussionStore(storage, "main");
    store.start({ id: "d1", a: A, b: B, topic: "Topic", rounds: 1 });
    // Only a finished discussion has a plan to build.
    store.markBuilt("d1", "b");
    expect(store.get("d1")?.built).toBeUndefined();
    store.markDelivered("d1");
    store.settle("d1", 0, { status: "completed", text: "A" });
    store.markDelivered("d1");
    store.settle("d1", 1, { status: "completed", text: "B" });
    store.markBuilt("d1", "b");
    const ended = store.get("d1")!;
    expect(discussionBuildSent(ended, "b")).toBe(true);
    expect(discussionBuildSent(ended, "a")).toBe(false);
    // Another window, or a restart, reads the same.
    const other = new DiscussionStore(storage, "other");
    expect(discussionBuildSent(other.get("d1")!, "b")).toBe(true);
    // Continuing the discussion moves past that ending.
    expect(
      discussionBuildSent({ ...ended, settled: ended.settled + 2 }, "b"),
    ).toBe(false);
    expect(readDiscussion({ ...ended, built: { a: -1, b: 99 } })?.built).toBe(
      undefined,
    );
  });
});

describe("a discussion's wrap-up", () => {
  it("is asked for once when it ends normally, never when stopped", () => {
    const store = new DiscussionStore(memoryStorage(), "main");
    complete(store);
    expect(store.get("d1")?.summary).toEqual({ status: "pending" });
    store.start({
      id: "d2",
      a: { ...A, sessionId: "x" },
      b: { ...B, sessionId: "y" },
      topic: "T",
      rounds: 2,
    });
    store.stop("d2");
    expect(store.get("d2")?.summary).toBeUndefined();
    expect(
      planDiscussions(store.snapshot(), "main", [], new Set()).filter(
        (action) => action.kind === "summarise",
      ),
    ).toEqual([{ kind: "summarise", id: "d1" }]);
  });

  it("runs once: only the first claim wins, and the result is cached", () => {
    const storage = memoryStorage();
    const store = new DiscussionStore(storage, "main", () => 9);
    complete(store);
    expect(store.claimSummary("d1")).toBe(true);
    expect(store.claimSummary("d1")).toBe(false);
    expect(store.get("d1")?.summary).toEqual({ status: "running", since: 9 });
    // Running: nothing more to ask for.
    expect(
      planDiscussions(store.snapshot(), "main", [], new Set()).some(
        (action) => action.kind === "summarise",
      ),
    ).toBe(false);
    store.finishSummary("d1", 2, DONE);
    expect(store.get("d1")?.summary).toEqual(DONE);
    expect(store.claimSummary("d1")).toBe(false);
    // A second answer for the same discussion changes nothing.
    store.finishSummary("d1", 2, { status: "failed" });
    expect(store.get("d1")?.summary).toEqual(DONE);
    // Kept with it, through the notes and a reload.
    store.notePosted("d1", "a");
    store.notePosted("d1", "b");
    expect(new DiscussionStore(storage, "main").get("d1")?.summary).toEqual(
      DONE,
    );
  });

  it("is dropped when the discussion continues before it is written", () => {
    const store = new DiscussionStore(memoryStorage(), "main");
    complete(store);
    store.claimSummary("d1");
    expect(store.interject("d1", "One more round.")).toBeNull();
    store.finishSummary("d1", 2, DONE);
    expect(store.get("d1")?.summary).toBeUndefined();
    expect(store.get("d1")?.status).toBe("active");
  });

  it("is written again once when its window went away mid-way", () => {
    const storage = memoryStorage();
    const store = new DiscussionStore(storage, "main");
    complete(store);
    store.claimSummary("d1");
    const reloaded = new DiscussionStore(storage, "main");
    expect(reloaded.get("d1")?.summary).toEqual({ status: "pending" });
    // Another window's running summary is left to it.
    const elsewhere = new DiscussionStore(storage, "other");
    expect(elsewhere.claimSummary("d1")).toBe(false);
  });

  it("is only claimed by the window that owns the discussion", () => {
    const storage = memoryStorage();
    complete(new DiscussionStore(storage, "main"));
    const other = new DiscussionStore(storage, "other");
    expect(other.claimSummary("d1")).toBe(false);
    expect(planDiscussions(other.snapshot(), "other", [], new Set())).toEqual(
      [],
    );
  });

  it("reads back only a well-formed summary, kept small", () => {
    const store = new DiscussionStore(memoryStorage(), "main");
    complete(store);
    store.claimSummary("d1");
    store.finishSummary("d1", 2, DONE);
    const saved = { ...store.get("d1")! };
    expect(readDiscussion(saved)?.summary).toEqual(DONE);
    expect(
      readDiscussion({
        ...saved,
        summary: {
          status: "done",
          agreed: Array.from({ length: 9 }, (_, index) => `Item ${index}`),
          open: [42, "", "x".repeat(999), "Fine"],
          model: "M",
        },
      })?.summary,
    ).toEqual({
      status: "done",
      agreed: Array.from(
        { length: SUMMARY_ITEM_LIMIT },
        (_, index) => `Item ${index}`,
      ),
      open: ["Fine"],
      model: "M",
    });
    expect(
      readDiscussion({ ...saved, summary: { status: "done", agreed: "x" } })
        ?.summary,
    ).toBeUndefined();
    expect(
      readDiscussion({ ...saved, summary: { status: "nonsense" } })?.summary,
    ).toBeUndefined();
    // Only an ended discussion keeps one.
    expect(
      readDiscussion({ ...saved, status: "active", summary: DONE })?.summary,
    ).toBeUndefined();
    expect(JSON.stringify(saved).length).toBeLessThan(1_500);
    expect(DISCUSSIONS_KEY).toBe("aven.discussions");
  });
});
