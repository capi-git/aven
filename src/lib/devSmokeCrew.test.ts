import { afterEach, describe, expect, it, vi } from "vitest";
import { queueCard } from "./crewLoop";
import { getCrew, newCrew, resetCrewsCache, type Crew } from "./crews";
import {
  appliedProblem,
  checkCrew,
  crewLaunchProblem,
  stackProblem,
} from "./devSmokeCrew";

const COPY =
  "/var/folders/x/aven-smoke-1/home/Library/Application Support/com.capi.aven.dev/bots/project-1a2b";

describe("the real-app check's crew step", () => {
  it("accepts a member started in the copy with only the user's settings, no hooks, its sandbox and no MCP", () => {
    const text = `Wrote it. AVEN_SMOKE_CREW_ENV sources=user hooks=off sandbox=on mcp=strict cwd=/private${COPY}`;
    expect(crewLaunchProblem(text, COPY, "The Builder")).toBeNull();
  });

  it("names everything a member was started with that it shouldn't be", () => {
    expect(
      crewLaunchProblem(
        "AVEN_SMOKE_CREW_ENV sources=user,project,local hooks=on sandbox=off mcp=open cwd=/Users/me/project",
        COPY,
        "The Checker",
      ),
    ).toBe(
      "The Checker ran in /Users/me/project, loaded settings from user,project,local, ran with hooks, ran without its sandbox, could load MCP servers",
    );
    expect(crewLaunchProblem("Done.", COPY, "Security")).toBe(
      "Security didn't report how it was started",
    );
  });

  it("accepts an Apply that changed exactly the reviewed files", () => {
    const before = [
      {
        relative: "race-claude.txt",
        status: "untracked",
        additions: 1,
        deletions: 0,
      },
    ];
    const after = [
      ...before,
      {
        relative: "aven-crew-check.txt",
        status: "untracked",
        additions: 1,
        deletions: 0,
      },
    ];
    expect(appliedProblem(before, after, ["aven-crew-check.txt"])).toBeNull();
    expect(appliedProblem(before, before, ["aven-crew-check.txt"])).toBe(
      "Apply didn't change aven-crew-check.txt from the reviewed change",
    );
    expect(
      appliedProblem(
        before,
        [
          ...after,
          {
            relative: "README.md",
            status: "modified",
            additions: 1,
            deletions: 0,
          },
        ],
        ["aven-crew-check.txt"],
      ),
    ).toBe("Apply also changed README.md, which wasn't in the reviewed change");
  });

  it("expects the Ready card as the only card on the crew's branch, reviewed as its own change", () => {
    const base = "a".repeat(40);
    const commit = "1".repeat(40);
    const fix = {
      base,
      hash: "h",
      files: 1,
      additions: 1,
      deletions: 0,
      paths: [{ path: "aven-crew-check.txt", additions: 1, deletions: 0 }],
    };
    const ready = {
      ...queueCard(
        {
          id: "check",
          title: "Crew check",
          brief: "",
          from: "you",
          maxRounds: 3,
        },
        1,
      ),
      stage: "ready" as const,
      fix,
    };
    const crew = (patch: Partial<Crew>): Crew => ({
      ...newCrew("/Users/me/aven-site"),
      ...patch,
    });
    // Ready but never stacked: the old one-card Apply.
    expect(stackProblem(crew({ cards: [ready] }), "check", [])).toBe(
      "The Ready card isn't stacked on the crew's branch",
    );
    const stacked = { ...ready, stacked: { commit, parent: base } };
    const onBranch = crew({ cards: [stacked], stack: { base } });
    expect(stackProblem(onBranch, "check", ["aven-crew-check.txt"])).toBeNull();
    expect(stackProblem(onBranch, "check", ["README.md"])).toBe(
      "The batch's Review shows README.md, not the card's reviewed change (aven-crew-check.txt)",
    );
    const other = {
      ...stacked,
      id: "other",
      stacked: { commit: "2".repeat(40), parent: commit },
    };
    expect(
      stackProblem(
        crew({ cards: [stacked, other], stack: { base } }),
        "check",
        ["aven-crew-check.txt"],
      ),
    ).toBe("The crew's branch holds check, other, not just the check's card");
  });

  it("turns quiet hours off even when the fresh profile has no crew yet", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    });
    resetCrewsCache();
    const project = "/Users/me/aven-site";
    expect(getCrew(project)).toBeUndefined();
    let quietWhenTurnedOn: boolean | undefined;
    await expect(
      checkCrew(() => ({ sessions: [] }), project, {
        turnOn: async (path) => {
          quietWhenTurnedOn = getCrew(path)?.limits.quiet.on;
          return "stopped here";
        },
        readFile: async () => "",
      }),
    ).rejects.toThrow("The crew didn't turn on: stopped here");
    expect(quietWhenTurnedOn).toBe(false);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCrewsCache();
});
