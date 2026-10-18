import { describe, expect, it } from "vitest";
import {
  namedLanes,
  raceAgentNames,
  raceDistinctNames,
  raceLaneTitle,
  raceTaskWords,
} from "./raceNames";
import { sessionDisplayTitle } from "./session";

describe("a race lane's chat title", () => {
  it("names the task and the agent by its short name", () => {
    const lanes = [
      {
        harness: "codex" as const,
        model: "gpt-6.1",
        label: "Codex · GPT-6.1-Sol",
      },
      {
        harness: "claude" as const,
        model: "sonnet",
        label: "Claude Code · Sonnet 5.5",
      },
    ];
    const names = raceAgentNames(lanes);
    const title = raceLaneTitle(
      "codex",
      raceTaskWords("Reset button\nMake it red."),
      names[0],
    );
    expect(sessionDisplayTitle(title, "codex")).toBe("Reset button · Codex");
    expect(
      sessionDisplayTitle(
        raceLaneTitle("claude", "Add a reset button", names[1]),
        "claude",
      ),
    ).toBe("Add a reset button · Claude");
  });

  it("falls back to Race without task words, and keeps the model for twins", () => {
    expect(
      sessionDisplayTitle(raceLaneTitle("codex", "  ", "Codex"), "codex"),
    ).toBe("Race · Codex");
    const twins = raceAgentNames([
      { harness: "claude", model: "opus", label: "Claude Code · Opus 4.6" },
      { harness: "claude", model: "sonnet", label: "Claude Code · Sonnet 5" },
    ]);
    expect(twins).toEqual(["Claude Opus 4.6", "Claude Sonnet 5"]);
  });

  it("keeps the task's first line short", () => {
    expect(raceTaskWords("")).toBe("");
    const long = raceTaskWords(`${"word ".repeat(30)}\nsecond line`);
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("naming lanes in a judge's words", () => {
  it("says each lane number as its agent's name", () => {
    const names = ["Claude", "Codex"];
    expect(namedLanes("Lane 2 is smaller than lane #1.", names)).toBe(
      "Codex is smaller than Claude.",
    );
    expect(namedLanes("Agent 2's change is focused.", names)).toBe(
      "Codex's change is focused.",
    );
    // A number that is no lane, or a word that only starts like one, stays.
    expect(namedLanes("Lane 3 and planes 2", names)).toBe(
      "Lane 3 and planes 2",
    );
  });

  it("tells apart two lanes that would share a name", () => {
    expect(
      raceDistinctNames([
        { harness: "claude", model: "opus", label: "Claude Code · Opus" },
        { harness: "claude", model: "opus", label: "Claude Code · Opus" },
        { harness: "codex", model: "gpt", label: "Codex · GPT" },
      ]),
    ).toEqual(["Claude Opus (1)", "Claude Opus (2)", "Codex"]);
  });
});
