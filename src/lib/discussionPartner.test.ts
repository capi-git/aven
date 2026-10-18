import { describe, expect, it } from "vitest";
import { bestDiscussionAgent } from "./discussionPartner";
import type { HarnessId } from "./session";

const deps = (installed: HarnessId[]) => ({
  installed: (id: HarnessId) => installed.includes(id),
  visible: () => true,
  probed: true,
  model: (id: HarnessId) => `${id}:usual`,
});

describe("Discuss's default partner", () => {
  it("is a new chat with the best other agent", () => {
    const both = deps(["claude", "codex", "cursor"]);
    expect(bestDiscussionAgent("claude", both)).toEqual({
      harness: "codex",
      model: "codex:usual",
    });
    expect(bestDiscussionAgent("codex", both)).toEqual({
      harness: "claude",
      model: "claude:usual",
    });
    expect(bestDiscussionAgent("cursor", both)?.harness).toBe("claude");
  });

  it("falls back to this agent alone, or none", () => {
    expect(bestDiscussionAgent("claude", deps(["claude"]))).toEqual({
      harness: "claude",
      model: "claude:usual",
    });
    expect(bestDiscussionAgent("claude", deps([]))).toBeNull();
  });

  it("leaves out agents hidden from the picker", () => {
    expect(
      bestDiscussionAgent("claude", {
        ...deps(["claude", "codex", "cursor"]),
        visible: (id) => id !== "codex",
      })?.harness,
    ).toBe("cursor");
  });
});
