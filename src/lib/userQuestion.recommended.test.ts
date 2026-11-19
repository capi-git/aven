import { describe, expect, it } from "vitest";
import { codexUserInputQuestions } from "./harness/codexProtocol";
import {
  buildQuestionReply,
  optionDisplayLabel,
  optionIsRecommended,
  questionsFromUnknown,
  recommendedOption,
  selectedAnswerLabels,
  suggestedAnswers,
  type UserQuestionOption,
} from "./userQuestion";

const option = (label: string, extra: Partial<UserQuestionOption> = {}) => ({
  id: label,
  label,
  ...extra,
});

describe("recommended options", () => {
  it.each([
    ["Generated (Recommended)", "Generated"],
    ["Generated (recommended)", "Generated"],
    ["Generated [Recommended]", "Generated"],
    ["(Recommended) Generated", "Generated"],
    ["Generated - Recommended", "Generated"],
    ["Generated — recommended", "Generated"],
    ["Generated: recommended", "Generated"],
  ])("finds the marker in %j", (label, clean) => {
    expect(optionIsRecommended(option(label))).toBe(true);
    expect(optionDisplayLabel(option(label))).toBe(clean);
  });

  it.each([
    "Generated",
    "Not recommended (slow)",
    "Recommended",
    "Use the recommended settings",
  ])("leaves %j alone", (label) => {
    expect(optionIsRecommended(option(label))).toBe(false);
    expect(optionDisplayLabel(option(label))).toBe(label);
  });

  it("honours a recommended field over the label", () => {
    expect(optionIsRecommended(option("Fast", { recommended: true }))).toBe(
      true,
    );
    expect(
      optionIsRecommended(option("Fast (Recommended)", { recommended: false })),
    ).toBe(false);
  });

  it("parses the marker, a recommended field and a preview from Claude", () => {
    const [question] = questionsFromUnknown({
      questions: [
        {
          question: "Which layout?",
          options: [
            { label: "Grid", preview: "\n  ┌──┬──┐\n  │  │  │\n  └──┴──┘\n" },
            { label: "List (Recommended)", description: "One column" },
            { label: "Cards", recommended: true },
          ],
        },
      ],
    });
    expect(question.options).toEqual([
      { id: "Grid", label: "Grid", preview: "  ┌──┬──┐\n  │  │  │\n  └──┴──┘" },
      {
        id: "List (Recommended)",
        label: "List (Recommended)",
        description: "One column",
        recommended: true,
      },
      { id: "Cards", label: "Cards", recommended: true },
    ]);
    expect(recommendedOption(question)?.id).toBe("List (Recommended)");
  });

  it("preselects the suggestion for single choice only, and replies with the original label", () => {
    const questions = questionsFromUnknown({
      questions: [
        {
          question: "Which layout?",
          options: [{ label: "Grid" }, { label: "List (Recommended)" }],
        },
        {
          question: "Which parts?",
          multiSelect: true,
          options: [{ label: "Header (Recommended)" }, { label: "Footer" }],
        },
      ],
    });
    const answers = suggestedAnswers(questions);
    expect(answers).toEqual({ "Which layout?": ["List (Recommended)"] });
    const reply = buildQuestionReply(questions, answers);
    if (reply.kind !== "answered") throw new Error("expected answers");
    expect(selectedAnswerLabels(questions[0], reply)).toEqual([
      "List (Recommended)",
    ]);
  });

  it("keeps Codex ids and reply labels while showing a clean label", () => {
    const [question] = codexUserInputQuestions({
      questions: [
        {
          id: "q1",
          question: "Which?",
          options: [{ label: "Fast (Recommended)" }, { label: "Safe" }],
        },
      ],
    });
    const [first] = question.options;
    expect(first.id).toBe("Fast (Recommended)");
    expect(first.label).toBe("Fast (Recommended)");
    expect(optionDisplayLabel(first)).toBe("Fast");
    expect(suggestedAnswers([question])).toEqual({
      q1: ["Fast (Recommended)"],
    });
  });
});
