import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  addCrewMember,
  addCrewPreset,
  presetInCrew,
  updateCrewMember,
} from "./crewActions";
import { CREW_PRESETS } from "./crewPresets";
import {
  CREWS_KEY,
  crewMemberById,
  crewMemberName,
  getCrew,
  memberCritter,
  newCrew,
  readCrew,
  resetCrewsCache,
  updateCrew,
} from "./crews";
import { titleBeside } from "./crewView";
import { memoryStorage } from "./devSmoke";
import { resetProjectBotsCache } from "./projectBots";

const PATH = "/Users/me/aven-site";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  resetCrewsCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetProjectBotsCache();
  resetCrewsCache();
});

/** A crew stored by 0.1.160, before marks: its members as it saved them. */
function crewFromBeforeMarks() {
  localStorage.setItem(
    CREWS_KEY,
    JSON.stringify({
      version: 1,
      crews: {
        [PATH]: {
          path: PATH,
          on: true,
          createdAt: 1,
          members: [
            { id: "builder", role: "builder" },
            { id: "checker", role: "checker" },
            { id: "security", role: "security" },
            {
              id: "builder-2",
              role: "builder",
              preset: "designer",
              critter: "moth",
              label: "Designer",
            },
            {
              id: "builder-3",
              role: "builder",
              name: "Mole",
              critter: "hedgehog",
            },
          ],
          cards: [],
          feed: [],
          notes: [],
        },
      },
    }),
  );
  resetCrewsCache();
  return getCrew(PATH)!;
}

describe("crew members' names and marks", () => {
  it("names a new crew's members by their roles, each in its role's mark", () => {
    const crew = newCrew(PATH);
    expect(
      crew.members.map((member) => crewMemberName(crew, member.id)),
    ).toEqual(["Builder", "Checker", "Security"]);
    expect(crew.members.map((member) => memberCritter(member))).toEqual([
      "builder",
      "checker",
      "security",
    ]);
    // Read back from storage, it keeps both.
    const read = readCrew(JSON.parse(JSON.stringify(crew)))!;
    expect(crewMemberName(read, "checker")).toBe("Checker");
  });

  it("calls a crew from before marks' members by their roles, and draws them so", () => {
    const crew = crewFromBeforeMarks();
    // "Mole" was a default name too; the Designer goes by its own title.
    expect(
      crew.members.map((member) => crewMemberName(crew, member.id)),
    ).toEqual(["Builder", "Checker", "Security", "Designer", "Builder 2"]);
    expect(crew.members.map((member) => memberCritter(member))).toEqual([
      "builder",
      "checker",
      "security",
      "designer",
      "moon",
    ]);
  });

  it("keeps a member's role name when it is given a mark of its own", () => {
    crewFromBeforeMarks();
    expect(updateCrewMember(PATH, "checker", { critter: "spiral" })).toBeNull();
    const checker = crewMemberById(getCrew(PATH)!, "checker")!;
    expect(checker.critter).toBe("spiral");
    expect(checker.name).toBeUndefined();
    expect(crewMemberName(getCrew(PATH)!, "checker")).toBe("Checker");
  });

  it("numbers a second member of a role, and gives it a mark nobody wears", () => {
    updateCrew(PATH, (crew) => ({ ...crew, on: true }));
    const added = addCrewMember(PATH, "builder");
    expect(added).toEqual({ id: "builder-2" });
    const crew = getCrew(PATH)!;
    expect(crewMemberName(crew, "builder-2")).toBe("Builder 2");
    const marks = crew.members.map((member) => memberCritter(member));
    expect(new Set(marks).size).toBe(marks.length);
    expect(titleBeside("Builder 2", "Builder")).toBeNull();
    expect(titleBeside("Sam", "Builder")).toBe("Builder");
  });

  it("names a custom member by its title, in the custom mark", () => {
    updateCrew(PATH, (crew) => ({ ...crew, on: true }));
    const added = addCrewMember(PATH, "custom", {
      label: "Writer",
      job: "Words",
    });
    expect("id" in added).toBe(true);
    const id = (added as { id: string }).id;
    const crew = getCrew(PATH)!;
    expect(crewMemberName(crew, id)).toBe("Writer");
    expect(memberCritter(crewMemberById(crew, id)!)).toBe("custom");
  });

  it("adds ready-made members by their roles' names, in their own marks", () => {
    updateCrew(PATH, (crew) => ({ ...crew, on: true }));
    for (const key of ["designer", "tester", "scribe", "scout"])
      expect("id" in addCrewPreset(PATH, key)).toBe(true);
    const crew = getCrew(PATH)!;
    const names = crew.members.map((member) => crewMemberName(crew, member.id));
    expect(names).toEqual([
      "Builder",
      "Checker",
      "Security",
      "Designer",
      "Tester",
      "Scribe",
      "Scout",
    ]);
    expect(crew.members.map((member) => memberCritter(member))).toEqual([
      "builder",
      "checker",
      "security",
      "designer",
      "tester",
      "scribe",
      "scout",
    ]);
    // Every ready-made member reads as in the crew now.
    for (const preset of CREW_PRESETS)
      expect(presetInCrew(crew, preset), preset.key).toBe(true);
  });

  it("counts a crew from before marks' default members as its ready-made ones", () => {
    const crew = crewFromBeforeMarks();
    const inCrew = CREW_PRESETS.filter((preset) =>
      presetInCrew(crew, preset),
    ).map((preset) => preset.key);
    expect(inCrew).toEqual(["builder", "checker", "designer", "security"]);
  });
});

describe("the gallery's ready-made members", () => {
  it("goes by role names, not animals", () => {
    expect(CREW_PRESETS.map((preset) => preset.label ?? preset.role)).toEqual([
      "builder",
      "checker",
      "scout",
      "Designer",
      "Tester",
      "Scribe",
      "security",
    ]);
    expect(CREW_PRESETS.map((preset) => preset.mark)).toEqual([
      "builder",
      "checker",
      "scout",
      "designer",
      "tester",
      "scribe",
      "security",
    ]);
    expect(JSON.stringify(CREW_PRESETS)).not.toMatch(
      /beetle|owl|fox|moth|snail|puffin|hedgehog/i,
    );
  });
});
