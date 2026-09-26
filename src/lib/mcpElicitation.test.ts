import { describe, expect, it } from "vitest";
import { elicitationPrompt, elicitationResult } from "./mcpElicitation";

describe("elicitationPrompt", () => {
  it("maps enum, boolean, number, text and multi-select fields to questions", () => {
    const prompt = elicitationPrompt({
      serverName: "linear",
      message: "Create the issue?",
      mode: "form",
      schema: {
        type: "object",
        properties: {
          team: { type: "string", title: "Team", enum: ["eng", "ops"], enumNames: ["Engineering", "Operations"] },
          urgent: { type: "boolean", title: "Urgent" },
          points: { type: "integer", title: "Points" },
          summary: { type: "string", title: "Summary", description: "One line" },
          labels: { type: "array", items: { anyOf: [{ const: "bug", title: "Bug" }, { const: "ui", title: "UI" }] } },
        },
        required: ["team"],
      },
    });
    expect(prompt.title).toBe("linear: Create the issue?");
    expect(prompt.questions.map((q) => [q.id, q.multiSelect, q.allowCustom, q.options.map((o) => o.label)])).toEqual([
      ["team", false, false, ["Engineering", "Operations"]],
      ["urgent", false, false, ["Yes", "No"]],
      ["points", false, true, []],
      ["summary", false, true, []],
      ["labels", true, false, ["Bug", "UI"]],
    ]);
    expect(prompt.questions[3]?.prompt).toBe("One line");
  });

  it("returns typed content from the user's answers", () => {
    const prompt = elicitationPrompt({
      serverName: "linear",
      message: "Create the issue?",
      mode: "form",
      schema: {
        type: "object",
        properties: {
          team: { type: "string", enum: ["eng", "ops"] },
          urgent: { type: "boolean" },
          points: { type: "integer" },
          labels: { type: "array", items: { enum: ["bug", "ui"] } },
          note: { type: "string" },
        },
        required: ["team"],
      },
    });
    const result = elicitationResult(prompt, {
      kind: "answered",
      answers: { team: ["ops"], urgent: ["true"], labels: ["bug", "ui"] },
      custom: { points: "3.7", note: "  ship it " },
    });
    expect(result).toEqual({
      action: "accept",
      content: { team: "ops", urgent: true, points: 3, labels: ["bug", "ui"], note: "ship it" },
    });
  });

  it("declines when a required field is missing or the user skips", () => {
    const prompt = elicitationPrompt({
      serverName: "s",
      message: "m",
      mode: "form",
      schema: { type: "object", properties: { team: { type: "string", enum: ["a"] }, n: { type: "number" } }, required: ["team"] },
    });
    expect(elicitationResult(prompt, { kind: "answered", answers: {}, custom: { n: "2" } })).toEqual({ action: "decline", content: null });
    expect(elicitationResult(prompt, { kind: "skipped" })).toEqual({ action: "decline", content: null });
    expect(elicitationResult(prompt, "cancelled")).toEqual({ action: "cancel", content: null });
  });

  it("drops an unparseable optional number instead of sending text", () => {
    const prompt = elicitationPrompt({
      serverName: "s",
      message: "m",
      mode: "form",
      schema: { type: "object", properties: { n: { type: "number" } } },
    });
    expect(elicitationResult(prompt, { kind: "answered", answers: {}, custom: { n: "lots" } })).toEqual({ action: "accept", content: {} });
  });

  it("asks for confirmation when a form has no fields", () => {
    const prompt = elicitationPrompt({ serverName: "s", message: "Proceed?", mode: "form", schema: { type: "object", properties: {} } });
    expect(prompt.questions).toHaveLength(1);
    expect(prompt.questions[0]?.options.map((o) => o.label)).toEqual(["Continue", "Decline"]);
    expect(elicitationResult(prompt, { kind: "answered", answers: { __confirm__: ["continue"] } })).toEqual({ action: "accept", content: {} });
    expect(elicitationResult(prompt, { kind: "answered", answers: { __confirm__: ["decline"] } })).toEqual({ action: "decline", content: null });
  });

  it("shows the page for url requests and accepts once the user is done", () => {
    const prompt = elicitationPrompt({ serverName: "github", message: "Authorize access", mode: "url", url: "https://example.com/auth" });
    expect(prompt.questions[0]?.prompt).toContain("https://example.com/auth");
    expect(prompt.questions[0]?.options.map((o) => o.label)).toEqual(["Done", "Decline"]);
    expect(elicitationResult(prompt, { kind: "answered", answers: { __confirm__: ["continue"] } }).action).toBe("accept");
  });
});
