import { describe, expect, it } from "vitest";
import { avosForYouLine, avosRemembers } from "./avosProfile";
import type { Crew } from "./crews";

describe("Avos's line over what waits for you", () => {
  it("says what it is, as a person would", () => {
    expect(avosForYouLine([])).toBe("");
    expect(avosForYouLine(["ready"])).toBe("This is ready for you to look at.");
    expect(avosForYouLine(["ready", "ready"])).toBe(
      "These are ready for you to look at.",
    );
    expect(avosForYouLine(["answer"])).toBe("I need your answer on this.");
    expect(avosForYouLine(["answer", "answer"])).toBe(
      "I need your answers on these.",
    );
    expect(avosForYouLine(["idea"])).toBe("An idea, if you want it built.");
    expect(avosForYouLine(["idea", "idea", "idea"])).toBe(
      "Some ideas, if you want them built.",
    );
    expect(avosForYouLine(["ready", "answer", "idea"])).toBe(
      "3 things need you.",
    );
  });
});

describe("what Avos remembers, in its profile", () => {
  const crew = (
    members: Crew["members"],
    notes: string[] = [],
  ): Pick<Crew, "members" | "notes"> => ({
    members,
    notes: notes.map((text, index) => ({ id: `n${index}`, at: index, text })),
  });

  it("puts your notes first, then each memory's first line past its headings, Avos's before its helpers'", () => {
    const remembers = avosRemembers(
      crew(
        [
          { id: "builder", role: "builder", memory: "- Tests live in /spec" },
          {
            id: "lead",
            role: "lead",
            memory: "# Notes\n\n## Site\n* Articles go in as drafts",
          },
          { id: "fixer", role: "fixer", memory: "Never shown" },
          { id: "checker", role: "checker" },
        ],
        ["Use British spelling"],
      ),
    );
    expect(remembers).toEqual({
      lines: [
        "Use British spelling",
        "Articles go in as drafts",
        "Tests live in /spec",
      ],
      total: 3,
    });
  });

  it("shows at most the limit and counts the rest", () => {
    const remembers = avosRemembers(
      crew(
        [{ id: "lead", role: "lead", memory: "1. Keep it short" }],
        ["One", "Two", "Three"],
      ),
      2,
    );
    expect(remembers).toEqual({ lines: ["One", "Two"], total: 4 });
  });

  it("is empty when nothing is remembered", () => {
    expect(avosRemembers(crew([{ id: "lead", role: "lead" }]))).toEqual({
      lines: [],
      total: 0,
    });
  });
});
