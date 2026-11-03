import { describe, expect, it } from "vitest";
import {
  boardCardProblem,
  copyLeftoversProblem,
  SMOKE_STRAY_FILE,
  standInTeamTurns,
} from "./devSmokeTeam";

describe("the real-app check's team steps", () => {
  it("reads the stand-in's team turns from its log and skips everything else", () => {
    const log = [
      JSON.stringify({ pid: 1, args: ["--version"] }),
      JSON.stringify({ pid: 2, turn: "t1", sharedWork: false }),
      JSON.stringify({ pid: 3, crew: "researcher", web: false, notes: true }),
      "{not json",
      "",
      JSON.stringify({ pid: 4, crew: "designer", stray: true }),
    ].join("\n");
    expect(standInTeamTurns(log)).toEqual([
      { pid: 3, crew: "researcher", web: false, notes: true },
      { pid: 4, crew: "designer", stray: true },
    ]);
    expect(standInTeamTurns("")).toEqual([]);
  });

  it("accepts a Board card that shows what the step expects", () => {
    expect(
      boardCardProblem(
        {
          column: "review",
          stage: "Findings · 2 findings · 2 ideas proposed",
          line: "",
          buttons: ["Read", "Add 2 ideas"],
        },
        {
          column: "review",
          stage: "Findings · 2 findings · 2 ideas proposed",
          buttons: ["Read", "Add 2 ideas"],
        },
      ),
    ).toBeNull();
    expect(
      boardCardProblem(
        {
          column: "building",
          stage: "Up next · Researcher",
          line: "",
          buttons: [],
        },
        { column: ["building", "review"], stage: /^(Up next|Reading)/ },
      ),
    ).toBeNull();
  });

  it("names the first thing a Board card shows that it shouldn't", () => {
    const shown = {
      column: "idea",
      stage: "",
      line: "From setup · waits for you",
      buttons: ["Build it"],
    };
    expect(boardCardProblem(shown, { column: "review" })).toBe(
      "is under idea, not review",
    );
    expect(boardCardProblem(shown, { stage: "Findings" })).toBe(
      'reads "", not "Findings"',
    );
    expect(boardCardProblem(shown, { line: /^(?!.*waits for you)/ })).toBe(
      'says "From setup · waits for you" under its title, not /^(?!.*waits for you)/',
    );
    expect(boardCardProblem(shown, { buttons: ["Look", "Build it"] })).toBe(
      'offers "Build it", without "Look"',
    );
    expect(
      boardCardProblem(
        { column: undefined, stage: "", line: "", buttons: [] },
        { column: "idea", buttons: ["Read"] },
      ),
    ).toBe("is under no column, not idea");
  });

  it("wants the Designer's folder and any stray file gone, and the copy's status clean", () => {
    expect(copyLeftoversProblem([{ name: "README.md" }], [])).toBeNull();
    expect(
      copyLeftoversProblem(
        [
          { name: "README.md" },
          { name: "aven-mockups" },
          { name: SMOKE_STRAY_FILE },
        ],
        [],
      ),
    ).toBe(`the copy still holds aven-mockups, ${SMOKE_STRAY_FILE}`);
    expect(
      copyLeftoversProblem([{ name: "README.md" }], [{ relative: "x.txt" }]),
    ).toBe("the copy's git status isn't clean: x.txt");
  });
});
