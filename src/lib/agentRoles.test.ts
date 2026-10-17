import { expect, it } from "vitest";
import {
  AGENT_ROLES,
  readAgentRole,
  roleBrief,
  withRoleBrief,
} from "./agentRoles";

it("offers four fixed roles, each one or two plain sentences", () => {
  expect(AGENT_ROLES.map((role) => role.name)).toEqual([
    "Reviewer",
    "Tester",
    "Skeptic",
    "Designer",
  ]);
  for (const role of AGENT_ROLES) {
    const sentences = role.instruction.split(/(?<=[.!?])\s+/);
    expect(sentences.length).toBeGreaterThanOrEqual(1);
    expect(sentences.length).toBeLessThanOrEqual(2);
    expect(role.instruction.length).toBeLessThan(160);
  }
  expect(AGENT_ROLES.find((role) => role.id === "skeptic")?.instruction).toBe(
    "Push back on weak points and look for what could go wrong; agree only when convinced.",
  );
});

it("leads a message with the role's line, once", () => {
  expect(roleBrief("skeptic", "in this discussion")).toBe(
    "Your role in this discussion: Skeptic. Push back on weak points and look for what could go wrong; agree only when convinced.",
  );
  const text = withRoleBrief(
    "Check the login flow.",
    "tester",
    "for this task",
  );
  expect(text.startsWith("Your role for this task: Tester. ")).toBe(true);
  expect(text.endsWith("\n\nCheck the login flow.")).toBe(true);
  expect(text.match(/Your role/g)).toHaveLength(1);
  expect(withRoleBrief("Check it.", undefined, "for this task")).toBe(
    "Check it.",
  );
});

it("reads only the four roles back", () => {
  expect(readAgentRole("designer")).toBe("designer");
  expect(readAgentRole("Designer")).toBeUndefined();
  expect(readAgentRole("admin")).toBeUndefined();
  expect(readAgentRole(3)).toBeUndefined();
});
