import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDiffIndex } from "./fs";
import {
  changeKindFor,
  churnBar,
  discardPrompt,
  filesLabel,
  largestChurn,
  lineTotals,
  loadShowStaging,
  saveShowStaging,
  shortTimeAgo,
  upstreamLabel,
} from "./gitChangesView";

const NOW = Date.UTC(2026, 9, 15, 12);

describe("shortTimeAgo", () => {
  it("counts minutes, hours, days and weeks, then shows a date", () => {
    expect(shortTimeAgo(NOW - 20_000, NOW)).toBe("just now");
    expect(shortTimeAgo(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(shortTimeAgo(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
    expect(shortTimeAgo(NOW - 2 * 86_400_000, NOW)).toBe("2d ago");
    expect(shortTimeAgo(NOW - 15 * 86_400_000, NOW)).toBe("2w ago");
    expect(shortTimeAgo(NOW - 90 * 86_400_000, NOW)).toMatch(/Jul/);
    expect(shortTimeAgo(0, NOW)).toBe("");
  });
});

describe("churn", () => {
  it("sizes bars by the square root against the largest file", () => {
    const files = [
      { additions: 90, deletions: 10 },
      { additions: 25, deletions: 0 },
      { additions: 0, deletions: 0 },
    ];
    const largest = largestChurn(files);
    expect(largest).toBe(100);
    expect(churnBar(files[0], largest)).toEqual({ size: 1, added: 0.9 });
    expect(churnBar(files[1], largest)).toEqual({ size: 0.5, added: 1 });
    expect(churnBar(files[2], largest)).toBeNull();
    // Tiny changes still show a sliver.
    expect(churnBar({ additions: 1, deletions: 0 }, 10_000)?.size).toBe(0.12);
    expect(lineTotals(files)).toEqual({ additions: 115, deletions: 10 });
  });
});

describe("labels", () => {
  const index: GitDiffIndex = {
    branch: "feature",
    files: [],
    additions: 0,
    deletions: 0,
    remote: "origin",
    upstream: "origin/feature",
    defaultBranch: "main",
    ahead: 0,
    behind: 0,
    aheadOfDefault: 0,
  };

  it("says where a branch stands", () => {
    expect(upstreamLabel(index)).toBe("Up to date with origin/feature");
    expect(upstreamLabel({ ...index, ahead: 2 })).toBe("2 to push");
    expect(upstreamLabel({ ...index, ahead: 1, behind: 3 })).toBe(
      "1 to push · 3 to pull",
    );
    expect(upstreamLabel({ ...index, upstream: null })).toBe(
      "Not on origin yet",
    );
    expect(upstreamLabel({ ...index, remote: null })).toBe("Local only");
    expect(upstreamLabel({ ...index, branch: null })).toBe("No branch");
    expect(filesLabel(1)).toBe("1 file");
    expect(filesLabel(3)).toBe("3 files");
  });
});

describe("staging toggle", () => {
  let stored: Map<string, string>;
  beforeEach(() => {
    stored = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is off until turned on, and remembered", () => {
    expect(loadShowStaging()).toBe(false);
    saveShowStaging(true);
    expect(stored.get("aven.changesStaging")).toBe("1");
    expect(loadShowStaging()).toBe(true);
    saveShowStaging(false);
    expect(loadShowStaging()).toBe(false);
  });

  it("stays off when storage can't be read", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadShowStaging()).toBe(false);
    expect(() => saveShowStaging(true)).not.toThrow();
  });
});

describe("single list", () => {
  const file = (
    relative: string,
    status: string,
    staged: boolean,
    unstaged = !staged,
  ) => ({ relative, status, staged, unstaged });

  it("opens a file's newest edits, or its staged change when that is all", () => {
    expect(changeKindFor({ unstaged: true })).toBe("unstaged");
    expect(changeKindFor({ unstaged: false })).toBe("staged");
  });

  it("asks before discarding, naming staged changes the single list drops", () => {
    expect(discardPrompt([], true)).toBeNull();
    expect(
      discardPrompt([file("src/new.ts", "untracked", false)], true),
    ).toEqual({ message: "Delete untracked file new.ts?", okLabel: "Delete" });
    expect(discardPrompt([file("src/a.ts", "added", true)], true)).toEqual({
      message: "Delete new file a.ts? This cannot be undone.",
      okLabel: "Delete",
    });
    expect(
      discardPrompt([file("src/a.ts", "modified", true, true)], true),
    ).toEqual({
      message:
        "Discard all changes in a.ts, including staged changes? This cannot be undone.",
      okLabel: "Discard",
    });
    expect(discardPrompt([file("a.ts", "modified", false)], true)).toEqual({
      message: "Discard changes in a.ts? This cannot be undone.",
      okLabel: "Discard",
    });
    const two = [
      file("a.ts", "modified", true),
      file("b.ts", "deleted", false),
    ];
    expect(discardPrompt(two, true)?.message).toBe(
      "Discard all changes in 2 files, including staged changes? This cannot be undone.",
    );
    expect(discardPrompt([two[1], two[1]], true)?.message).toBe(
      "Discard all changes in 2 files? This cannot be undone.",
    );
  });

  it("keeps the Changes section's wording, which leaves staged changes alone", () => {
    expect(
      discardPrompt([file("a.ts", "modified", true, true)], false),
    ).toEqual({
      message: "Discard changes in a.ts? This cannot be undone.",
      okLabel: "Discard",
    });
    expect(
      discardPrompt(
        [file("a.ts", "modified", false), file("b.ts", "modified", false)],
        false,
      )?.message,
    ).toBe("Discard all unstaged changes in 2 files? This cannot be undone.");
  });
});
