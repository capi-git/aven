import { describe, expect, it } from "vitest";
import { visibleProjectCwd } from "./visibleProjectCwd";

describe("visibleProjectCwd", () => {
  it("follows the active chat, then the focused file tab, then the project", () => {
    expect(visibleProjectCwd("/work/a", "/work/b", "/work/c")).toBe("/work/a");
    expect(visibleProjectCwd(undefined, "/work/b", "/work/c")).toBe("/work/b");
    expect(visibleProjectCwd(undefined, undefined, "/work/c")).toBe("/work/c");
  });

  it("never lets another open chat decide where a new chat opens", () => {
    // A file tab of project C is in front while the first chat in the list
    // belongs to project A: the new chat belongs to C, where the user is.
    const firstChatCwd = "/work/a";
    const cwd = visibleProjectCwd(undefined, "/work/c", "/work/c");
    expect(cwd).toBe("/work/c");
    expect(cwd).not.toBe(firstChatCwd);
  });
});
