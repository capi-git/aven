import { describe, expect, it } from "vitest";
import {
  AGENT_DOTS,
  AGENT_ROWS,
  agentCells,
  agentMemberTone,
  agentOutfit,
  agentPhase,
  botAgentState,
  crewAgentState,
} from "./agentMark";
import { DOT_GRID, dotsPath } from "./dotSigils";

describe("Bot's drawing", () => {
  it("is the work dots' 5×5 grid: a light, a head with two eyes, two feet", () => {
    expect(AGENT_ROWS).toHaveLength(DOT_GRID);
    for (const row of AGENT_ROWS) expect(row).toHaveLength(DOT_GRID);
    expect(agentCells("l")).toEqual([[0, 2]]);
    expect(agentCells("e")).toEqual([
      [2, 1],
      [2, 3],
    ]);
    // Symmetric, so its look and blink read the same either way.
    for (const row of AGENT_ROWS) expect([...row].reverse().join("")).toBe(row);
    // Every cell is one part, and the faint rest fills the square.
    const parts = (["l", "h", "e", "."] as const).map(
      (part) => agentCells(part).length,
    );
    expect(parts.reduce((a, b) => a + b)).toBe(DOT_GRID * DOT_GRID);
    expect(AGENT_DOTS.head).toBe(dotsPath(agentCells("h")));
    expect(AGENT_DOTS.grid).toBe(dotsPath(agentCells(".")));
  });
});

describe("what each agent wears", () => {
  it("dresses each role, and nobody else", () => {
    expect(agentOutfit("lead")).toBe("headset");
    expect(agentOutfit("builder")).toBe("hat");
    expect(agentOutfit("checker")).toBe("tick");
    expect(agentOutfit("researcher")).toBe("glasses");
    expect(agentOutfit("designer")).toBe("beret");
    expect(agentOutfit("security")).toBe("shield");
    expect(agentOutfit("scout")).toBe("diamond");
    expect(agentOutfit("fixer")).toBe("plus");
    expect(agentOutfit("helper")).toBeUndefined();
    expect(agentOutfit(undefined)).toBeUndefined();
  });

  it("starts each helper somewhere else in its loops, Avos at the start", () => {
    expect(agentPhase("lead")).toBe(0);
    const phases = [
      "builder",
      "checker",
      "researcher",
      "designer",
      "security",
      "scout",
      "fixer",
      "helper",
    ].map(agentPhase);
    expect(new Set([0, ...phases]).size).toBe(phases.length + 1);
    expect(agentPhase(undefined)).toBe(0);
  });
});

describe("a member's state", () => {
  it("needs you over working, working over watching, then rests", () => {
    expect(crewAgentState("needs-you", true)).toBe("needs");
    expect(crewAgentState("working", false)).toBe("working");
    expect(crewAgentState(undefined, true)).toBe("working");
    expect(crewAgentState("watching", false)).toBe("watching");
    expect(crewAgentState("ready", false)).toBe("resting");
    expect(crewAgentState(undefined, false, "still")).toBe("still");
    expect(crewAgentState("paused", false)).toBe("still");
  });
});

describe("a bot's state", () => {
  it("follows its word", () => {
    expect(botAgentState("watching")).toBe("watching");
    expect(botAgentState("working")).toBe("working");
    expect(botAgentState("needs-you")).toBe("needs");
    expect(botAgentState("fix-ready")).toBe("resting");
    expect(botAgentState("paused")).toBe("still");
    expect(botAgentState(undefined)).toBe("resting");
  });
});

describe("a member's colour", () => {
  it("is the project's for Avos and the Fixer, the role's for the rest", () => {
    expect(agentMemberTone("lead", null, "green")).toBe("green");
    expect(agentMemberTone("fixer", null, "teal")).toBe("teal");
    expect(agentMemberTone("builder", null, "green")).toBe("blue");
    expect(agentMemberTone("checker", null, "green")).toBe("purple");
    expect(agentMemberTone("builder", "tester", "green")).toBe("orange");
  });
});
