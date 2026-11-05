import { describe, expect, it } from "vitest";
import {
  AGENT_GEOMETRY,
  AGENT_SMALL_SCALE,
  OUTFIT_PATHS,
  agentMemberTone,
  agentOutfit,
  agentPhase,
  botAgentState,
  crewAgentState,
  eyesPath,
} from "./agentMark";

describe("Bot's drawing", () => {
  it("keeps everything inside its 64-unit box", () => {
    const { head, bolts, light } = AGENT_GEOMETRY;
    expect(head.x).toBeGreaterThan(0);
    expect(head.x + head.w).toBeLessThan(64);
    expect(head.y + head.h).toBeLessThan(64);
    for (const bolt of bolts) {
      expect(bolt.x).toBeGreaterThan(0);
      expect(bolt.x + bolt.w).toBeLessThan(64);
    }
    expect(light.y - light.r * AGENT_SMALL_SCALE).toBeGreaterThan(0);
  });

  it("draws bigger eyes when small, and a mood for each state", () => {
    const radius = (path: string) => Number(/a([\d.]+) /.exec(path)![1]);
    expect(radius(eyesPath("open", true))).toBeCloseTo(
      radius(eyesPath("open")) * AGENT_SMALL_SCALE,
    );
    expect(radius(eyesPath("wide"))).toBeCloseTo(AGENT_GEOMETRY.eyes.r * 1.15);
    // Closed eyes are two curves, not shapes.
    expect(eyesPath("closed")).not.toContain("Z");
    expect(eyesPath("closed").match(/q/g)).toHaveLength(2);
    // Squinting, they look down.
    expect(eyesPath("squint")).toContain(`${AGENT_GEOMETRY.eyes.y + 1.3}`);
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

  it("gives every badge its dark disc and a glyph", () => {
    for (const outfit of ["tick", "shield", "diamond", "plus"] as const) {
      const kinds = OUTFIT_PATHS[outfit].map((part) => part.kind);
      expect(kinds[0]).toBe("badge");
      expect(kinds.some((kind) => kind.startsWith("glyph"))).toBe(true);
    }
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
