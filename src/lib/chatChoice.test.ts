import { describe, expect, it } from "vitest";
import {
  chatChoiceDetail,
  chatChoiceTitle,
  chatLastUsedAt,
} from "./chatChoice";
import { newSession, type Block, type Session } from "./session";

const user = (text: string, extra: Partial<Block> = {}): Block => ({
  id: crypto.randomUUID(),
  role: "user",
  text,
  ...extra,
});

const chat = (patch: Partial<Session>): Session => ({
  ...newSession("claude", "/work/site"),
  ...patch,
});

describe("chats where you pick one", () => {
  it("names untitled chats by their first message, or as empty", () => {
    expect(chatChoiceTitle(chat({ title: "claude · Login fix" }))).toBe(
      "Login fix",
    );
    expect(
      chatChoiceTitle(
        chat({ blocks: [user("  \n"), user("Add dark mode\nand tests")] }),
      ),
    ).toBe("Add dark mode");
    expect(chatChoiceTitle(chat({}))).toBe("Empty chat");
    const long =
      "Make the onboarding flow remember where you left off, then send a recap";
    expect(chatChoiceTitle(chat({ blocks: [user(long)] }))).toBe(
      "Make the onboarding flow remember where you left off, then…",
    );
  });

  it("knows when a chat was last used", () => {
    expect(chatLastUsedAt(chat({}))).toBeUndefined();
    expect(
      chatLastUsedAt(
        chat({
          blocks: [
            user("one", { startedAt: 1_000, durationMs: 500 }),
            user("two", { startedAt: 5_000, durationMs: 2_000 }),
            user("steer"),
          ],
        }),
      ),
    ).toBe(7_000);
  });

  it("says where a chat is and when it was used", () => {
    const now = 10 * 3_600_000;
    expect(chatChoiceDetail("site", now - 2 * 3_600_000, now)).toBe(
      "site · 2h ago",
    );
    expect(chatChoiceDetail("site", undefined, now)).toBe("site");
    expect(chatChoiceDetail(undefined, now, now)).toBe("just now");
  });
});
