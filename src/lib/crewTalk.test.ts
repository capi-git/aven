import { describe, expect, it } from "vitest";
import { jobReport, parseTalk, talkAnswerText, talkMessage } from "./crewTalk";

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
    // What is live now is the Researcher's to check, never the user's.
    expect(yours).toContain("Never tell the user to go and check a page");
    expect(yours).toContain("put the check of the live page under research");
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

describe("a job's report to Avos", () => {
  it("says what came of it, in its helpers' words, as data", () => {
    const text = jobReport({
      title: "Tab drag",
      outcome: { ready: 2 },
      builder: "Builder",
      checker: "Checker",
      round: {
        handoff: {
          summary: "Measured the drop spot after the picture moves.",
          howToCheck: [],
          ran: [{ command: "npm test -- tabDrag", ok: true }],
        },
        verdict: {
          pass: true,
          summary: "Drags land where they should.",
          mustFix: [],
          later: [],
          ran: [],
        },
        change: {
          base: "b",
          hash: "h",
          files: 2,
          additions: 40,
          deletions: 14,
          paths: [],
        },
      },
    });
    expect(text.split("\n")).toEqual([
      "“Tab drag” is ready, after round 2.",
      "Builder: Measured the drop spot after the picture moves.",
      "Checker: Drags land where they should.",
      "Ran: npm test -- tabDrag (passed).",
      "Changed 2 files (+40 −14).",
    ]);
    expect(
      jobReport({
        title: "Tab drag",
        outcome: { stopped: "It used all 3 rounds." },
        builder: "Builder",
        checker: "Checker",
      }),
    ).toBe("“Tab drag” stopped: It used all 3 rounds.");
  });

  it("asks Avos to say it briefly, with no cards, jobs or rules", () => {
    const prompt = talkMessage({
      talk: {
        from: "checker",
        text: "“Tab drag” is ready.",
        hop: 3,
        answer: true,
        report: true,
      },
      fromName: "Checker",
      isLead: true,
      others: [],
      mayAsk: false,
    });
    expect(prompt).toContain("Checker finished a job you handed out.");
    expect(prompt).toContain("Add no cards, jobs or rules for it.");
    expect(prompt).not.toContain("answered what you asked");
  });
});
