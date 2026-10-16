import { describe, expect, it } from "vitest";
import {
  discussionMascots,
  discussionVoices,
  providerVoiceColor,
  voiceName,
} from "./discussionVoices";
import { PROJECT_MASCOTS } from "./projectMascots";

describe("discussion voices", () => {
  it("names the provider and the model without repeating the provider", () => {
    expect(voiceName({ harness: "claude", model: "Claude Sonnet 5" })).toBe(
      "Claude · Sonnet 5",
    );
    expect(voiceName({ harness: "codex", model: "GPT-5.4" })).toBe(
      "Codex · GPT-5.4",
    );
    expect(voiceName({ harness: "grok", model: "Grok 4.6" })).toBe("Grok 4.6");
    expect(voiceName({ harness: "claude", model: "Default" })).toBe("Claude");
  });

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
      name: "Claude · Sonnet 5",
      persona: "Opened the topic",
      title: "Caching plan",
      color: "#d97757",
    });
    expect(voices.b).toMatchObject({
      name: "Codex · GPT-5",
      persona: "Responding",
      color: "#7a9dff",
    });
  });
});
