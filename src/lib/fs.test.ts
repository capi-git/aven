import { describe, expect, it } from "vitest";
import { gitChangeAffects, isCheckoutBlockedByChanges } from "./fs";

describe("gitChangeAffects", () => {
  const repo = "/Users/me/Developer/app";

  it("matches the project, files inside it and folders that contain it", () => {
    expect(gitChangeAffects(repo, repo)).toBe(true);
    expect(gitChangeAffects(`${repo}/`, repo)).toBe(true);
    expect(gitChangeAffects(`${repo}/src/main.ts`, repo)).toBe(true);
    expect(gitChangeAffects("/Users/me/Developer", repo)).toBe(true);
  });

  it("leaves other projects and sibling names alone", () => {
    expect(gitChangeAffects("/Users/me/Developer/site", repo)).toBe(false);
    expect(gitChangeAffects(`${repo}-copy/src`, repo)).toBe(false);
    expect(
      gitChangeAffects("/Users/me/Developer/.worktrees/app/fix", repo),
    ).toBe(false);
  });

  it("treats an unnamed or home-relative change as touching everything", () => {
    expect(gitChangeAffects(null, repo)).toBe(true);
    expect(gitChangeAffects("~/Developer/site", repo)).toBe(true);
  });
});

describe("isCheckoutBlockedByChanges", () => {
  it("detects git's tracked-file checkout error", () => {
    expect(
      isCheckoutBlockedByChanges(
        "error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\nPlease commit your changes or stash them before you switch branches.",
      ),
    ).toBe(true);
  });

  it("detects git's untracked-file checkout error", () => {
    expect(
      isCheckoutBlockedByChanges(
        "error: The following untracked working tree files would be overwritten by checkout:\n\tnew.txt\nPlease move or remove them before you switch branches.",
      ),
    ).toBe(true);
  });

  it("detects the mapped app error", () => {
    expect(
      isCheckoutBlockedByChanges(
        "Your local changes would be overwritten. Commit or stash them first.",
      ),
    ).toBe(true);
  });

  it("ignores unrelated git errors", () => {
    expect(isCheckoutBlockedByChanges("Branch missing not found")).toBe(false);
    expect(isCheckoutBlockedByChanges("Not a git repository")).toBe(false);
  });
});
