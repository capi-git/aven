import { describe, expect, it } from "vitest";
import {
  agentFullName,
  agentModelName,
  agentNameIn,
  agentNameWithModel,
  agentNames,
  appName,
} from "./agentNames";

describe("agent names", () => {
  it("names an app the way people say it", () => {
    expect(appName("claude")).toBe("Claude");
    expect(appName("codex")).toBe("Codex");
    expect(appName("grok")).toBe("Grok");
  });

  it("drops the app's name from the front of a model", () => {
    expect(
      agentModelName({ harness: "claude", model: "Claude Sonnet 5" }),
    ).toBe("Sonnet 5");
    expect(agentModelName({ harness: "codex", model: "GPT-5.4" })).toBe(
      "GPT-5.4",
    );
    // A model named only by its app and version stays whole.
    expect(agentModelName({ harness: "grok", model: "Grok 4.6" })).toBe(
      "Grok 4.6",
    );
    expect(agentModelName({ harness: "claude", model: "Default" })).toBe("");
  });

  it("joins the app and model without a dot inside the name", () => {
    expect(agentNameWithModel({ harness: "claude", model: "Opus 4.6" })).toBe(
      "Claude Opus 4.6",
    );
    expect(
      agentNameWithModel({ harness: "claude", model: "Claude Sonnet 5" }),
    ).toBe("Claude Sonnet 5");
    expect(agentNameWithModel({ harness: "codex", model: "GPT-5" })).toBe(
      "Codex GPT-5",
    );
    expect(agentNameWithModel({ harness: "grok", model: "Grok 4.6" })).toBe(
      "Grok 4.6",
    );
    expect(agentNameWithModel({ harness: "claude", model: "" })).toBe("Claude");
  });

  it("gives the full name for tooltips", () => {
    expect(agentFullName({ harness: "claude", model: "Opus 4.6" })).toBe(
      "Claude Code · Opus 4.6",
    );
    expect(agentFullName({ harness: "claude", model: "Claude Sonnet 5" })).toBe(
      "Claude Code · Sonnet 5",
    );
    expect(agentFullName({ harness: "grok", model: "Grok 4.6" })).toBe(
      "Grok Build · Grok 4.6",
    );
    expect(agentFullName({ harness: "codex", model: "Default" })).toBe("Codex");
  });

  it("adds the model only when two agents of one app are in the team", () => {
    const opus = { harness: "claude" as const, model: "Opus 4.6" };
    const sonnet = { harness: "claude" as const, model: "Claude Sonnet 5" };
    const codex = { harness: "codex" as const, model: "GPT-5" };
    expect(agentNames([opus, codex])).toEqual(["Claude", "Codex"]);
    expect(agentNames([opus, sonnet, codex])).toEqual([
      "Claude Opus 4.6",
      "Claude Sonnet 5",
      "Codex",
    ]);
    expect(agentNameIn(codex, [opus, sonnet, codex])).toBe("Codex");
    expect(agentNameIn(opus, [opus])).toBe("Claude");
  });
});
