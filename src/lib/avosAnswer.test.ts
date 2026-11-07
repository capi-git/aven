import { describe, expect, it } from "vitest";
import { questionToAnswer, type WaitingQuestion } from "./avosAnswer";

const question = (cardId: string, at: number): WaitingQuestion => ({
  key: `${cardId}:${at}`,
  cardId,
  title: cardId,
  who: "Tester",
  at,
});

describe("which question a message in Avos's box answers", () => {
  const waiting = [question("timer", 1), question("quiet", 2)];
  const none = { to: null, picked: null, passed: [] };

  it("answers the newest question that waits", () => {
    expect(questionToAnswer(waiting, none)?.cardId).toBe("quiet");
    expect(questionToAnswer([], none)).toBeNull();
  });

  it("answers the one you picked with Answer while it waits", () => {
    expect(
      questionToAnswer(waiting, { ...none, picked: "timer" })?.cardId,
    ).toBe("timer");
    // Answered meanwhile: back to the newest.
    expect(questionToAnswer(waiting, { ...none, picked: "gone" })?.cardId).toBe(
      "quiet",
    );
  });

  it("goes to a helper you @, never to a card", () => {
    expect(
      questionToAnswer(waiting, { ...none, to: "tester", picked: "timer" }),
    ).toBeNull();
  });

  it("skips a question you set aside, until the card asks again", () => {
    expect(
      questionToAnswer(waiting, { ...none, passed: ["quiet:2"] })?.cardId,
    ).toBe("timer");
    expect(
      questionToAnswer(waiting, { ...none, passed: ["quiet:2", "timer:1"] }),
    ).toBeNull();
    // The same card with a new question waits again.
    expect(
      questionToAnswer([question("timer", 1), question("quiet", 9)], {
        ...none,
        passed: ["quiet:2", "timer:1"],
      })?.cardId,
    ).toBe("quiet");
  });
});
