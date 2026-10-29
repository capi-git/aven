import { describe, expect, it } from "vitest";
import {
  automationPrompt,
  normalizeAutomationReview,
  parseAutomationReview,
  reviewHeading,
  stripAutomationReview,
} from "./automationReview";

const reply = (json: string) =>
  `Saved the October changelog as a draft.\n\n\`\`\`aven-review\n${json}\n\`\`\``;

describe("automation review cards", () => {
  it("reads the card an agent leaves at the end of its reply", () => {
    const card = parseAutomationReview(
      reply(
        JSON.stringify({
          title: "October changelog",
          summary: "The hero redesign, sign-up and the CI fix.",
          url: "https://framer.com/projects/site",
          action: "Publish",
          message: "Publish the draft now.",
        }),
      ),
      5,
    );
    expect(card).toEqual({
      kind: "publish",
      title: "October changelog",
      summary: "The hero redesign, sign-up and the CI fix.",
      url: "https://framer.com/projects/site",
      action: { label: "Publish", message: "Publish the draft now." },
      status: "open",
      postedAt: 5,
    });
    expect(reviewHeading(card!)).toBe("Ready to publish");
  });

  it("is a review card when its button only opens the link", () => {
    const card = parseAutomationReview(
      reply(
        '{"title":"Preview","url":"https://preview.example.com","action":"Open in Framer"}',
      ),
      1,
    );
    expect(card).toMatchObject({
      kind: "review",
      action: { label: "Open in Framer" },
    });
    expect(reviewHeading(card!)).toBe("Ready to review");
  });

  it("leaves no card for a plain reply, or one it cannot read", () => {
    expect(parseAutomationReview("All tests pass.", 1)).toBeNull();
    expect(parseAutomationReview(reply("{not json"), 1)).toBeNull();
    expect(
      parseAutomationReview(reply('{"summary":"no title"}'), 1),
    ).toBeNull();
    expect(parseAutomationReview(reply("[1, 2]"), 1)).toBeNull();
  });

  it("keeps only web links, and drops a button that does nothing", () => {
    const card = parseAutomationReview(
      reply('{"title":"Draft","url":"file:///etc/passwd","action":"Open"}'),
      1,
    );
    expect(card).toEqual({
      kind: "review",
      title: "Draft",
      summary: "",
      status: "open",
      postedAt: 1,
    });
  });

  it("takes the last block when there are several", () => {
    const text = `${reply('{"title":"First"}')}\n\n${reply('{"title":"Second"}')}`;
    expect(parseAutomationReview(text, 1)?.title).toBe("Second");
  });

  it("leaves the block out of the run's summary", () => {
    expect(stripAutomationReview(reply('{"title":"Draft"}'))).toBe(
      "Saved the October changelog as a draft.",
    );
  });

  it("reads back what was stored, and nothing malformed", () => {
    const stored = {
      kind: "publish",
      title: "Draft",
      summary: "Check it",
      url: "https://example.com/",
      action: { label: "Publish", message: "Go" },
      status: "done",
      postedAt: 3,
      resolvedAt: 4,
    };
    expect(normalizeAutomationReview(stored)).toEqual(stored);
    expect(normalizeAutomationReview({ title: "No time" })).toBeNull();
    expect(
      normalizeAutomationReview({ title: "Odd", postedAt: 1, status: "x" })
        ?.status,
    ).toBe("open");
  });

  it("tells the agent how to leave a card, after the prompt", () => {
    const prompt = automationPrompt("  Draft this week's changelog.  ");
    expect(prompt.startsWith("Draft this week's changelog.\n")).toBe(true);
    expect(prompt).toContain("```aven-review");
    expect(prompt).toContain("save it as a draft");
  });
});
