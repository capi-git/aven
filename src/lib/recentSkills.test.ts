import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadRecentSkills,
  MAX_RECENT_SKILLS,
  rememberRecentSkills,
} from "./recentSkills";

const KEY = "aven.recentSkills.v1";
let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recent skills", () => {
  it("keeps a most-recent-first list per project", () => {
    rememberRecentSkills("/work/site", ["review-pr"]);
    rememberRecentSkills("/work/site", ["deploy"]);
    rememberRecentSkills("/work/site/", ["review-pr"]);
    rememberRecentSkills("/work/api", ["standup"]);
    expect(loadRecentSkills("/work/site")).toEqual(["review-pr", "deploy"]);
    expect(loadRecentSkills("/work/api")).toEqual(["standup"]);
    expect(loadRecentSkills("/work/other")).toEqual([]);
  });

  it("puts several skills from one message first, in order, and caps the list", () => {
    for (let index = 0; index < 12; index++) {
      rememberRecentSkills("/p", [`skill-${index}`]);
    }
    const next = rememberRecentSkills("/p", ["a", "b", "skill-11"]);
    expect(next.slice(0, 3)).toEqual(["a", "b", "skill-11"]);
    expect(next).toHaveLength(MAX_RECENT_SKILLS);
    expect(loadRecentSkills("/p")).toEqual(next);
  });

  it("forgets the least recently used projects", () => {
    for (let index = 0; index < 45; index++) {
      rememberRecentSkills(`/p/${index}`, ["skill"]);
    }
    rememberRecentSkills("/p/0", ["skill"]);
    expect(loadRecentSkills("/p/0")).toEqual(["skill"]);
    expect(loadRecentSkills("/p/5")).toEqual([]);
    expect(loadRecentSkills("/p/44")).toEqual(["skill"]);
    expect(Object.keys(JSON.parse(values.get(KEY)!))).toHaveLength(40);
  });

  it("ignores stored values it does not understand", () => {
    values.set(KEY, "{not json");
    expect(loadRecentSkills("/p")).toEqual([]);
    values.set(KEY, JSON.stringify(["/p"]));
    expect(loadRecentSkills("/p")).toEqual([]);
    values.set(
      KEY,
      JSON.stringify({ "/p": ["ok", 3, "", null, "x".repeat(500)], "/q": 7 }),
    );
    expect(loadRecentSkills("/p")).toEqual(["ok"]);
    expect(rememberRecentSkills("/q", ["new"])).toEqual(["new"]);
  });

  it("still returns the new order when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(rememberRecentSkills("/p", ["review-pr"])).toEqual(["review-pr"]);
    expect(loadRecentSkills("/p")).toEqual([]);
  });
});
