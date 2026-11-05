// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { avosGlance, avosLine, avosMet, avosUnmet, avosWeek } from "./avos";
import { teamPosts } from "./teamThread";
import {
  BUILDING_NEEDS_GIT,
  bringInBuilders,
  giveCardToCrew,
  installCrewWorkspace,
  pickCrewModels,
  tellTeam,
} from "./crewActions";
import {
  crewCard,
  crewMemberName,
  ensureAvos,
  ensureCrewSaved,
  getCrew,
  newCrew,
  resetCrewsCache,
  updateCrew,
  type Crew,
  type CrewCard,
} from "./crews";
import { memoryStorage } from "./devSmoke";
import {
  addFeatureIdea,
  memoryFeatureCardBackend,
  setFeatureCardBackend,
} from "./featureCards";
import { resetProjectBotsCache } from "./projectBots";
import type { ScheduledAgent, ScheduledRun } from "./scheduledAgents";

vi.mock("./fs", () => ({ notifyGitChanged: vi.fn() }));

const PATH = "/Users/me/clippedin";
const NOON = new Date(2026, 10, 5, 12).getTime();
const MODELS = pickCrewModels({
  codex: false,
  claudeModels: ["claude:opus-5.5", "claude:sonnet-5"],
  preferredClaude: "claude:opus-5.5",
});

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  resetCrewsCache();
  setFeatureCardBackend(memoryFeatureCardBackend());
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCrewsCache();
  setFeatureCardBackend(null);
});

const nameOf = (crew: Crew) => (who: string) => crewMemberName(crew, who);

function card(id: string, stage: CrewCard["stage"]): CrewCard {
  return {
    id,
    title: id,
    brief: id,
    stage,
    from: "you",
    round: 0,
    maxRounds: 3,
    rounds: [],
    at: NOON,
  } as unknown as CrewCard;
}

describe("meeting Avos", () => {
  it("is saved the first time it's used, with only Avos itself", () => {
    expect(getCrew(PATH)).toBeUndefined();
    const crew = ensureAvos(PATH, NOON);
    expect(crew.members).toEqual([
      { id: "lead", role: "lead", critter: "lead" },
    ]);
    expect(crew.on).toBe(false);
    expect(crewMemberName(crew, "lead")).toBe("Avos");
    // Meeting it, it looks at you.
    expect(avosGlance(PATH, crew, { name: nameOf(crew) })).toMatchObject({
      note: null,
      state: "watching",
      line: "Hasn't met you yet",
    });
    expect(avosMet(getCrew(PATH))).toBe(true);
    // Opening it again changes nothing.
    expect(ensureAvos(PATH, NOON + 1)).toBe(getCrew(PATH));
  });

  it("drops the three teammates a team that never started came with", () => {
    ensureCrewSaved(PATH);
    expect(getCrew(PATH)!.members.map((member) => member.role)).toEqual([
      "builder",
      "checker",
      "security",
    ]);
    const crew = ensureAvos(PATH);
    expect(crew.members.map((member) => member.role)).toEqual(["lead"]);
  });

  it("keeps a team that has worked: its Lead is its Avos, its teammates its helpers", () => {
    updateCrew(PATH, (crew) => ({ ...crew, on: true, onAt: NOON - 1 }));
    const crew = ensureAvos(PATH);
    expect(crew.members.map((member) => member.role)).toEqual([
      "lead",
      "builder",
      "checker",
      "security",
    ]);
  });
});

describe("Avos at a glance", () => {
  const met = (patch: Partial<Crew> = {}): Crew => ({
    ...newCrew(PATH, NOON),
    members: [{ id: "lead", role: "lead" }],
    on: true,
    onAt: NOON,
    ...patch,
  });

  it("hasn't met you until it's opened", () => {
    expect(avosGlance(PATH, undefined, { name: (who) => who })).toEqual({
      path: PATH,
      note: null,
      state: "still",
      line: "Hasn't met you yet",
    });
  });

  it("watches quietly, and rests while paused or asleep", () => {
    const quiet = met();
    expect(avosGlance(PATH, quiet, { name: nameOf(quiet) })).toMatchObject({
      note: null,
      state: "watching",
      line: "Quiet",
    });
    const paused = met({ paused: true });
    expect(avosGlance(PATH, paused, { name: nameOf(paused) })).toMatchObject({
      note: null,
      state: "resting",
      line: "Paused",
    });
    const asleep = met({ on: false });
    expect(avosGlance(PATH, asleep, { name: nameOf(asleep) })).toMatchObject({
      note: null,
      state: "resting",
    });
  });

  it("says Working with who's doing what", () => {
    const crew = met({
      members: [
        { id: "lead", role: "lead" },
        {
          id: "builder",
          role: "builder",
          doing: { at: NOON, text: "Drafting two articles" },
        },
      ],
    });
    expect(avosGlance(PATH, crew, { name: nameOf(crew) })).toMatchObject({
      note: "working",
      state: "working",
      line: "Builder is drafting two articles",
    });
    expect(
      avosLine(
        met({
          members: [
            {
              id: "lead",
              role: "lead",
              doing: { at: NOON, text: "Answering a message" },
            },
          ],
        }),
        { name: (who) => who },
      ),
    ).toBe("Answering a message");
  });

  it("needs you for a card that's ready or stuck, or a job's run waiting", () => {
    const ready = met({ cards: [card("a", "ready"), card("b", "ready")] });
    expect(avosGlance(PATH, ready, { name: nameOf(ready) })).toMatchObject({
      note: "needs-you",
      state: "needs",
      line: "2 things ready for you",
    });
    const stuck = met({ cards: [card("a", "stuck")] });
    expect(avosLine(stuck, { name: nameOf(stuck) })).toBe(
      "A card needs your answer",
    );
    const job = {
      id: "avos-1",
      owner: { avos: PATH },
      createdAt: NOON,
    } as ScheduledAgent;
    const run = {
      id: "r1",
      scheduleId: "avos-1",
      startedAt: NOON,
      status: "succeeded",
      review: { status: "open" },
    } as unknown as ScheduledRun;
    const quiet = met();
    expect(
      avosGlance(PATH, quiet, {
        name: nameOf(quiet),
        jobs: { agents: [job], runs: [run] },
      }),
    ).toMatchObject({ note: "needs-you", line: "1 thing ready for you" });
  });
});

describe("building with Avos", () => {
  const wake = vi.fn(async (path: string) => {
    updateCrew(path, (crew) => ({ ...crew, on: true, onAt: NOON }));
    return null;
  });
  let gitNeeded: "no-git" | "no-commit" | null = null;
  const setUpGit = vi.fn();
  let restore: () => void;
  beforeEach(() => {
    gitNeeded = null;
    wake.mockClear();
    setUpGit.mockClear();
    restore = installCrewWorkspace({
      openChat: async () => null,
      openCrew: () => undefined,
      openSettings: () => undefined,
      stop: async () => undefined,
      wake,
      gitNeeded: async () => gitNeeded,
      setUpGit,
    });
  });
  afterEach(() => restore());

  it("offers Set up Git instead of building in a folder without Git", async () => {
    gitNeeded = "no-git";
    ensureAvos(PATH);
    updateCrew(PATH, (crew) => ({ ...crew, on: true, onAt: NOON }));
    const idea = (await addFeatureIdea(PATH, { title: "Fix pricing table" }))!;
    expect(await giveCardToCrew(PATH, idea, NOON)).toBe(BUILDING_NEEDS_GIT);
    const crew = getCrew(PATH)!;
    expect(crewCard(crew, idea.id)).toBeUndefined();
    expect(crew.feed.at(-1)).toMatchObject({
      who: "lead",
      text: BUILDING_NEEDS_GIT,
      action: "set-up-git",
    });
    // No helpers come for work that can't start.
    expect(crew.members.map((member) => member.role)).toEqual(["lead"]);
    // Asked again, it says so once.
    await giveCardToCrew(PATH, idea, NOON + 1);
    expect(
      getCrew(PATH)!.feed.filter((entry) => entry.action === "set-up-git"),
    ).toHaveLength(1);
  });

  it("brings in a Builder and a Checker the first time work needs building", async () => {
    ensureAvos(PATH);
    updateCrew(PATH, (crew) => ({ ...crew, on: true, onAt: NOON }));
    const idea = (await addFeatureIdea(PATH, { title: "Fix pricing table" }))!;
    expect(await giveCardToCrew(PATH, idea, NOON)).toBeNull();
    const crew = getCrew(PATH)!;
    expect(crew.members.map((member) => member.role)).toEqual([
      "lead",
      "builder",
      "checker",
    ]);
    expect(crewCard(crew, idea.id)?.stage).toBe("queued");
    expect(
      crew.feed.some(
        (entry) =>
          entry.who === "lead" &&
          entry.text === "I brought in Builder and Checker to build this.",
      ),
    ).toBe(true);
    // Once there, nobody else is brought in.
    expect(bringInBuilders(PATH, NOON, MODELS)).toBeNull();
  });

  it("wakes Avos when you write to it", async () => {
    ensureAvos(PATH);
    expect(await tellTeam(PATH, "Watch the Notion page", "lead", NOON)).toBe(
      null,
    );
    expect(wake).toHaveBeenCalledWith(PATH);
    expect(getCrew(PATH)!.talks?.at(-1)).toMatchObject({
      from: "you",
      to: "lead",
      text: "Watch the Notion page",
    });
  });

  it("keeps Avos's introduction above your first answer", async () => {
    ensureAvos(PATH);
    expect(avosUnmet(getCrew(PATH))).toBe(true);
    expect(
      await tellTeam(PATH, "Watch the Notion page", "lead", NOON),
    ).toBeNull();
    const crew = getCrew(PATH)!;
    expect(avosUnmet(crew)).toBe(false);
    expect(
      teamPosts(crew, nameOf(crew)).map((post) => [
        post.kind,
        "author" in post ? post.author.name : "",
        post.text,
      ]),
    ).toEqual([
      ["post", "Avos", "Hi, I'm Avos. I'll look after clippedin."],
      [
        "post",
        "Avos",
        "What should I keep an eye on, and what's coming up this week?",
      ],
      ["you", "", "Watch the Notion page"],
    ]);
    // Only the first time.
    await tellTeam(PATH, "And the GitHub issues", "lead", NOON + 1);
    expect(
      getCrew(PATH)!.feed.filter((entry) => entry.kind === "say"),
    ).toHaveLength(2);
  });
});

describe("This week", () => {
  it("lists what needs you, what's going on, what Avos keeps an eye on, and what's done", () => {
    const crew: Crew = {
      ...newCrew(PATH, NOON),
      on: true,
      onAt: NOON,
      members: [
        {
          id: "lead",
          role: "lead",
          doing: { at: NOON, text: "Answering a message" },
        },
        {
          id: "builder",
          role: "builder",
          doing: { at: NOON, text: "Building Insights page copy" },
        },
      ],
      cards: [
        card("Pricing table", "ready"),
        { ...card("Cover image", "stuck") },
        { ...card("Insights page copy", "building") },
        {
          ...card("Footer links", "applied"),
          endedAt: NOON - 2 * 24 * 60 * 60_000,
        },
        {
          ...card("Old thing", "applied"),
          endedAt: NOON - 9 * 24 * 60 * 60_000,
        },
      ],
    };
    const job = {
      id: "avos-1",
      name: "Website Articles in Notion",
      enabled: true,
      owner: { avos: PATH },
      createdAt: NOON,
    } as ScheduledAgent;
    const run = {
      id: "r1",
      scheduleId: "avos-1",
      startedAt: NOON,
      status: "succeeded",
      review: { status: "open", kind: "publish", title: "2 new articles" },
    } as unknown as ScheduledRun;
    const week = avosWeek(crew, {
      jobs: { agents: [job], runs: [run] },
      now: NOON,
    });
    expect(week.needs.map((row) => [row.text, row.open?.kind])).toEqual([
      ["“Cover image” needs your answer", "card"],
      ["Look at “Pricing table”", "review"],
      ["Ready to publish: 2 new articles", "run"],
    ]);
    // The card at work once, then Avos answering you.
    expect(week.doing.map((row) => row.text)).toEqual([
      "Insights page copy",
      "Answering a message",
    ]);
    expect(week.watching.map((row) => [row.text, row.open?.kind])).toEqual([
      ["Website Articles in Notion", "job"],
    ]);
    expect(week.done.map((row) => row.text)).toEqual(["Footer links"]);
  });
});
