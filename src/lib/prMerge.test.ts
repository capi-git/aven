import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ask: vi.fn(),
  merge: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mocks.ask }));
vi.mock("./gitHousekeeping", () => ({ gitPrSquashMerge: mocks.merge }));
vi.mock("./fs", () => ({ notifyGitChanged: mocks.notify }));

import { squashMergeAfterAsking, squashMergeQuestion } from "./prMerge";

describe("squash merge from a card", () => {
  beforeEach(() => {
    mocks.ask.mockReset();
    mocks.merge.mockReset();
    mocks.notify.mockReset();
  });

  it("asks the Checks tab's question", () => {
    expect(squashMergeQuestion(4, "main")).toMatch(
      /^Squash and merge PR #4 into main\?/,
    );
    expect(squashMergeQuestion(4, null)).toContain("into the default branch?");
  });

  it("merges nothing when the person says no", async () => {
    mocks.ask.mockResolvedValue(false);
    await expect(squashMergeAfterAsking("/copy", 4, "main")).resolves.toBe(
      false,
    );
    expect(mocks.merge).not.toHaveBeenCalled();
  });

  it("merges after a yes and tells Git watchers", async () => {
    mocks.ask.mockResolvedValue(true);
    mocks.merge.mockResolvedValue(undefined);
    await expect(squashMergeAfterAsking("/copy", 4, "main")).resolves.toBe(
      true,
    );
    expect(mocks.merge).toHaveBeenCalledWith("/copy", 4);
    expect(mocks.notify).toHaveBeenCalledWith("/copy");
  });

  it("passes a failed merge on to the card", async () => {
    mocks.ask.mockResolvedValue(true);
    mocks.merge.mockRejectedValue(new Error("not mergeable"));
    await expect(squashMergeAfterAsking("/copy", 4, "main")).rejects.toThrow(
      "not mergeable",
    );
    expect(mocks.notify).toHaveBeenCalledWith("/copy");
  });
});
