import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { crewFenceView } from "../lib/crewFences";
import { AgentMarkdown } from "./AgentMarkdown";

/*
 * A crew's fenced blocks never show as raw JSON in a chat: each is a
 * compact card in Aven's words, with the bot's words as quoted text.
 */

const fenced = (name: string, body: unknown) =>
  `Here's what I found.\n\n\`\`\`${name}\n${JSON.stringify(body)}\n\`\`\`\n`;

const IDEAS = fenced("aven-ideas", {
  ideas: [
    { title: "Timer screen", why: "The core of Pom", size: "small" },
    { title: "Pause and resume", size: "medium" },
    { title: "Haptics on finish", size: "small" },
  ],
});

describe("a team block's card", () => {
  it("reads each kind of block in Aven's words", () => {
    expect(
      crewFenceView(
        "aven-ideas",
        JSON.stringify({ ideas: [{ title: "Timer", size: "small" }] }),
      ),
    ).toEqual({
      kind: "ideas",
      label: "1 idea",
      items: [{ title: "Timer", detail: "small" }],
    });
    expect(
      crewFenceView(
        "aven-verdict",
        JSON.stringify({
          pass: false,
          summary: "Not yet.",
          mustFix: [{ text: "Contrast", where: "a.css" }, { text: "Reload" }],
        }),
      ),
    ).toMatchObject({ label: "2 must-fix", line: "Not yet." });
    expect(
      crewFenceView(
        "aven-handoff",
        JSON.stringify({ summary: "Built it", ran: [] }),
      ),
    ).toMatchObject({ label: "Handed over", line: "Built it" });
    expect(
      crewFenceView(
        "aven-goal",
        JSON.stringify({ met: true, summary: "All done" }),
      ),
    ).toMatchObject({ label: "Goal met", line: "All done" });
    expect(crewFenceView("aven-ideas", "{not json")).toBeNull();
  });

  it("never shows a team block as raw JSON in a chat", () => {
    for (const text of [
      IDEAS,
      fenced("aven-verdict", {
        pass: true,
        summary: "Looks right.",
        mustFix: [],
      }),
      fenced("aven-handoff", {
        summary: "Built the timer.",
        howToCheck: ["Open it"],
      }),
      fenced("aven-tasks", { tasks: [{ title: "Timer screen" }], goal: "Pom" }),
      fenced("aven-goal", { met: false, next: [{ title: "Timer screen" }] }),
      "```aven-ideas\n{broken",
    ]) {
      const markup = renderToStaticMarkup(
        createElement(AgentMarkdown, { text }),
      );
      expect(markup).not.toContain("&quot;");
      expect(markup).not.toContain("markdown-code-shell");
      expect(markup).toContain("data-crew-fence");
    }
    const ideas = renderToStaticMarkup(
      createElement(AgentMarkdown, { text: IDEAS }),
    );
    expect(ideas).toContain("3 ideas");
    expect(ideas).toContain("Timer screen");
    expect(ideas).toContain("small · The core of Pom");
  });

  it("shows a quiet line while a team block is still being written", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, {
        text: '```aven-ideas\n{"ideas": [{"title": "Tim',
        streaming: true,
      }),
    );
    expect(markup).toContain("Writing a note for the team…");
    expect(markup).not.toContain("Tim");
  });
});

describe("an ideas block", () => {
  it("offers no buttons: the card only reads", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentMarkdown, { text: IDEAS }),
    );
    expect(markup).toContain("Timer screen");
    expect(markup).not.toContain("<button");
  });
});
