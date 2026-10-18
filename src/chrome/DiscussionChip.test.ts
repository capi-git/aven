import { describe, expect, it } from "vitest";
import type { DiscussionCandidate, DiscussionHost } from "../lib/discussions";
import {
  defaultDiscussionPick,
  discussionChipFitLabel,
  discussionChipLabel,
  partnerChoice,
  type DiscussionPick,
} from "./DiscussionChip";

function host(candidates: DiscussionCandidate[]): DiscussionHost {
  return { options: () => ({ candidates }), start: () => null };
}

const chat = (
  sessionId: string,
  blocked?: DiscussionCandidate["blocked"],
): DiscussionCandidate => ({
  sessionId,
  title: `Chat ${sessionId}`,
  harness: "codex",
  model: "GPT-5",
  cwd: "/work",
  ...(blocked ? { blocked } : {}),
});

describe("Discuss mode's partner", () => {
  it("shortens the chip's words when space is short, never the meaning", () => {
    const pick: DiscussionPick = {
      kind: "chat",
      sessionId: "b",
      harness: "codex",
      model: "GPT-5",
      title: "Review",
    };
    expect(discussionChipFitLabel(pick, 3, "skeptic", "full")).toBe(
      "Discuss with Codex as Skeptic · 3 rounds",
    );
    expect(discussionChipFitLabel(pick, 3, "skeptic", "compact")).toBe(
      "Discuss · Codex · 3",
    );
    expect(
      discussionChipFitLabel(
        { kind: "new", harness: "claude", model: "claude:sonnet-5" },
        4,
        undefined,
        "narrow",
      ),
    ).toBe("Discuss · Claude · 4");
    expect(discussionChipFitLabel(null, 2, undefined, "narrow")).toBe(
      "Discuss · … · 2",
    );
  });

  it("starts with the first chat that can join", () => {
    expect(
      defaultDiscussionPick(host([chat("b", "working"), chat("c")]), "a", null),
    ).toEqual({
      kind: "chat",
      sessionId: "c",
      harness: "codex",
      model: "GPT-5",
      title: "Chat c",
    });
    expect(defaultDiscussionPick(host([chat("b", "queued")]), "a", null)).toBe(
      null,
    );
  });

  it("keeps the chat already picked while it can still join", () => {
    const picked: DiscussionPick = {
      kind: "chat",
      sessionId: "c",
      harness: "codex",
      model: "old name",
      title: "Old title",
    };
    const candidates = [chat("b"), chat("c")];
    expect(defaultDiscussionPick(host(candidates), "a", picked)).toMatchObject({
      sessionId: "c",
      title: "Chat c",
    });
    candidates[1] = chat("c", "discussing");
    expect(defaultDiscussionPick(host(candidates), "a", picked)).toMatchObject({
      sessionId: "b",
    });
    const fresh: DiscussionPick = {
      kind: "new",
      harness: "claude",
      model: "claude:sonnet-5",
    };
    expect(defaultDiscussionPick(host(candidates), "a", fresh)).toBe(fresh);
  });

  it("labels the chip with who and how many rounds", () => {
    expect(discussionChipLabel(null, 3)).toBe("Discuss with … · 3 rounds");
    expect(
      discussionChipLabel(
        {
          kind: "chat",
          sessionId: "b",
          harness: "codex",
          model: "GPT-5",
          title: "Review",
        },
        1,
      ),
    ).toBe("Discuss with Codex · 1 round");
    expect(
      discussionChipLabel(
        { kind: "new", harness: "claude", model: "claude:sonnet-5" },
        6,
      ),
    ).toBe("Discuss with new Claude chat · 6 rounds");
  });

  it("hands the host only who to talk to", () => {
    expect(
      partnerChoice({
        kind: "chat",
        sessionId: "b",
        harness: "codex",
        model: "GPT-5",
        title: "Review",
      }),
    ).toEqual({ kind: "chat", sessionId: "b" });
    expect(
      partnerChoice({ kind: "new", harness: "claude", model: "claude:x" }),
    ).toEqual({ kind: "new", harness: "claude", model: "claude:x" });
  });
});
