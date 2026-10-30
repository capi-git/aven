import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CREWS_KEY,
  crewMemberName,
  getCrew,
  migrateBotsIntoCrews,
  resetCrewsCache,
  withAgentTitle,
} from "./crews";
import { crewMemberViews, titleBeside } from "./crewView";
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

/** A crew as 0.1.161 kept it: names Aven gave, one you typed, and the rest. */
const STORED = {
  version: 1,
  allRunsPerDay: 40,
  crews: {
    [PATH]: {
      path: PATH,
      on: true,
      onAt: 5,
      createdAt: 1,
      members: [
        { id: "builder", role: "builder", name: "Moth", critter: "moth" },
        { id: "checker", role: "checker", name: "Owl", harness: "codex" },
        { id: "security", role: "security", name: "hedgehog" },
        { id: "builder-2", role: "builder", name: "BEETLE" },
        { id: "builder-3", role: "builder", name: "Sam", effort: "high" },
        { id: "scout", role: "scout", name: "Foxy", schedule: "weekly" },
      ],
      routes: [{ id: "r1", words: ["css"], to: "builder-3" }],
      cards: [],
      feed: [
        {
          id: "f1",
          at: 2,
          kind: "start",
          who: "builder",
          text: "Moth started “Dark mode toggle”",
        },
      ],
      notes: [{ id: "n1", at: 3, text: "Use pnpm." }],
      limits: { runsPerDay: 7 },
    },
    "/Users/me/unreadable": { path: 42 },
  },
};

function store() {
  return JSON.parse(localStorage.getItem(CREWS_KEY)!);
}

describe("members named after critters go by their roles", () => {
  it("renames Aven's defaults, numbers the second, and keeps names you typed", () => {
    localStorage.setItem(CREWS_KEY, JSON.stringify(STORED));
    resetCrewsCache();
    const crew = getCrew(PATH)!;
    expect(
      crew.members.map((member) => crewMemberName(crew, member.id)),
    ).toEqual(["Builder", "Checker", "Security", "Builder 2", "Sam", "Foxy"]);
  });

  it("saves it once, changing nothing else in the store", () => {
    localStorage.setItem(CREWS_KEY, JSON.stringify(STORED));
    resetCrewsCache();
    expect(migrateBotsIntoCrews()).toBe(true);
    const saved = store();
    const members = saved.crews[PATH].members;
    expect(members.map((member: { name?: string }) => member.name)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      "Sam",
      "Foxy",
    ]);
    // Everything else as it was: other fields, the Feed's history, the
    // routes, the limits, an entry this build can't read.
    expect(members[0]).toEqual({
      id: "builder",
      role: "builder",
      critter: "moth",
    });
    expect(members[1]).toMatchObject({ harness: "codex" });
    expect(members[4]).toMatchObject({ name: "Sam", effort: "high" });
    expect(saved.crews[PATH].feed[0].text).toBe(
      "Moth started “Dark mode toggle”",
    );
    expect(saved.crews[PATH].routes).toEqual(STORED.crews[PATH].routes);
    expect(saved.crews[PATH].notes).toEqual(STORED.crews[PATH].notes);
    expect(saved.crews[PATH].limits.runsPerDay).toBe(7);
    expect(saved.crews["/Users/me/unreadable"]).toEqual({ path: 42 });
    expect(saved.allRunsPerDay).toBe(40);
    // Saved once: a second run has nothing to do.
    expect(migrateBotsIntoCrews()).toBe(false);
  });

  it("matches the whole name in any case, never a name that only starts like one", () => {
    const crew = {
      members: [
        { id: "builder", role: "builder" as const, name: "Jellyfish" },
        { id: "checker", role: "checker" as const, name: "Owlbert" },
      ],
    };
    localStorage.setItem(
      CREWS_KEY,
      JSON.stringify({
        version: 1,
        crews: { [PATH]: { path: PATH, createdAt: 1, ...crew } },
      }),
    );
    resetCrewsCache();
    const read = getCrew(PATH)!;
    expect(crewMemberName(read, "builder")).toBe("Builder");
    expect(crewMemberName(read, "checker")).toBe("Owlbert");
  });
});

describe("a role name is said once", () => {
  it("leaves the title out beside a name that is the title", () => {
    localStorage.setItem(CREWS_KEY, JSON.stringify(STORED));
    resetCrewsCache();
    const crew = getCrew(PATH)!;
    const views = crewMemberViews(crew, {
      name: (who) => crewMemberName(crew, who),
    });
    expect(
      views.map((view) => [view.name, titleBeside(view.name, view.roleLabel)]),
    ).toEqual([
      ["Builder", null],
      ["Builder 2", null],
      ["Sam", "Builder"],
      ["Checker", null],
      ["Security", null],
      ["Foxy", "Scout"],
    ]);
  });
});

describe("a chat titled with a critter's name", () => {
  it("takes the agent's name now, and keeps a title you gave it", () => {
    const chat = { id: "c", title: "Beetle" };
    expect(withAgentTitle(chat, "Builder")).toEqual({
      id: "c",
      title: "Builder",
    });
    expect(withAgentTitle({ id: "b", title: "jelly" }, "Fixer").title).toBe(
      "Fixer",
    );
    const mine = { id: "m", title: "Hero work" };
    expect(withAgentTitle(mine, "Builder")).toBe(mine);
    const same = { id: "s", title: "Builder" };
    expect(withAgentTitle(same, "Builder")).toBe(same);
  });
});
