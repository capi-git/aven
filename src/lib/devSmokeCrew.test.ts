import { afterEach, describe, expect, it, vi } from "vitest";
import { getCrew, resetCrewsCache } from "./crews";
import { appliedProblem, checkCrew, crewLaunchProblem } from "./devSmokeCrew";

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
