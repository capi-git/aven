// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  stopTeamForProject,
  teammateChatReady,
  TOO_LONG_FOR_A_GOAL,
  TOO_LONG_FOR_EVERYONE,
  installCrewWorkspace,
  pickCrewModels,
  startTeamFrom,
  teamIsPreset,
  teamUnstarted,
  tellTeam,
  tellTeammate,
} from "./crewActions";
import { CREW_TEAM_PRESETS } from "./crewPresets";
import {
  activeCrews,
  CREW_GOAL_MAX,
  CREW_NOTE_MAX,
  crewCard,
  crewMemberName,
  ensureCrewSaved,
  getCrew,
  readCrew,
  resetCrewsCache,
  updateCrew,
  CREWS_KEY,
} from "./crews";
import { memoryStorage } from "./devSmoke";
import {
  featureBoardState,
  memoryFeatureCardBackend,
  setFeatureCardBackend,
} from "./featureCards";
import { resetProjectBotsCache } from "./projectBots";
import { teamPosts } from "./teamThread";

vi.mock("./fs", () => ({ notifyGitChanged: vi.fn() }));

const PATH = "/Users/me/pom";
const NOON = new Date(2026, 10, 1, 12).getTime();
const MODELS = pickCrewModels({
  codex: true,
  claudeModels: ["claude:opus-5.5", "claude:sonnet-5"],
  preferredClaude: "claude:opus-5.5",
  preferredCodex: "codex:gpt-5.6",
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

const on = () =>
  updateCrew(PATH, (crew) => ({ ...crew, on: true, onAt: NOON - 1 }));

describe("writing to the team", () => {
  it("keeps your words as your message and gives the team a card", async () => {
    on();
    const words = "Build a timer screen: start, pause, and a ring.";
    expect(await tellTeam(PATH, words, "card", NOON)).toBeNull();
    const crew = getCrew(PATH)!;
    // It stands for the Feed's own line, "You gave the team …".
    const echo = crew.feed.find((entry) => entry.text.startsWith("You gave"));
    expect(crew.messages).toEqual([
      {
        id: expect.any(String),
        at: NOON,
        text: words,
        as: "card",
        echo: echo!.id,
      },
    ]);
    const [board] = featureBoardState(PATH).cards;
    expect(crewCard(crew, board!.id)).toMatchObject({
      stage: "queued",
      from: "you",
    });
    // The Feed's own line for it shares the moment: the chat shows yours.
    expect(crew.feed.at(-1)).toMatchObject({ who: "you", at: NOON });
  });

  it("a rule or a goal, as you chose", async () => {
    on();
    await tellTeam(PATH, "Use pnpm, not npm", "rule", NOON);
    await tellTeam(PATH, "A Pomodoro app people love", "goal", NOON + 1);
    const crew = getCrew(PATH)!;
    expect(crew.notes.map((note) => note.text)).toEqual(["Use pnpm, not npm"]);
    expect(crew.goal?.text).toBe("A Pomodoro app people love");
    expect(crew.messages?.map((message) => message.as)).toEqual([
      "rule",
      "goal",
    ]);
    expect(featureBoardState(PATH).cards).toEqual([]);
  });

  it("a nudge starts what waits: it isn't called a card, and what it did stays in the thread", async () => {
    updateCrew(PATH, (crew) => ({
      ...crew,
      on: true,
      onAt: NOON - 1,
      paused: true,
    }));
    expect(await tellTeam(PATH, "keep going", "card", NOON)).toBeNull();
    const crew = getCrew(PATH)!;
    expect(featureBoardState(PATH).cards).toEqual([]);
    const [message] = crew.messages!;
    expect(message).not.toHaveProperty("as");
    const posts = teamPosts(crew, (who) => crewMemberName(crew, who));
    expect(
      posts.map((post) => [post.kind, post.text, "as" in post ? post.as : ""]),
    ).toEqual([
      // Your words, not called a card.
      ["you", "keep going", ""],
      // Only the Feed's own copy of your words is left out.
      ["event", "You resumed the team", ""],
      ["event", "Tell the team what to build, or add an idea.", ""],
    ]);
  });

  it("refuses words too long for a card rather than cutting them", async () => {
    on();
    const words = "x".repeat(CREW_NOTE_MAX + 1);
    expect(await tellTeam(PATH, words, "card", NOON)).toBe(
      TOO_LONG_FOR_EVERYONE,
    );
    expect(getCrew(PATH)?.messages).toBeUndefined();
    expect(featureBoardState(PATH).cards).toEqual([]);
  });

  it("refuses a goal too long to keep, rather than cutting it", async () => {
    on();
    const words = `Ship the timer. ${"a".repeat(CREW_GOAL_MAX + 100)}`;
    expect(await tellTeam(PATH, words, "goal", NOON)).toBe(TOO_LONG_FOR_A_GOAL);
    const crew = getCrew(PATH)!;
    expect(crew.goal).toBeUndefined();
    expect(crew.messages).toBeUndefined();
  });

  it("keeps nothing when the team is off", async () => {
    expect(await tellTeam(PATH, "Build it", "card", NOON)).toBe(
      "Turn the team on first.",
    );
    expect(getCrew(PATH)?.messages).toBeUndefined();
    expect(featureBoardState(PATH).cards).toEqual([]);
  });
});

describe("writing to one teammate", () => {
  it("goes to its own chat as your message, and queues nothing", async () => {
    on();
    const sendToMember = vi.fn(async () => null);
    const uninstall = installCrewWorkspace({
      openChat: vi.fn(),
      openCrew: vi.fn(),
      openSettings: vi.fn(),
      stop: vi.fn(async () => undefined),
      sendToMember,
    });
    try {
      expect(
        await tellTeammate(PATH, "checker", "Look at the ring too", NOON),
      ).toBeNull();
    } finally {
      uninstall();
    }
    expect(sendToMember).toHaveBeenCalledWith(
      PATH,
      "checker",
      "Look at the ring too",
    );
    const crew = getCrew(PATH)!;
    expect(crew.messages).toEqual([
      {
        id: expect.any(String),
        at: NOON,
        text: "Look at the ring too",
        to: "checker",
      },
    ]);
    // Nothing becomes a card by itself.
    expect(crew.cards).toEqual([]);
    expect(featureBoardState(PATH).cards).toEqual([]);
  });

  it("says why when its chat couldn't take it, and keeps nothing", async () => {
    on();
    const uninstall = installCrewWorkspace({
      openChat: vi.fn(),
      openCrew: vi.fn(),
      openSettings: vi.fn(),
      stop: vi.fn(async () => undefined),
      sendToMember: async () => "Its chat starts with the team's first card.",
    });
    try {
      expect(await tellTeammate(PATH, "builder", "hi", NOON)).toBe(
        "Its chat starts with the team's first card.",
      );
      expect(await tellTeammate(PATH, "nobody", "hi", NOON)).toBe(
        "That teammate isn't in the team.",
      );
    } finally {
      uninstall();
    }
    expect(getCrew(PATH)?.messages).toBeUndefined();
  });
});

describe("starting from a suggested team", () => {
  it("only before the team has ever started; its Checker stays as it is", () => {
    ensureCrewSaved(PATH);
    updateCrew(PATH, (crew) => ({
      ...crew,
      members: crew.members.map((member) =>
        member.role === "checker"
          ? { ...member, instructions: "Run the e2e tests." }
          : member,
      ),
    }));
    const crew = getCrew(PATH)!;
    expect(teamUnstarted(crew)).toBe(true);
    const [ship, polish] = CREW_TEAM_PRESETS;
    expect(teamIsPreset(crew, ship!)).toBe(true);
    expect(startTeamFrom(PATH, "polish", MODELS)).toBeNull();
    const next = getCrew(PATH)!;
    expect(teamIsPreset(next, polish!)).toBe(true);
    expect(
      next.members.find((member) => member.role === "checker")?.instructions,
    ).toBe("Run the e2e tests.");
    // Each new one on its role's usual app: a Builder on Claude.
    expect(
      next.members.find((member) => member.preset === "designer"),
    ).toMatchObject({ harness: "claude", model: "claude:opus-5.5" });
    on();
    expect(startTeamFrom(PATH, "ship", MODELS)).toBe(
      "Add or remove teammates one at a time once the team has started.",
    );
  });

  it("saves a project's team before it is built, off, with its usual teammates", () => {
    expect(getCrew(PATH)).toBeUndefined();
    ensureCrewSaved(PATH);
    const saved = JSON.parse(localStorage.getItem(CREWS_KEY)!) as {
      crews: Record<string, unknown>;
    };
    const crew = readCrew(Object.values(saved.crews)[0])!;
    expect(crew.on).toBe(false);
    expect(crew.members.map((member) => member.role)).toEqual([
      "builder",
      "checker",
      "security",
    ]);
  });
});

describe("a project you delete or archive", () => {
  it("its team stops, keeping its cards, copy and branch; an archived project's team never works", async () => {
    updateCrew(PATH, (crew) => ({
      ...crew,
      on: true,
      onAt: NOON - 1,
      copy: { path: "/copies/pom", branch: "aven/crew/pom", root: PATH },
      stack: { base: "a".repeat(40) },
    }));
    expect(activeCrews().map((crew) => crew.path)).toEqual([PATH]);
    // Archived elsewhere: its work is out of reach, so it isn't at work.
    localStorage.setItem(
      "monocode.archivedProjects",
      JSON.stringify([{ path: PATH, archivedAt: 1 }]),
    );
    expect(activeCrews()).toEqual([]);
    await stopTeamForProject(PATH);
    const crew = getCrew(PATH)!;
    expect(crew.on).toBe(false);
    expect(crew.copy?.branch).toBe("aven/crew/pom");
    expect(crew.stack?.base).toBe("a".repeat(40));
  });

  it("a project that only fell off the recent list keeps its team at work", () => {
    on();
    // The recent list keeps 20 projects; this one isn't among them.
    localStorage.setItem(
      "monocode.recentProjects",
      JSON.stringify([{ path: "/Users/me/other", openedAt: 1 }]),
    );
    expect(activeCrews().map((crew) => crew.path)).toEqual([PATH]);
  });
});

describe("a teammate's own chat", () => {
  it("waits for the team's copy, except the Fixer's, which is the bot's", () => {
    on();
    const crew = getCrew(PATH)!;
    expect(teammateChatReady(crew, "builder")).toBe(false);
    expect(
      teammateChatReady(
        { ...crew, members: [...crew.members, { id: "fixer", role: "fixer" }] },
        "fixer",
      ),
    ).toBe(true);
    expect(
      teammateChatReady(
        { ...crew, copy: { path: "/c", branch: "b", root: PATH } },
        "builder",
      ),
    ).toBe(true);
  });
});

describe("a suggested team, once you've changed a teammate", () => {
  it("keeps that teammate and says so", () => {
    ensureCrewSaved(PATH);
    updateCrew(PATH, (crew) => ({
      ...crew,
      members: crew.members.map((member) =>
        member.id === "security" ? { ...member, model: "codex:gpt-9" } : member,
      ),
    }));
    expect(startTeamFrom(PATH, "polish", MODELS)).toBe(
      "Kept Security: you changed its settings. Remove it from its page if you don't need it.",
    );
    const roles = getCrew(PATH)!.members.map(
      (member) => member.preset ?? member.id,
    );
    // The plain Builder (never changed) left; Security stayed.
    expect(roles.sort()).toEqual(["checker", "designer", "security", "tester"]);
  });
});
