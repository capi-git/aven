import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addReviewComment,
  markReviewSent,
  removeReviewComment,
  resetReviewQueueForTest,
  reviewComments,
  setReviewProject,
} from "./reviewQueue";

let stored: Map<string, string>;

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  resetReviewQueueForTest();
});

describe("review queue", () => {
  it("files a comment under the side panel's project, and none without one", () => {
    expect(
      addReviewComment({ path: "a.ts", text: "x", message: "x" }),
    ).toBeNull();
    setReviewProject("/p");
    const added = addReviewComment({
      path: "a.ts",
      startLine: 3,
      endLine: 5,
      text: "Why?",
      message: "Diff comment on a.ts:3",
    })!;
    expect(added).toMatchObject({ project: "/p", path: "a.ts", startLine: 3 });
    expect(reviewComments("/p")).toHaveLength(1);
    expect(reviewComments("/p/")).toHaveLength(1);
    expect(reviewComments("/q")).toHaveLength(0);
    expect(JSON.parse(stored.get("aven.reviewQueue")!)).toHaveLength(1);
  });

  it("moves a sent comment to done, and removes on request", () => {
    setReviewProject("/p");
    const a = addReviewComment({ path: "a.ts", text: "a", message: "a" })!;
    const b = addReviewComment({ path: "b.ts", text: "b", message: "b" })!;
    markReviewSent(a.id, 1000);
    expect(reviewComments("/p").find((c) => c.id === a.id)?.sentAt).toBe(1000);
    removeReviewComment(b.id);
    expect(reviewComments("/p").map((c) => c.id)).toEqual([a.id]);
    resetReviewQueueForTest();
    expect(reviewComments("/p")[0]?.sentAt).toBe(1000);
  });

  it("keeps only the newest fifty done comments of a project", () => {
    setReviewProject("/p");
    for (let i = 0; i < 52; i++) {
      const c = addReviewComment({ path: `${i}`, text: "x", message: "x" })!;
      markReviewSent(c.id, i + 1);
    }
    const done = reviewComments("/p");
    expect(done).toHaveLength(50);
    expect(done.some((c) => c.path === "0")).toBe(false);
  });
});
