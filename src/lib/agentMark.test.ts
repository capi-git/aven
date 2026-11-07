import { describe, expect, it } from "vitest";
import {
  AGENT_FACES,
  AGENT_GRIDS,
  agentCellCentre,
  agentFacePaths,
  agentMemberTone,
  agentOutfit,
  agentPhase,
  botAgentState,
  crewAgentState,
} from "./agentMark";

describe("Bot's drawing", () => {
  it("draws every face on its grid, symmetric, inside the screen", () => {
    for (const [grid, faces] of Object.entries(AGENT_FACES)) {
      const { cols, rows } = AGENT_GRIDS[grid as keyof typeof AGENT_GRIDS];
      for (const [face, lines] of Object.entries(faces)) {
        expect(lines, `${grid} ${face}`).toHaveLength(rows);
        for (const line of lines) expect(line).toHaveLength(cols);
        // Every face lights something.
        expect(lines.join("")).toMatch(/[#u]/);
      }
      // Faces that look straight at you are the same either way round.
      for (const face of ["squares", "narrow", "happy", "cross"] as const)
        for (const line of faces[face])
          expect([...line].reverse().join(""), `${grid} ${face}`).toBe(line);
      // Its corners stay inside the screen.
      const [x0, y0] = agentCellCentre(grid as never, 0, 0);
      const [x1, y1] = agentCellCentre(grid as never, rows - 1, cols - 1);
      expect(x0).toBeGreaterThan(5);
      expect(y0).toBeGreaterThan(5);
      expect(x1).toBeLessThan(95);
      expect(y1).toBeLessThan(95);
    }
  });

  it("keeps a prompt's cursor apart, so it alone blinks", () => {
    const prompt = agentFacePaths("large", "prompt");
    expect(prompt.cursor.match(/M/g)).toHaveLength(5);
    expect(prompt.lit.match(/M/g)).toHaveLength(10);
    expect(agentFacePaths("large", "squares").cursor).toBe("");
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
    expect(crewAgentState("ready", false)).toBe("ready");
    expect(crewAgentState(undefined, false, "still")).toBe("still");
    expect(crewAgentState("paused", false)).toBe("still");
  });
});

describe("a bot's state", () => {
  it("follows its word", () => {
    expect(botAgentState("watching")).toBe("watching");
    expect(botAgentState("working")).toBe("working");
    expect(botAgentState("needs-you")).toBe("needs");
    expect(botAgentState("fix-ready")).toBe("ready");
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
