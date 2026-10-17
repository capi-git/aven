// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatReviewsSnapshot,
  forgetChatReview,
  noteChatReview,
  subscribeChatReviews,
} from "./chatReview";

let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const file = (relative: string, additions: number, deletions: number) => ({
  relative,
  additions,
  deletions,
});

const note = (
  files: ReturnType<typeof file>[],
  now: number,
  sessionId = "s1",
) =>
  noteChatReview(
    {
      sessionId,
      project: "/work/site",
      cwd: "/work/site",
      files,
      title: "Fix sign-in",
      harness: "claude",
    },
    now,
  );

describe("chat reviews", () => {
  it("keeps counts and a few names, never contents", () => {
    note([file("src/a.ts", 3, 1), file("src/b.ts", 2, 0)], 100);
    expect(chatReviewsSnapshot().s1).toEqual({
      sessionId: "s1",
      project: "/work/site",
      cwd: "/work/site",
      at: 100,
      files: 2,
      additions: 5,
      deletions: 1,
      names: ["a.ts", "b.ts"],
      title: "Fix sign-in",
      harness: "claude",
    });
  });

  it("keeps the time while the changes stay the same, and moves it for new ones", () => {
    note([file("a.ts", 3, 1)], 100);
    const first = chatReviewsSnapshot();
    note([file("a.ts", 3, 1)], 200);
    // Nothing changed: the same snapshot, so no reader re-renders.
    expect(chatReviewsSnapshot()).toBe(first);
    note([file("a.ts", 5, 1)], 300);
    expect(chatReviewsSnapshot().s1?.at).toBe(300);
  });

  it("clears a review once its changes are kept, undone or gone", () => {
    const heard = vi.fn();
    const stop = subscribeChatReviews(heard);
    note([file("a.ts", 1, 0)], 100);
    note([], 200);
    expect(chatReviewsSnapshot().s1).toBeUndefined();
    expect(heard).toHaveBeenCalledTimes(2);
    note([file("a.ts", 1, 0)], 300);
    forgetChatReview("s1");
    expect(chatReviewsSnapshot()).toEqual({});
    stop();
  });

  it("is saved, read back after a restart and shared with other windows", async () => {
    note([file("a.ts", 1, 0)], 100);
    const raw = values.get("aven.chatReviews.v1");
    expect(raw).toBeTruthy();
    vi.resetModules();
    const fresh = await import("./chatReview");
    expect(fresh.chatReviewsSnapshot().s1).toMatchObject({ files: 1, at: 100 });

    // Another window's write arrives as a storage event.
    const heard = vi.fn();
    const stop = fresh.subscribeChatReviews(heard);
    values.set(
      "aven.chatReviews.v1",
      JSON.stringify({
        version: 1,
        records: [
          {
            sessionId: "s2",
            project: "/p",
            cwd: "/p",
            at: 5,
            files: 2,
            additions: 1,
            deletions: 1,
            names: [],
          },
          { sessionId: "bad", files: 1 },
        ],
      }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: "aven.chatReviews.v1" }),
    );
    expect(heard).toHaveBeenCalledOnce();
    expect(Object.keys(fresh.chatReviewsSnapshot())).toEqual(["s2"]);
    stop();
  });
});
