import { describe, expect, it } from "vitest";
import { toastAnswerReply, toastAnswers } from "./approvalToast";
import type { UserQuestion, UserQuestionPrompt } from "./userQuestion";

const question = (patch: Partial<UserQuestion> = {}): UserQuestion => ({
  id: "q1",
  prompt: "Ship it now?",
  multiSelect: false,
  allowCustom: true,
  options: [
    { id: "later", label: "Later" },
    { id: "now", label: "Now (Recommended)" },
  ],
  ...patch,
});
const prompt = (...questions: UserQuestion[]): UserQuestionPrompt => ({
  requestId: 4,
  questions,
});

describe("toastAnswers", () => {
  it("offers a simple question's options, the suggestion first", () => {
    const answers = toastAnswers(prompt(question()));
    expect(answers?.options.map((option) => option.id)).toEqual([
      "now",
      "later",
    ]);
    expect(toastAnswerReply(answers!.question, answers!.options[0])).toEqual({
      kind: "answered",
      answers: { q1: ["now"] },
    });
  });

  it("leaves Other to the chat but still offers the rest", () => {
    const answers = toastAnswers(
      prompt(
        question({
          options: [
            { id: "a", label: "A" },
            { id: "other", label: "Other" },
          ],
        }),
      ),
    );
    expect(answers?.options.map((option) => option.id)).toEqual(["a"]);
  });

  it.each([
    ["no question", undefined],
    ["two questions", prompt(question(), question({ id: "q2" }))],
    ["multi-select", prompt(question({ multiSelect: true }))],
    ["a typed answer only", prompt(question({ options: [] }))],
    [
      "five options",
      prompt(
        question({
          options: ["a", "b", "c", "d", "e"].map((id) => ({ id, label: id })),
        }),
      ),
    ],
    [
      "previews to compare",
      prompt(
        question({
          options: [
            { id: "a", label: "A", preview: "[a]" },
            { id: "b", label: "B" },
          ],
        }),
      ),
    ],
  ])("opens the chat for %s", (_, value) => {
    expect(toastAnswers(value)).toBeNull();
  });
});
