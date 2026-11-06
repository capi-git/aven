import { describe, expect, it } from "vitest";
import { agentMemberTone } from "./agentMark";
import { MARK_TONES, type MarkTone } from "./markTones";

const STATUS: readonly MarkTone[] = ["yellow", "green", "red"];

describe("a helper never wears Avos's colour", () => {
  it("keeps each helper's own colour beside a project of another", () => {
    expect(agentMemberTone("builder", undefined, "red")).toBe("blue");
    expect(agentMemberTone("researcher", undefined, "blue")).toBe("orange");
    // Avos and the Fixer wear the project's.
    expect(agentMemberTone("lead", undefined, "orange")).toBe("orange");
    expect(agentMemberTone("fixer", undefined, "orange")).toBe("orange");
  });

  it("gives a helper whose colour is its project's the next free one", () => {
    expect(agentMemberTone("researcher", undefined, "orange")).toBe("teal");
    expect(agentMemberTone("builder", undefined, "blue")).toBe("teal");
    expect(agentMemberTone("scout", undefined, "teal")).toBe("orange");
    expect(agentMemberTone("scribe", "scribe", "grey")).toBe("teal");
  });

  it("in every project colour, no helper matches Avos or wears a status colour in its place", () => {
    const roles = [
      "builder",
      "checker",
      "security",
      "scout",
      "researcher",
      "designer",
    ];
    for (const { tone: project } of MARK_TONES)
      for (const role of roles) {
        const tone = agentMemberTone(role, undefined, project);
        expect(tone, `${role} in a ${project} project`).not.toBe(project);
        expect(STATUS).not.toContain(tone);
      }
  });

  it("picks a stand-in no other helper on screen wears", () => {
    expect(
      agentMemberTone(
        "checker",
        undefined,
        "purple",
        new Set<MarkTone>(["blue", "purple", "pink", "teal"]),
      ),
    ).toBe("orange");
  });
});
