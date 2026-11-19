import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  index: vi.fn(),
  pr: vi.fn(),
  checks: vi.fn(),
}));
vi.mock("./fs", () => ({ gitDiffIndex: mocks.index, gitPrStatus: mocks.pr }));
vi.mock("./prChecks", () => ({ gitPrChecks: mocks.checks }));

import {
  clearSharedGitReads,
  SHARE_MS,
  sharedDiffIndex,
  sharedPrChecks,
} from "./sharedGitReads";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  clearSharedGitReads();
});

describe("shared Git reads", () => {
  it("lets callers share a running read and a recent result", async () => {
    let finish!: (value: unknown) => void;
    mocks.index.mockReturnValueOnce(
      new Promise((resolve) => (finish = resolve)),
    );
    const first = sharedDiffIndex("/repo");
    const second = sharedDiffIndex("/repo");
    expect(second).toBe(first);
    finish({ branch: "main" });
    await first;
    expect(sharedDiffIndex("/repo")).toBe(first);
    expect(mocks.index).toHaveBeenCalledTimes(1);
  });

  it("reads again once the result is old, or when a fresh read is asked for", async () => {
    mocks.index.mockResolvedValue({ branch: "main" });
    await sharedDiffIndex("/repo");
    await sharedDiffIndex("/repo", true);
    expect(mocks.index).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(SHARE_MS + 1);
    await sharedDiffIndex("/repo");
    expect(mocks.index).toHaveBeenCalledTimes(3);
  });

  it("joins a read that just started even for a fresh read, not an older one", async () => {
    mocks.index.mockImplementation(() => new Promise(() => {}));
    const first = sharedDiffIndex("/repo");
    expect(sharedDiffIndex("/repo", true)).toBe(first);
    vi.advanceTimersByTime(1_000);
    expect(sharedDiffIndex("/repo", true)).not.toBe(first);
    expect(mocks.index).toHaveBeenCalledTimes(2);
  });

  it("never hands out a failed read again, and keeps copies and PRs apart", async () => {
    mocks.checks.mockRejectedValueOnce(new Error("offline"));
    await expect(sharedPrChecks("/repo", 7)).rejects.toThrow("offline");
    mocks.checks.mockResolvedValue({});
    await sharedPrChecks("/repo", 7);
    await sharedPrChecks("/repo", 8);
    await sharedPrChecks("/other", 7);
    expect(mocks.checks).toHaveBeenCalledTimes(4);
  });
});
