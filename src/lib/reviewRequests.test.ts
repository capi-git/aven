import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubWorkItem } from "./githubTasks";

const github = vi.hoisted(() => ({
  repos: {} as Record<string, string>,
  items: {} as Record<string, GithubWorkItem[] | Error>,
  calls: [] as { cwd: string; search: string; kind: string }[],
}));

vi.mock("./githubTasks", async () => {
  const actual =
    await vi.importActual<typeof import("./githubTasks")>("./githubTasks");
  return {
    ...actual,
    githubRepo: async (cwd: string) => {
      const repo = github.repos[cwd];
      if (repo === undefined) throw new Error("not a GitHub repository");
      return repo;
    },
    listGithubWorkItems: async (
      cwd: string,
      query: { search: string; kind: string },
    ) => {
      github.calls.push({ cwd, search: query.search, kind: query.kind });
      const result = github.items[cwd] ?? [];
      if (result instanceof Error) throw result;
      return result;
    },
  };
});

import {
  REVIEW_REQUESTS_CACHE_MS,
  clearReviewRequestsCache,
  loadReviewRequests,
  peekReviewRequests,
} from "./reviewRequests";

const pr = (number: number, patch: Partial<GithubWorkItem> = {}) =>
  ({
    kind: "pr",
    number,
    title: `PR ${number}`,
    url: `https://github.com/me/app/pull/${number}`,
    state: "OPEN",
    updatedAt: `2026-10-1${number}T00:00:00Z`,
    labels: [],
    assignees: [],
    draft: false,
    repo: "me/app",
    ...patch,
  }) as GithubWorkItem;

beforeEach(() => {
  clearReviewRequestsCache();
  github.repos = {};
  github.items = {};
  github.calls = [];
});

afterEach(() => vi.useRealTimers());

describe("pull requests waiting for review", () => {
  it("asks each GitHub repository once for open PRs requesting the user's review", async () => {
    github.repos = {
      "/a": "me/app",
      "/a-copy": "me/app",
      "/site": "me/site",
      "/local": "",
    };
    github.items = {
      "/a": [pr(1), pr(3)],
      "/site": [
        pr(2, { repo: "me/site", url: "https://github.com/me/site/pull/2" }),
      ],
    };
    const items = await loadReviewRequests([
      "/a",
      "/a-copy",
      "/site",
      "/local",
      "/gone",
    ]);
    expect(github.calls).toEqual([
      { cwd: "/a", search: "review-requested:@me", kind: "pr" },
      { cwd: "/site", search: "review-requested:@me", kind: "pr" },
    ]);
    expect(items.map((item) => `${item.repo}#${item.number}`)).toEqual([
      "me/app#3",
      "me/site#2",
      "me/app#1",
    ]);
  });

  it("reads as none when GitHub is not signed in", async () => {
    github.repos = { "/a": "me/app" };
    github.items = { "/a": new Error("gh: not logged in") };
    expect(await loadReviewRequests(["/a"])).toEqual([]);
  });

  it("asks at most once per ten minutes for the same projects, and never twice at once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    github.repos = { "/a": "me/app" };
    github.items = { "/a": [pr(1)] };
    const [first, second] = await Promise.all([
      loadReviewRequests(["/a"]),
      loadReviewRequests(["/a"]),
    ]);
    expect(first).toBe(second);
    expect(github.calls).toHaveLength(1);
    expect(peekReviewRequests(["/a"])).toBe(first);
    vi.setSystemTime(1_000_000 + REVIEW_REQUESTS_CACHE_MS - 1);
    await loadReviewRequests(["/a"]);
    expect(github.calls).toHaveLength(1);
    // A different workspace asks for its own.
    await loadReviewRequests(["/a", "/b"]);
    expect(github.calls).toHaveLength(2);
    vi.setSystemTime(1_000_000 + REVIEW_REQUESTS_CACHE_MS + 1);
    expect(peekReviewRequests(["/a"])).toBeNull();
  });
});
