import { expect, it } from "vitest";
import { requestText } from "./requestText";

it("says what an agent wants approved, as an action where it reads as one", () => {
  expect(requestText("Codex", { kind: "approval", what: "Run npm test" })).toBe(
    "Codex wants to run npm test",
  );
  expect(
    requestText("Claude", {
      kind: "approval",
      what: "npm test",
      tool: "execute",
    }),
  ).toBe("Claude wants to run npm test");
  expect(requestText("Claude", { kind: "approval", what: "Shell" })).toBe(
    "Claude wants your approval: Shell",
  );
  expect(requestText("Claude", { kind: "approval" })).toBe(
    "Claude wants your approval",
  );
});

it("says what an agent asked, or that it asked", () => {
  expect(requestText("Claude", { kind: "question", what: "Which port?" })).toBe(
    "Claude asked: Which port?",
  );
  expect(requestText("Claude", { kind: "question" })).toBe(
    "Claude asked a question",
  );
  expect(
    requestText("Claude", {
      kind: "question",
      what: "Claude Code has a question for you",
    }),
  ).toBe("Claude asked a question");
});

it('leaves out "your" when a run\'s lead decides it', () => {
  expect(
    requestText("Codex", { kind: "approval", what: "npm install", to: "lead" }),
  ).toBe("Codex wants approval: npm install");
});
