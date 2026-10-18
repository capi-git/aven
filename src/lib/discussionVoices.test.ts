import { describe, expect, it } from "vitest";
import {
  discussionMascots,
  discussionVoices,
  providerVoiceColor,
  teamMascots,
} from "./discussionVoices";
import { PROJECT_MASCOTS } from "./projectMascots";

describe("discussion voices", () => {
  it("colours Claude coral and Codex blue, and others neutral", () => {
    expect(providerVoiceColor("claude")).toBe("#d97757");
    expect(providerVoiceColor("codex")).toBe("#7a9dff");
    expect(providerVoiceColor("cursor")).toContain("--color-content");
  });

  it("gives each chat a stable mascot, distinct from its partner's", () => {
    const names = new Set(PROJECT_MASCOTS.map((mascot) => mascot.name));
    const first = discussionMascots("chat-a", "chat-b");
    expect(names.has(first.a)).toBe(true);
    expect(names.has(first.b)).toBe(true);
    expect(first.a).not.toBe(first.b);
    expect(discussionMascots("chat-a", "chat-b")).toEqual(first);
    // The same chat keeps its mascot against another partner.
    expect(discussionMascots("chat-a", "chat-c").a).toBe(first.a);
    // Two chats that hash alike still look different.
    for (let index = 0; index < 40; index += 1) {
      const pick = discussionMascots(`x${index}`, `x${index}`);
      expect(pick.a).not.toBe(pick.b);
    }
  });

  it("gives every member of a team of up to twelve its own critter", () => {
    const names = new Set(PROJECT_MASCOTS.map((mascot) => mascot.name));
    for (let size = 1; size <= 12; size += 1) {
      for (const prefix of ["run", "race", "x"]) {
        const ids = Array.from({ length: size }, (_, i) => `${prefix}-${i}`);
        const picks = teamMascots(ids);
        expect(picks).toHaveLength(size);
        expect(new Set(picks).size).toBe(size);
        for (const pick of picks) expect(names.has(pick)).toBe(true);
        // Each member keeps its critter as the team grows.
        expect(teamMascots([...ids, `${prefix}-extra`]).slice(0, size)).toEqual(
          picks,
        );
      }
    }
    // Members whose ids hash alike still look different.
    expect(new Set(teamMascots(Array(12).fill("same"))).size).toBe(12);
  });

  it("tags who opened the topic and who responds", () => {
    const voices = discussionVoices({
      a: {
        sessionId: "chat-a",
        harness: "claude",
        model: "Claude Sonnet 5",
        title: "Caching plan",
        cwd: "/work",
      },
      b: {
        sessionId: "chat-b",
        harness: "codex",
        model: "GPT-5",
        title: "Review",
        cwd: "/work",
      },
    });
    expect(voices.a).toMatchObject({
      name: "Claude",
      fullName: "Claude Code · Sonnet 5",
      persona: "Opened the topic",
      title: "Caching plan",
      color: "#d97757",
    });
    expect(voices.b).toMatchObject({
      name: "Codex",
      fullName: "Codex · GPT-5",
      persona: "Joined the topic",
      color: "#7a9dff",
    });
  });

  it("adds the model when both sides are the same app", () => {
    const voices = discussionVoices({
      a: {
        sessionId: "chat-a",
        harness: "claude",
        model: "Claude Opus 4.6",
        title: "Plan",
        cwd: "/work",
      },
      b: {
        sessionId: "chat-b",
        harness: "claude",
        model: "Claude Sonnet 5",
        title: "Review",
        cwd: "/work",
      },
    });
    expect(voices.a.name).toBe("Claude Opus 4.6");
    expect(voices.b.name).toBe("Claude Sonnet 5");
  });
});
