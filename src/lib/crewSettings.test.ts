import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addCrewMember,
  crewCardChoice,
  crewRoutesFor,
  crewScopeList,
  giveCardToCrew,
  removeCrewMember,
  setCrewLimit,
  setCrewRoutes,
  setDefaultBuilder,
  turnOnCrew,
  updateCrewMember,
} from "./crewActions";
import { crewGate } from "./crewLimits";
import { crewChatModel } from "./crewModels";
import {
  CREWS_BACKUP_KEY,
  CREWS_KEY,
  CREW_ALL_RUNS_PER_DAY,
  cardBuilder,
  cardMentions,
  crewCard,
  crewForChat,
  crewMemberApp,
  crewMemberById,
  crewMemberName,
  crewsAllRunsPerDay,
  getCrew,
  inScope,
  outsideScope,
  readCrew,
  resetCrewsCache,
  routeCard,
  setCrewsAllRunsPerDay,
  updateCrew,
  withCard,
  type Crew,
} from "./crews";
import { queueCard } from "./crewLoop";
import { memoryStorage } from "./devSmoke";
import { resetProjectBotsCache } from "./projectBots";

vi.mock("./featureCards", async (original) => ({
  ...(await original<typeof import("./featureCards")>()),
  moveFeatureCard: vi.fn(async () => undefined),
}));

const PATH = "/Users/me/aven-site";
const NOW = new Date(2026, 9, 29, 12).getTime();

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

/** The crew on, with a Builder, a Checker and a Scout unless the test says. */
function crewWith(patch: Partial<Crew> = {}): Crew {
  return updateCrew(PATH, (crew) => ({
    ...crew,
    on: true,
    onAt: 1,
    members: [
      { id: "builder", role: "builder" },
      { id: "checker", role: "checker" },
      { id: "scout", role: "scout" },
    ],
    ...patch,
  }));
}

const MOLE = {
  id: "builder-2",
  role: "builder" as const,
  name: "Mole",
};

describe("routing a card to a Builder", () => {
  it("takes the first rule whose words the card mentions, else the default", () => {
    const crew = crewWith({
      members: [
        { id: "builder", role: "builder" },
        MOLE,
        { id: "builder-3", role: "builder", name: "Wren" },
        { id: "checker", role: "checker" },
      ],
      routes: [
        { id: "r1", words: ["css", "design"], to: "builder-2" },
        { id: "r2", words: ["api"], to: "builder-3" },
        { id: "r3", words: ["design"], to: "builder-3" },
      ],
    });
    expect(routeCard(crew, { title: "Fix the CSS of the hero" })?.id).toBe(
      "builder-2",
    );
    // In order: "design" matches the first rule before the third.
    expect(routeCard(crew, { title: "New design for the API" })?.id).toBe(
      "builder-2",
    );
    expect(
      routeCard(crew, { title: "Rate limits", note: "On the #api" })?.id,
    ).toBe("builder-3");
    // Whole words only: "capital" doesn't mention "api".
    expect(routeCard(crew, { title: "Capitalise headings" })?.id).toBe(
      "builder",
    );
    expect(
      routeCard(
        { ...crew, defaultBuilder: "builder-3" },
        { title: "Nothing matching" },
      )?.id,
    ).toBe("builder-3");
  });

  it("skips Builders that are off, and keeps a card with the one you chose while it's on", () => {
    const crew = crewWith({
      members: [
        { id: "builder", role: "builder" },
        { ...MOLE, paused: true },
        { id: "checker", role: "checker" },
      ],
      routes: [{ id: "r1", words: ["css"], to: "builder-2" }],
    });
    expect(routeCard(crew, { title: "css" })?.id).toBe("builder");
    const card = queueCard(
      {
        id: "c",
        title: "css",
        brief: "css",
        from: "you",
        maxRounds: 3,
        builderId: "builder",
      },
      NOW,
    );
    expect(cardBuilder(crew, card)?.id).toBe("builder");
    const on = {
      ...crew,
      members: crew.members.map((m) => ({ ...m, paused: undefined })),
    };
    expect(cardBuilder(on, { ...card, builderId: "builder-2" })?.id).toBe(
      "builder-2",
    );
    expect(routeCard({ ...crew, members: [] }, { title: "x" })).toBeUndefined();
  });

  it("matches words and #labels, case aside, never as part of another word", () => {
    expect(cardMentions("fix the ui\n", "UI")).toBe(true);
    expect(cardMentions("tagged #frontend", "frontend")).toBe(true);
    expect(cardMentions("build", "ui")).toBe(false);
    expect(cardMentions("c++ (x)", "c++")).toBe(true);
  });

  it("keeps only rules for the crew's own Builders, with tidy words", () => {
    const crew = crewWith({
      members: [
        { id: "builder", role: "builder" },
        MOLE,
        { id: "checker", role: "checker" },
      ],
    });
    expect(
      crewRoutesFor(crew, [
        { words: "CSS, #design,, css", to: "builder-2" },
        { words: ["x"], to: "checker" },
        { words: "", to: "builder" },
        { words: "api", to: "nobody" },
      ]),
    ).toEqual([{ id: "rule-1", words: ["css", "design"], to: "builder-2" }]);
    setCrewRoutes(PATH, [{ id: "r", words: "ui", to: "builder-2" }]);
    setDefaultBuilder(PATH, "builder-2");
    expect(getCrew(PATH)).toMatchObject({
      routes: [{ id: "r", words: ["ui"], to: "builder-2" }],
      defaultBuilder: "builder-2",
    });
    // Only a Builder can be the default.
    setDefaultBuilder(PATH, "checker");
    expect(getCrew(PATH)!.defaultBuilder).toBeUndefined();
  });
});

describe("adding and removing members", () => {
  it("adds several Builders and Checkers, each with its own id and a free critter", () => {
    crewWith();
    const first = addCrewMember(PATH, "builder");
    // A Builder runs on Claude Code: Codex isn't kept for it.
    const second = addCrewMember(PATH, "builder", { harness: "codex" });
    const checker = addCrewMember(PATH, "checker", { harness: "codex" });
    expect(first).toEqual({ id: "builder-2" });
    expect(second).toEqual({ id: "builder-3" });
    expect(checker).toEqual({ id: "checker-2" });
    const crew = getCrew(PATH)!;
    const critters = crew.members.map(
      (member) => member.critter ?? member.role,
    );
    expect(new Set(critters).size).toBe(critters.length);
    expect(crewMemberById(crew, "builder-3")?.harness).toBeUndefined();
    expect(crewMemberById(crew, "checker-2")?.harness).toBe("codex");
    expect(crewMemberName(crew, "builder-2")).not.toBe(
      crewMemberName(crew, "builder"),
    );
  });

  it("keeps one Scout, and a custom member needs a title and builds or checks", () => {
    crewWith();
    expect(addCrewMember(PATH, "scout")).toEqual({
      error: "This crew already has a Scout.",
    });
    expect(addCrewMember(PATH, "custom", { label: " " })).toEqual({
      error: "Give your member a title, like Designer.",
    });
    const designer = addCrewMember(PATH, "custom", {
      label: "Designer",
      job: "Makes it look right",
      role: "checker",
      harness: "cursor",
      instructions: "Check contrast.",
    });
    expect(designer).toEqual({ id: "checker-2" });
    expect(crewMemberById(getCrew(PATH)!, "checker-2")).toMatchObject({
      role: "checker",
      label: "Designer",
      job: "Makes it look right",
      instructions: "Check contrast.",
    });
    // An app that can't keep its rules is never stored.
    expect(
      crewMemberById(getCrew(PATH)!, "checker-2")?.harness,
    ).toBeUndefined();
  });

  it("removes a member: its rules and default go, its cards go back to the rules, its chat is retired", () => {
    crewWith({
      members: [
        { id: "builder", role: "builder" },
        { ...MOLE, sessionId: "mole-chat" },
        { id: "checker", role: "checker" },
      ],
      routes: [{ id: "r1", words: ["css"], to: "builder-2" }],
      defaultBuilder: "builder-2",
    });
    updateCrew(PATH, (crew) =>
      withCard(
        crew,
        queueCard(
          {
            id: "c",
            title: "c",
            brief: "c",
            from: "you",
            maxRounds: 3,
            builderId: "builder-2",
          },
          NOW,
        ),
      ),
    );
    expect(crewForChat("mole-chat")?.member.id).toBe("builder-2");
    expect(removeCrewMember(PATH, "builder-2")).toBeNull();
    const crew = getCrew(PATH)!;
    expect(crewMemberById(crew, "builder-2")).toBeUndefined();
    expect(crew.routes).toBeUndefined();
    expect(crew.defaultBuilder).toBeUndefined();
    expect(crewCard(crew, "c")?.builderId).toBeUndefined();
    // Its chat is still the crew's, and marked removed.
    expect(crewForChat("mole-chat")).toMatchObject({
      retired: true,
      member: { role: "builder", sessionId: "mole-chat" },
    });
  });

  it("keeps the last Builder and Checker, one at work, and the Fixer", () => {
    crewWith({
      members: [
        { id: "builder", role: "builder" },
        {
          id: "builder-2",
          role: "builder",
          doing: { at: 1, text: "Building" },
        },
        { id: "checker", role: "checker" },
        { id: "fixer", role: "fixer" },
      ],
    });
    expect(removeCrewMember(PATH, "checker")).toBe("A crew needs a Checker.");
    expect(removeCrewMember(PATH, "builder-2")).toBe(
      "It's working on a card. Stop the card first.",
    );
    expect(removeCrewMember(PATH, "fixer")).toMatch(/project's bot/);
    expect(removeCrewMember(PATH, "builder")).toBeNull();
    // Now the last Builder: it stays either way.
    expect(removeCrewMember(PATH, "builder-2")).toBe("A crew needs a Builder.");
  });
});

describe("changing a member", () => {
  it("runs only on an app that keeps its rules; a new app starts from its own model", () => {
    crewWith({
      members: [
        {
          id: "builder",
          role: "builder",
          harness: "claude",
          model: "claude:opus",
          effort: "high",
        },
        {
          id: "checker",
          role: "checker",
          harness: "codex",
          fallback: { harness: "claude", at: 1 },
        },
      ],
    });
    expect(updateCrewMember(PATH, "builder", { harness: "cursor" })).toMatch(
      /Claude Code or Codex/,
    );
    expect(crewMemberById(getCrew(PATH)!, "builder")?.harness).toBe("claude");
    // A Builder writes in the copy: only Claude Code keeps it out of the
    // copy's settings, so it never runs on Codex, even stored that way.
    expect(updateCrewMember(PATH, "builder", { harness: "codex" })).toMatch(
      /Builder runs on Claude Code/,
    );
    updateCrew(PATH, (crew) => ({
      ...crew,
      members: crew.members.map((member) =>
        member.id === "builder" ? { ...member, harness: "codex" } : member,
      ),
    }));
    expect(crewMemberApp(crewMemberById(getCrew(PATH)!, "builder"))).toEqual({
      harness: "claude",
    });
    // A new app for a Checker starts from that app's own model.
    expect(updateCrewMember(PATH, "checker", { harness: "claude" })).toBeNull();
    expect(crewMemberById(getCrew(PATH)!, "checker")?.fallback).toBeUndefined();
    expect(updateCrewMember(PATH, "checker", { harness: "codex" })).toBeNull();
    expect(crewMemberById(getCrew(PATH)!, "checker")).toEqual({
      id: "checker",
      role: "checker",
      harness: "codex",
    });
  });

  it("tidies names, critters, instructions, scope and the Scout's rhythm", () => {
    crewWith();
    expect(updateCrewMember(PATH, "builder", { critter: "dragon" })).toMatch(
      /critter/,
    );
    updateCrewMember(PATH, "builder", {
      name: "  Mole  ",
      critter: "hedgehog",
      instructions: "x".repeat(5_000),
      scope: `./src/ui/\n${PATH}/src/styles/*.css, src/ui`,
      paused: true,
    });
    updateCrewMember(PATH, "builder", { schedule: "weekly" });
    updateCrewMember(PATH, "scout", { schedule: "weekly" });
    const crew = getCrew(PATH)!;
    expect(crewMemberById(crew, "builder")).toMatchObject({
      name: "Mole",
      critter: "hedgehog",
      scope: ["src/ui", "src/styles/*.css"],
      paused: true,
    });
    expect(crewMemberById(crew, "builder")?.instructions).toHaveLength(2_000);
    expect(crewMemberById(crew, "builder")?.schedule).toBeUndefined();
    expect(crewMemberById(crew, "scout")?.schedule).toBe("weekly");
    updateCrewMember(PATH, "builder", { scope: "", name: null, paused: false });
    expect(crewMemberById(getCrew(PATH)!, "builder")).toEqual({
      id: "builder",
      role: "builder",
      critter: "hedgehog",
      instructions: "x".repeat(2_000),
    });
    expect(crewScopeList(["src//", "  "])).toEqual({ scope: ["src"] });
    // A path that leaves the project, or is outside it, is refused, never
    // saved as "anywhere".
    expect(
      updateCrewMember(PATH, "builder", { scope: "src/ui\n../secrets" }),
    ).toMatch(/leaves the project/);
    expect(updateCrewMember(PATH, "builder", { scope: "/etc" })).toMatch(
      /outside the project/,
    );
    expect(crewScopeList(["a/../b"])).toHaveProperty("error");
  });

  it("keeps your app and model when the crew turns on again", () => {
    crewWith({
      on: false,
      members: [
        { id: "builder", role: "builder", harness: "codex", model: "gpt-x" },
        { id: "builder-2", role: "builder" },
        { id: "checker", role: "checker" },
      ],
    });
    turnOnCrew(PATH, {
      builder: { harness: "claude", model: "claude:opus" },
      checker: { harness: "codex", model: "gpt-y" },
      scout: { harness: "claude", model: "claude:haiku" },
    });
    const crew = getCrew(PATH)!;
    expect(crewMemberById(crew, "builder")).toMatchObject({
      harness: "codex",
      model: "gpt-x",
    });
    expect(crewMemberById(crew, "builder-2")).toMatchObject({
      harness: "claude",
      model: "claude:opus",
    });
    expect(crewMemberById(crew, "checker")).toMatchObject({
      harness: "codex",
      model: "gpt-y",
    });
  });
});

describe("a card's own Builder, Checker, model, effort and rounds", () => {
  it("keeps a choice to the crew's own members and rounds in range", () => {
    const crew = crewWith({
      members: [
        { id: "builder", role: "builder" },
        MOLE,
        { id: "checker", role: "checker" },
      ],
    });
    expect(
      crewCardChoice(crew, {
        builderId: "checker",
        checkerId: "builder",
        maxRounds: 99,
        model: "  ",
      }),
    ).toEqual({ maxRounds: 5 });
    expect(crewCardChoice(crew, { maxRounds: 0 })).toEqual({ maxRounds: 1 });
    expect(crewCardChoice(crew, undefined)).toEqual({ maxRounds: 3 });
    expect(
      crewCardChoice(crew, {
        builderId: "builder-2",
        checkerId: "checker",
        model: "claude:big",
        effort: "high",
        maxRounds: 2,
      }),
    ).toEqual({
      builderId: "builder-2",
      checkerId: "checker",
      model: "claude:big",
      effort: "high",
      maxRounds: 2,
    });
  });

  it("queues the card with what you chose, and says who it's for", async () => {
    crewWith({
      members: [
        { id: "builder", role: "builder" },
        MOLE,
        { id: "checker", role: "checker" },
      ],
    });
    await giveCardToCrew(PATH, { id: "c1", title: "Hero" }, NOW, {
      builderId: "builder-2",
      model: "claude:big",
      effort: "high",
      maxRounds: 2,
    });
    expect(crewCard(getCrew(PATH)!, "c1")).toMatchObject({
      stage: "queued",
      builderId: "builder-2",
      override: { model: "claude:big", effort: "high" },
      maxRounds: 2,
    });
    expect(getCrew(PATH)!.feed.at(-1)?.text).toBe(
      "You gave the crew “Hero” for Mole",
    );
    await giveCardToCrew(PATH, { id: "c2", title: "Plain" }, NOW);
    const plain = crewCard(getCrew(PATH)!, "c2")!;
    expect(plain.builderId).toBeUndefined();
    expect(plain.override).toBeUndefined();
    expect(plain.maxRounds).toBe(3);
  });

  it("applies the card's model and effort on its Builder's own app only", () => {
    expect(
      crewChatModel({
        harness: "claude",
        memberModel: "claude:opus",
        override: { model: "claude:sonnet" },
        preferred: "claude:default",
      }).model,
    ).toBe("claude:sonnet");
    expect(
      crewChatModel({
        harness: "claude",
        memberModel: "claude:opus",
        preferred: "claude:default",
      }).model,
    ).toBe("claude:opus");
    expect(
      crewChatModel({ harness: "codex", preferred: "codex:default" }).model,
    ).toBe("codex:default");
  });
});

describe("limits you set", () => {
  it("keeps each limit within its range", () => {
    crewWith();
    const cases: [Parameters<typeof setCrewLimit>[1], number, number][] = [
      ["roundsPerCard", 0, 1],
      ["roundsPerCard", 9, 5],
      ["runsPerDay", 0, 1],
      ["runsPerDay", 999, 200],
      ["autoStartsPerDay", -1, 0],
      ["autoStartsPerDay", 50, 20],
      ["ideasPerDay", 99, 10],
      ["turnMinutes", 1, 5],
      ["turnMinutes", 600, 120],
      ["pauseAtPercent", 0, 10],
      ["pauseAtPercent", 150, 100],
    ];
    for (const [name, value, expected] of cases) {
      setCrewLimit(PATH, name, value);
      expect(getCrew(PATH)!.limits[name]).toBe(expected);
    }
    setCrewLimit(PATH, "runsPerDay", Number.NaN);
    expect(getCrew(PATH)!.limits.runsPerDay).toBe(200);
  });

  it("caps every crew together at your number", () => {
    expect(crewsAllRunsPerDay()).toBe(CREW_ALL_RUNS_PER_DAY);
    setCrewsAllRunsPerDay(0);
    expect(crewsAllRunsPerDay()).toBe(1);
    setCrewsAllRunsPerDay(10_000);
    expect(crewsAllRunsPerDay()).toBe(500);
    setCrewsAllRunsPerDay(25);
    const crew = crewWith();
    const gate = crewGate({
      crew,
      now: NOW,
      weeklyUsed: 10,
      fixerRuns: 0,
      allRuns: 25,
      allRunsCap: crewsAllRunsPerDay(),
    });
    expect(gate).toMatchObject({
      ok: false,
      reason: "all-crews-cap",
      title: "All crews' 25 runs today are used",
    });
  });
});

describe("what storage keeps", () => {
  it("reads crews saved before members had ids, and saves them back with ids", () => {
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
              { role: "builder", sessionId: "b-chat", model: "claude:opus" },
              { role: "checker", sessionId: "c-chat", harness: "codex" },
              { role: "scout" },
            ],
            limits: { runsPerDay: 20, roundsPerCard: 3, turnMinutes: 20 },
            cards: [],
            feed: [
              { id: "f", at: 1, kind: "start", who: "builder", text: "x" },
            ],
            notes: [],
          },
        },
      }),
    );
    resetCrewsCache();
    const crew = getCrew(PATH)!;
    expect(crew.members.map((member) => member.id)).toEqual([
      "builder",
      "checker",
      "scout",
    ]);
    expect(crewForChat("b-chat")?.member.id).toBe("builder");
    expect(crewForChat("c-chat")?.member.harness).toBe("codex");
    // Still version 1: nothing to back up, nothing lost.
    setCrewsAllRunsPerDay(40);
    updateCrew(PATH, (current) => ({ ...current, paused: true }));
    const saved = JSON.parse(localStorage.getItem(CREWS_KEY)!);
    expect(saved.version).toBe(1);
    expect(saved.allRunsPerDay).toBe(40);
    expect(saved.crews[PATH].members.map((m: { id: string }) => m.id)).toEqual([
      "builder",
      "checker",
      "scout",
    ]);
    expect(localStorage.getItem(CREWS_BACKUP_KEY)).toBeNull();
    resetCrewsCache();
    expect(crewsAllRunsPerDay()).toBe(40);
    expect(getCrew(PATH)!.members[0]).toMatchObject({
      id: "builder",
      sessionId: "b-chat",
      model: "claude:opus",
    });
  });

  it("keeps every new setting across a save and a read", () => {
    const saved = crewWith({
      members: [
        {
          id: "builder",
          role: "builder",
          name: "Bea",
          critter: "moth",
          effort: "high",
          instructions: "Small steps.",
          scope: ["src/ui"],
        },
        MOLE,
        { id: "checker", role: "checker", label: "Designer", job: "Looks" },
        { id: "scout", role: "scout", schedule: "off" },
      ],
      routes: [{ id: "r1", words: ["css"], to: "builder-2" }],
      defaultBuilder: "builder-2",
      retired: [{ sessionId: "old-chat", role: "builder" }],
    });
    updateCrew(PATH, (crew) =>
      withCard(
        crew,
        queueCard(
          {
            id: "c",
            title: "c",
            brief: "c",
            from: "you",
            maxRounds: 2,
            builderId: "builder-2",
            checkerId: "checker",
            override: { model: "m", effort: "low" },
          },
          NOW,
        ),
      ),
    );
    const reread = readCrew(
      JSON.parse(localStorage.getItem(CREWS_KEY)!).crews[PATH],
    )!;
    expect(reread.members).toEqual(saved.members);
    expect(reread.routes).toEqual(saved.routes);
    expect(reread.defaultBuilder).toBe("builder-2");
    expect(reread.retired).toEqual([
      { sessionId: "old-chat", role: "builder" },
    ]);
    expect(crewCard(reread, "c")).toMatchObject({
      builderId: "builder-2",
      checkerId: "checker",
      override: { model: "m", effort: "low" },
      maxRounds: 2,
    });
  });

  it("drops rules and a default that name no member, and an app it can't trust", () => {
    const crew = readCrew({
      path: PATH,
      members: [
        { id: "builder", role: "builder", harness: "cursor" },
        { id: "checker", role: "checker" },
      ],
      routes: [{ id: "r", words: ["x"], to: "ghost" }],
      defaultBuilder: "ghost",
      limits: { turnMinutes: 1, roundsPerCard: 9 },
    })!;
    expect(crew.routes).toBeUndefined();
    expect(crew.defaultBuilder).toBeUndefined();
    expect(crew.members[0].harness).toBeUndefined();
    expect(crew.limits.turnMinutes).toBe(5);
    expect(crew.limits.roundsPerCard).toBe(5);
  });
});

describe("scope", () => {
  it("matches paths and patterns inside the project", () => {
    expect(inScope("src/ui/Button.tsx", ["src/ui"])).toBe(true);
    expect(inScope("src/uikit/x.ts", ["src/ui"])).toBe(false);
    expect(inScope("src/styles/a.css", ["src/styles/*.css"])).toBe(true);
    expect(inScope("src/styles/deep/a.css", ["src/styles/*.css"])).toBe(false);
    expect(inScope("src/a/b/c.test.ts", ["**/*.test.ts"])).toBe(true);
    expect(inScope("anything", [])).toBe(true);
    expect(
      outsideScope(["src/ui/a.ts", "src/server.ts", "README.md"], ["src/ui/"]),
    ).toEqual(["src/server.ts", "README.md"]);
    expect(outsideScope(["x"], undefined)).toEqual([]);
  });
});
