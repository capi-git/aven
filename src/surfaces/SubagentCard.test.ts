import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Block } from "../lib/session";
import { SubagentCard } from "./SubagentCard";

function agent(id: string, title: string, tool: Block["tool"]): Block {
  return { id, role: "tool", text: title, tool: { kind: "agent", ...tool } };
}

describe("SubagentCard", () => {
  it("shows the count, each row's work, its type and its time", () => {
    const now = Date.now();
    const html = renderToStaticMarkup(
      createElement(SubagentCard, {
        live: true,
        blocks: [
          agent("a", "Fix data-safety problems", {
            status: "in_progress",
            agentType: "general-purpose",
            agentActivity: "Editing",
            startedAt: now - 89_000,
          }),
          agent("b", "Fix speed problems", {
            status: "in_progress",
            agentType: "general-purpose",
            agentActivity: "Running a command",
            startedAt: now - 74_000,
          }),
        ],
      }),
    );
    expect(html).toContain("2 subagents");
    expect(html).toContain("2 running");
    expect(html).toContain("Fix data-safety problems");
    expect(html).toContain("Editing");
    expect(html).toContain("Running a command");
    expect(html).toContain("General");
    expect(html).toMatch(/1:29/);
    expect(html).toMatch(/1:14/);
  });

  it("lets a finished row open what the subagent reported", () => {
    const html = renderToStaticMarkup(
      createElement(SubagentCard, {
        live: false,
        blocks: [
          agent("a", "Check the tests", {
            status: "completed",
            detail: "All 12 tests pass.",
            durationMs: 61_000,
          }),
        ],
      }),
    );
    expect(html).toContain("1 subagent");
    expect(html).toContain("Done");
    expect(html).toContain("1:01");
    expect(html).toContain("Show what Check the tests reported");
  });
});
