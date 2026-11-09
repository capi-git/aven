// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitingQuestions } from "./avosAnswer";
import {
  ALREADY_ANSWERED,
  addCrewPreset,
  answerCrewCard,
  answerWantsBuilder,
  bringInBuilders,
  pickCrewModels,
} from "./crewActions";
import { queueCard, startCard } from "./crewLoop";
import {
  buildsAnywhere,
  cardBuilder,
  crewCard,
  defaultBuilder,
  ensureAvos,
  getCrew,
  resetCrewsCache,
  updateCrew,
  withCard,
  type CrewCard,
} from "./crews";
import { memoryStorage } from "./devSmoke";
import {
  memoryFeatureCardBackend,
  setFeatureCardBackend,
} from "./featureCards";
import { resetProjectBotsCache } from "./projectBots";
import { teamPosts } from "./teamThread";

vi.mock("./fs", () => ({ notifyGitChanged: vi.fn() }));

const PATH = "/Users/me/pom";
const NOON = new Date(2026, 10, 7, 12).getTime();
const MODELS = pickCrewModels({
  codex: false,
  claudeModels: ["claude:opus-5.5"],
  preferredClaude: "claude:opus-5.5",
});
const ASKED =
  "Tester asked: Fixing the wording means changing the web page and the iPhone app, which I'm not allowed to edit. Can you hand this card to a Builder?";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  resetCrewsCache();
  setFeatureCardBackend(memoryFeatureCardBackend());
});

/** Pom's Avos as it was: a Tester and a Checker, and no Builder. */
function pomWithTesterOnly() {
  ensureAvos(PATH);
  updateCrew(PATH, (crew) => ({ ...crew, on: true, onAt: NOON - 60_000 }));
  for (const key of ["tester", "checker"])
    expect(addCrewPreset(PATH, key)).toHaveProperty("id");
  const tester = getCrew(PATH)!.members.find(
    (member) => member.preset === "tester",
  )!;
  const card: CrewCard = {
    ...startCard(
      queueCard(
        {
          id: "timer",
          title: "Make timer wording match the real timer length",
          brief: "Make timer wording match the real timer length",
          from: "you",
          maxRounds: 3,
        },
        NOON - 50_000,
      ),
      NOON - 40_000,
    ),
    stage: "stuck",
    holder: "builder",
    builderId: tester.id,
    scope: tester.scope,
    stuck: { reason: "question", text: ASKED },
    endedAt: NOON - 10_000,
  };
  updateCrew(PATH, (crew) => withCard(crew, card));
  return tester;
}

describe("a Builder kept to its paths", () => {
  it("doesn't count as the team having a Builder", () => {
    ensureAvos(PATH);
    expect(addCrewPreset(PATH, "tester")).toHaveProperty("id");
    expect(bringInBuilders(PATH, NOON, MODELS)).not.toBeNull();
    const crew = getCrew(PATH)!;
    expect(
      crew.members.filter(buildsAnywhere).map((member) => member.preset),
    ).toEqual(["builder"]);
    // An ordinary card goes to the Builder, not the Tester added first.
    expect(defaultBuilder(crew)?.preset).toBe("builder");
  });
});

describe("answering a helper's question from Avos's chat", () => {
  it("says who asked", () => {
    pomWithTesterOnly();
    expect(waitingQuestions(getCrew(PATH)!)).toMatchObject([
      {
        cardId: "timer",
        title: "Make timer wording match the real timer length",
        who: "Tester",
      },
    ]);
  });

  it("acts on a yes to a Builder: brings one in and hands it the card", () => {
    const tester = pomWithTesterOnly();
    expect(
      answerCrewCard(
        PATH,
        "timer",
        "Yes, just add a builder to help with anything we need to add to POM",
        NOON,
      ),
    ).toBeNull();
    const crew = getCrew(PATH)!;
    const card = crewCard(crew, "timer")!;
    const builder = cardBuilder(crew, card)!;
    expect(builder.id).not.toBe(tester.id);
    expect(buildsAnywhere(builder)).toBe(true);
    expect(card).toMatchObject({
      stage: "building",
      holder: "builder",
      builderId: builder.id,
    });
    // Your words first, then the question they answer, for the Builder.
    expect(card.note).toMatch(
      /^Yes, just add a builder to help with anything we need to add to POM \(This answers: Tester asked: Fixing the wording/,
    );
    expect(
      crew.feed.some(
        (entry) =>
          entry.who === "lead" &&
          entry.text ===
            "I brought in Builder and handed it “Make timer wording match the real timer length”.",
      ),
    ).toBe(true);
    // Your message stays in the chat as the answer to that card.
    const mine = teamPosts(crew, (who) => who).filter(
      (post) => post.kind === "you",
    );
    expect(mine.at(-1)).toMatchObject({
      text: "Yes, just add a builder to help with anything we need to add to POM",
      answers: "Make timer wording match the real timer length",
    });
    expect(waitingQuestions(crew)).toEqual([]);
  });

  it("hands it to the Builder already helping, without bringing in another", () => {
    pomWithTesterOnly();
    expect(addCrewPreset(PATH, "builder")).toHaveProperty("id");
    expect(answerCrewCard(PATH, "timer", "Sure", NOON)).toBeNull();
    const crew = getCrew(PATH)!;
    expect(crew.members.filter(buildsAnywhere)).toHaveLength(1);
    expect(cardBuilder(crew, crewCard(crew, "timer")!)?.preset).toBe("builder");
    expect(crew.feed.at(-2)?.text).toBe(
      "I handed “Make timer wording match the real timer length” to Builder.",
    );
  });

  it("keeps the card with its helper for any other answer", () => {
    const tester = pomWithTesterOnly();
    expect(
      answerCrewCard(PATH, "timer", "No, only fix the tests for now", NOON),
    ).toBeNull();
    const crew = getCrew(PATH)!;
    const card = crewCard(crew, "timer")!;
    expect(card.builderId).toBe(tester.id);
    expect(card.note).toBe("No, only fix the tests for now");
    expect(crew.members.some(buildsAnywhere)).toBe(false);
  });

  it("says so when the question was answered meanwhile", () => {
    pomWithTesterOnly();
    expect(answerCrewCard(PATH, "timer", "Yes", NOON)).toBeNull();
    expect(answerCrewCard(PATH, "timer", "Yes", NOON + 1)).toBe(
      ALREADY_ANSWERED,
    );
  });
});

describe("whether an answer says yes to a Builder", () => {
  const asked = "Can you hand this card to a Builder?";
  it.each([
    [asked, "Yes, just add a builder", true],
    [asked, "yes", true],
    [asked, "Sure, go ahead", true],
    [asked, "Give it to the builder", true],
    [asked, "No, leave it with the tests", false],
    [asked, "Don't add a builder", false],
    [asked, "Only fix the tests", false],
    ["Should the timer count down?", "Yes", false],
    ["Should the timer count down?", "Yes, and add a builder for it", true],
  ])("%s → %s", (question, answer, wants) => {
    expect(answerWantsBuilder(question, answer)).toBe(wants);
  });
});
