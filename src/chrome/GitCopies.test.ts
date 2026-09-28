import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitWorktree } from "../lib/fs";
import { copyName, summarizeCopies } from "./GitCopies";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function copy(overrides: Partial<GitWorktree>): GitWorktree {
  return {
    path: "/copies/x",
    branch: "feature",
    current: false,
    primary: false,
    files: [],
    additions: 0,
    deletions: 0,
    aheadOfDefault: 0,
    behindDefault: 0,
    ...overrides,
  };
}

const file = (relative: string) => ({
  path: `/copies/${relative}`,
  relative,
  status: "modified",
  additions: 1,
  deletions: 0,
  staged: false,
  unstaged: true,
});

afterEach(() => vi.unstubAllGlobals());

describe("other copies", () => {
  it("names copies after their branch or folder", () => {
    expect(copyName({ branch: "fix/race-safety", path: "/a" })).toBe(
      "Race safety",
    );
    expect(copyName({ branch: "aven/race/beecf69588-1", path: "/a" })).toBe(
      "Race copy",
    );
    expect(copyName({ branch: null, path: "/work/tab_groups" })).toBe(
      "Tab groups",
    );
  });

  it("hides the open copy and lists unsaved work first, finished copies last", () => {
    const copies = summarizeCopies([
      copy({ path: "/repo", branch: "main", primary: true }),
      copy({ path: "/open", current: true, files: [file("a.ts")] }),
      copy({ path: "/done", branch: "feat/tab-groups" }),
      copy({ path: "/ahead", branch: "feat/next", aheadOfDefault: 2 }),
      copy({
        path: "/busy",
        branch: "fix/race-safety",
        files: [file("race.rs"), file("race.ts")],
      }),
    ]);
    expect(copies.map((entry) => [entry.name, entry.finished])).toEqual([
      ["Race safety", false],
      ["Next", false],
      ["Main copy", false],
      ["Tab groups", true],
    ]);
  });

  it("names a race lane after its prompt and agent", () => {
    const race = {
      id: "race-1",
      project: "/repo",
      root: "/repo",
      base: "abc",
      prompt: "Try new tab designs\nwith more detail",
      createdAt: 1,
      uncommitted: false,
      untracked: false,
      state: "running",
      lanes: [
        {
          sessionId: "s1",
          harness: "claude",
          model: "opus",
          label: "Claude Code · Opus 5.5",
          path: "/races/race-1/0",
          branch: "aven/race/race-1-0",
        },
      ],
    };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify([race]),
      setItem: vi.fn(),
    });
    const [lane] = summarizeCopies([
      copy({
        path: "/races/race-1/0",
        branch: "aven/race/race-1-0",
        files: [file("a.ts")],
      }),
    ]);
    expect(lane).toMatchObject({
      name: "Try new tab designs",
      detail: "Claude Code · Opus 5.5",
      harness: "claude",
    });
  });
});
