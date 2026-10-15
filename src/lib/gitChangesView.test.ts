import { describe, expect, it } from "vitest";
import type { GitDiffIndex } from "./fs";
import {
  churnBar,
  filesLabel,
  largestChurn,
  lineTotals,
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
