import { describe, expect, it } from "vitest";
import { chatMayOfferMemoryKeeper } from "./memoryKeeperOffer";

const solo = { lane: false, teamRole: null, teamOpen: false } as const;

describe("which chats may ask to keep the memory", () => {
  it("asks in a chat the user works in themselves", () => {
    expect(chatMayOfferMemoryKeeper({}, solo)).toBe(true);
    // Once a team it started is over, it may ask again.
    expect(chatMayOfferMemoryKeeper({}, { ...solo, teamRole: "origin" })).toBe(
      true,
    );
  });

  it("never asks in a lane, partner, worker or Inbox chat", () => {
    expect(chatMayOfferMemoryKeeper({}, { ...solo, lane: true })).toBe(false);
    expect(chatMayOfferMemoryKeeper({}, { ...solo, teamRole: "member" })).toBe(
      false,
    );
    expect(
      chatMayOfferMemoryKeeper({ orchestrationLeadId: "lead" }, solo),
    ).toBe(false);
    expect(chatMayOfferMemoryKeeper({ inboxAsk: {} as never }, solo)).toBe(
      false,
    );
  });

  it("waits while a team the chat started is running", () => {
    expect(
      chatMayOfferMemoryKeeper(
        {},
        { ...solo, teamRole: "origin", teamOpen: true },
      ),
    ).toBe(false);
  });
});
