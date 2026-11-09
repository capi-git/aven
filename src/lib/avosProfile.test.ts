import { describe, expect, it } from "vitest";
import {
  avosFinishedToday,
  avosForYouLine,
  memoryFacts,
  withoutMemoryFact,
} from "./avosProfile";
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

describe("what Avos's helpers finished today", () => {
  it("counts helpers' answers and jobs that came back, today only", () => {
    const now = new Date(2026, 10, 7, 15).getTime();
    const today = new Date(2026, 10, 7, 9).getTime();
    const yesterday = new Date(2026, 10, 6, 18).getTime();
    const entry = (at: number, kind: string, who?: string) =>
      ({ id: `${at}${kind}`, at, kind, who, text: "" }) as Crew["feed"][number];
    const feed = [
      entry(yesterday, "ready", "checker"),
      entry(today, "say", "helper"),
      entry(today, "ready", "checker"),
      entry(today, "findings", "researcher"),
      entry(today, "mockup", "designer"),
      // Avos talking, a handoff and a note aren't something finished.
      entry(today, "say", "lead"),
      entry(today, "handoff", "builder"),
      entry(today, "note", "aven"),
    ];
    expect(avosFinishedToday({ feed }, now)).toBe(4);
    expect(avosFinishedToday({ feed: [] }, now)).toBe(0);
  });
});

describe("what Avos learned, one fact a row", () => {
  it("takes each line that says something, past headings and bullets", () => {
    const memory = "# Notes\n\n- Drafts only\n* The Insights page\n1. Use pnpm";
    expect(memoryFacts(memory)).toEqual([
      { line: 2, text: "Drafts only" },
      { line: 3, text: "The Insights page" },
      { line: 4, text: "Use pnpm" },
    ]);
    expect(memoryFacts(undefined)).toEqual([]);
  });

  it("forgets one line, and empties to nothing when no fact is left", () => {
    expect(withoutMemoryFact("# Notes\n- A\n- B", 1)).toBe("# Notes\n- B");
    expect(withoutMemoryFact("# Notes\n- A", 1)).toBeNull();
  });
});
