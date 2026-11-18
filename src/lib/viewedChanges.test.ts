import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitChangedFile } from "./fs";
import {
  changeVersion,
  isViewed,
  markViewed,
  pruneViewed,
  resetViewedChangesForTest,
  toggleViewed,
  viewedIn,
} from "./viewedChanges";

let stored: Map<string, string>;

function file(relative: string, additions = 1): GitChangedFile {
  return {
    path: `/p/${relative}`,
    relative,
    status: "modified",
    additions,
    deletions: 0,
    staged: false,
    unstaged: true,
  };
}

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  resetViewedChangesForTest();
});

describe("viewed changes", () => {
  it("keeps a mark per folder and file until the change itself changes", () => {
    markViewed("/p", file("a.ts"));
    expect(isViewed(viewedIn("/p"), file("a.ts"))).toBe(true);
    expect(isViewed(viewedIn("/q"), file("a.ts"))).toBe(false);
    expect(isViewed(viewedIn("/p"), file("a.ts", 4))).toBe(false);
    expect(changeVersion(file("a.ts"))).toBe("modified:1:0");
  });

  it("is kept under an aven. key and read back after a restart", () => {
    markViewed("/p", file("a.ts"));
    expect(JSON.parse(stored.get("aven.viewedChanges")!)).toEqual({
      "/p": { "a.ts": "modified:1:0" },
    });
    resetViewedChangesForTest();
    expect(isViewed(viewedIn("/p"), file("a.ts"))).toBe(true);
  });

  it("toggles, and forgets files that are no longer changed", () => {
    toggleViewed("/p", file("a.ts"));
    toggleViewed("/p", file("b.ts"));
    toggleViewed("/p", file("b.ts"));
    expect(viewedIn("/p")).toEqual({ "a.ts": "modified:1:0" });
    markViewed("/p", file("c.ts"));
    pruneViewed("/p", [file("c.ts")]);
    expect(viewedIn("/p")).toEqual({ "c.ts": "modified:1:0" });
  });

  it("reads broken storage as no marks", () => {
    stored.set("aven.viewedChanges", "{broken");
    resetViewedChangesForTest();
    expect(viewedIn("/p")).toBeUndefined();
  });
});
