import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Block } from "../lib/session";
import { proposalBlock } from "../lib/orchestrationPlan";
import { AgentTranscript } from "./AgentTranscript";

function tool(id: string, approval?: Block["approval"]): Block {
  return {
    id,
    role: "tool",
    text: `Inspect hidden-detail-${id}`,
    tool: { kind: "shell", status: approval ? "pending" : "completed" },
    ...(approval ? { approval } : {}),
  };
}

function render(blocks: Block[], busy = false) {
  return renderToStaticMarkup(createElement(AgentTranscript, { blocks, busy }));
}

describe("AgentTranscript collapsed work", () => {
  it("preserves protocol examples and less-than text in ordinary conversation", () => {
    const markup = render([
      { id: "user", role: "user", text: "Explain the format" },
      {
        id: "reply",
        role: "assistant",
        text: "Use `<aven_proposal>visible-example</aven_proposal>` and compare x <",
      },
    ]);
    expect(markup).toContain("visible-example");
    expect(markup).toContain("x &lt;");
  });
  it.each(["assistant", "plan"] as const)(
    "hides a live %s proposal only while an unfinished card can receive it",
    (role) => {
      const card = proposalBlock("card", {
        version: 1,
        leadId: "lead",
        cwd: "/repo",
        request: "Build settings",
        author: { harness: "claude", model: "claude:test", name: "Lead" },
        settings: { choices: [], maxWorkers: 2 },
        status: "invalid",
        title: "Assignments",
        summary: "",
        tasks: [],
      });
      const blocks: Block[] = [
        { id: "ask", role: "user", text: "Plan it" },
        card,
        { id: "more", role: "user", text: "Finish the proposal" },
        {
          id: "reply",
          role,
          text: 'Ready.\n<aven_proposal>{"title":"hidden-assignment-payload"',
          streaming: true,
        },
      ];
      expect(render(blocks, true)).not.toContain("hidden-assignment-payload");
      expect(render(blocks, true)).toContain("Ready.");
      // An ordinary reply after a completed card must remain inspectable.
      card.orchestration!.status = "approved";
      expect(render(blocks, true)).toContain("hidden-assignment-payload");
    },
  );
  it("reveals an orchestration result after the finished turn and before its action row", () => {
    const card: Block = {
      id: "proposal",
      role: "plan",
      text: "Assignment plan",
      orchestration: {
        version: 1,
        leadId: "lead",
        cwd: "/repo",
        request: "Build",
        author: { harness: "claude", model: "claude:test", name: "Lead" },
        settings: {
          choices: [
            { harness: "claude", model: "claude:test", name: "Worker" },
          ],
          maxWorkers: 2,
        },
        status: "ready",
        title: "Proposed assignments",
        summary: "Implement and verify",
        tasks: [],
      },
    };
    const blocks: Block[] = [
      {
        id: "user",
        role: "user",
        text: "Build",
        startedAt: 1000,
        durationMs: 500,
      },
      card, // Existing records have the card before the work.
      tool("inspection"),
      {
        id: "answer",
        role: "assistant",
        text: "The investigation is complete.",
      },
    ];
    expect(render(blocks, true)).not.toContain("data-orchestration-review");
    const finished = render(blocks);
    expect(finished.indexOf("The investigation is complete.")).toBeLessThan(
      finished.indexOf("data-orchestration-result"),
    );
    expect(finished.indexOf("data-orchestration-review")).toBeLessThan(
      finished.indexOf('aria-label="Worked for 1s"'),
    );
    expect(finished.match(/data-orchestration-review/g)).toHaveLength(1);
    card.orchestration!.status = "planning";
    expect(render(blocks)).not.toContain("data-orchestration-review");
  });
  it("renders the summary and answer without mounting a large completed tool trail", () => {
    const blocks: Block[] = [
      { id: "user", role: "user", text: "Check the project" },
      ...Array.from({ length: 1357 }, (_, index) => tool(String(index))),
      { id: "answer", role: "assistant", text: "The project checks passed." },
    ];
    const markup = render(blocks);
    expect(markup).toContain("The project checks passed.");
    expect(markup).toContain("Show the work");
    expect(markup.includes("hidden-detail-")).toBe(false);
    const short = render([blocks[0], tool("one"), tool("two"), blocks.at(-1)!]);
    const tagCount = (html: string) => html.match(/<[a-z]/g)?.length ?? 0;
    expect(tagCount(markup)).toBe(tagCount(short));
  });

  it("keeps live work visible before the assistant answers", () => {
    expect(render([tool("live")], true)).toContain("hidden-detail-live");
  });

  it("keeps an unresolved approval visible even when narration follows it", () => {
    const markup = render(
      [
        tool("approval", { requestId: 1 }),
        {
          id: "answer",
          role: "assistant",
          text: "Please approve the command.",
        },
      ],
      true,
    );
    expect(markup).toContain("hidden-detail-approval");
    expect(markup).toContain("Please approve the command.");
    expect(markup.includes('aria-label="Show the work"')).toBe(false);
  });
});

describe("worker assignment prompts", () => {
  it("hides the assignment envelope and keeps the task text", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentTranscript, {
        managed: true,
        blocks: [
          {
            id: "u1",
            role: "user",
            internal: true,
            text: "Review the current branch against main.\n\n<monocode_assignment>\nYou are a worker managed by a MonoCode lead. Your assigned write scope is: src/App.tsx.\n</monocode_assignment>",
          },
          { id: "a1", role: "assistant", text: "Looking now" },
        ],
      }),
    );
    expect(markup).toContain("Review the current branch against main.");
    expect(markup).toContain("Looking now");
    expect(markup).not.toContain("monocode_assignment");
    expect(markup).not.toContain("You are a worker managed by a MonoCode lead");
  });
});
