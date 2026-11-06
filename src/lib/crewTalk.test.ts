import { describe, expect, it } from "vitest";
import { parseTalk, talkAnswerText, talkMessage } from "./crewTalk";

const block = (fields: Record<string, unknown>) =>
  `\`\`\`aven-talk\n${JSON.stringify(fields)}\n\`\`\``;

describe("Avos's answer to you", () => {
  it("is what it wrote before the block that ends its reply", () => {
    expect(
      talkAnswerText(
        `Sure.\n\nI'll check them first.\n\n${block({ line: "x" })}`,
      ),
    ).toBe("Sure.\n\nI'll check them first.");
  });

  it("leaves out a block still being written, and its memory notes", () => {
    expect(talkAnswerText("Looking now.\n\n``")).toBe("Looking now.");
    expect(talkAnswerText("Looking now.\n\n```aven-ta")).toBe("Looking now.");
    expect(
      talkAnswerText(
        'Done.\n\n```aven-memory\n{"notes":["x"]}\n```\n\n```aven-talk\n{}\n```',
      ),
    ).toBe("Done.");
  });
});

describe("what Avos's reply can keep", () => {
  it("reads a rule, a goal, a question and a mock-up", () => {
    expect(
      parseTalk(
        `Ok.\n\n${block({
          line: "Saved.",
          remember: "Always use pnpm",
          goal: "Ship sign-up",
          research: "How do others onboard?",
          mockup: "The today screen",
        })}`,
      ),
    ).toMatchObject({
      line: "Saved.",
      remember: "Always use pnpm",
      goal: "Ship sign-up",
      research: "How do others onboard?",
      mockup: "The today screen",
    });
  });

  const brief = (more: Partial<Parameters<typeof talkMessage>[0]> = {}) =>
    talkMessage({
      talk: { from: "you", text: "Always use pnpm", hop: 0 },
      fromName: "You",
      isLead: true,
      others: [],
      mayAsk: false,
      ...more,
    });

  it("offers a rule and the goal only for your own message to Avos", () => {
    expect(brief({ mayKeep: true })).toContain('"remember"');
    expect(brief({ mayKeep: true })).toContain('"goal"');
    expect(brief()).not.toContain('"remember"');
  });

  it("offers the Designer only while Avos has it", () => {
    expect(brief({ mayKeep: true, helpersOn: { mockup: true } })).toContain(
      '"mockup"',
    );
    expect(
      brief({ mayKeep: true, helpersOn: { mockup: false } }),
    ).not.toContain('"mockup"');
  });

  it("always offers the Researcher for a link, even with none on", () => {
    // Avos has no web: a link goes to the Researcher, never back to you as
    // a request for screenshots.
    const yours = brief({ mayKeep: true, helpersOn: { mockup: false } });
    expect(yours).toContain('"research"');
    expect(yours).toContain("You have no web");
    expect(yours).toContain("the Researcher is reading it");
    expect(yours).toContain("Never ask the user for screenshots");
    // Only from your own message.
    expect(brief()).not.toContain('"research"');
  });

  it("asks for a short answer, and never mentions a Board", () => {
    expect(brief()).toContain("a few short sentences");
    expect(brief()).toContain("There is no Board");
    expect(brief().replace("There is no Board", "")).not.toMatch(
      /on the Board/,
    );
  });
});
