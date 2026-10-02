import { describe, expect, it } from "vitest";
import { consumeOrchestratorCommand } from "./orchestratorCommand";

describe("orchestrator command", () => {
  it("consumes only a leading /orchestrator command", () => {
    expect(
      consumeOrchestratorCommand("/orchestrator Ship the release"),
    ).toEqual({ text: "Ship the release", matched: true });
    expect(consumeOrchestratorCommand("  /Orchestrator\nPlan it")).toEqual({
      text: "Plan it",
      matched: true,
    });
    expect(consumeOrchestratorCommand("/orchestrator")).toEqual({
      text: "",
      matched: true,
    });
    for (const text of [
      "/orchestrators are fun",
      "Use /orchestrator later",
      "/orchestratorX",
    ])
      expect(consumeOrchestratorCommand(text)).toEqual({
        text,
        matched: false,
      });
  });
});
