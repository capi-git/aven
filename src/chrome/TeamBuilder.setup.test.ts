// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { turnOnCrew } from "../lib/crewActions";
import { setTeamSetupDeps, SETUP_FAILED } from "../lib/crewSetup";
import { crewCard, getCrew, resetCrewsCache, updateCrew } from "../lib/crews";
import { memoryStorage } from "../lib/devSmoke";
import {
  featureBoardState,
  memoryFeatureCardBackend,
  setFeatureCardBackend,
} from "../lib/featureCards";
import { resetProjectBotsCache } from "../lib/projectBots";
import { CrewSettingsSheet } from "./CrewSettingsSheet";

const installed = vi.hoisted(() => ({ ids: new Set(["codex", "cursor"]) }));
vi.mock("../lib/harness/availability", async (original) => ({
  ...(await original<typeof import("../lib/harness/availability")>()),
  probeHarnessAvailability: vi.fn(async () => undefined),
  isHarnessAvailable: (id: string) => installed.ids.has(id),
}));

const PATH = "/Users/me/aven-site";
const MODELS = {
  builder: { harness: "claude" as const, model: "claude:opus" },
  checker: { harness: "codex" as const, model: "codex:gpt" },
  scout: { harness: "claude" as const, model: "claude:haiku" },
  researcher: { harness: "claude" as const, model: "claude:opus" },
};
let root: Root;
let container: HTMLElement;

const proposal = `\`\`\`aven-setup\n${JSON.stringify({
  teammates: [
    { role: "builder", job: "Builds each card in a copy of aven-site" },
    { role: "checker", job: "Runs the tests before you see anything" },
    { role: "researcher", job: "Reads up on ADHD planning" },
  ],
  ideas: [
    { title: "Make the today list hold five things" },
    { title: "What helps people with ADHD plan a day?", by: "researcher" },
  ],
})}\n\`\`\``;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", memoryStorage());
  setFeatureCardBackend(memoryFeatureCardBackend());
  resetProjectBotsCache();
  resetCrewsCache();
  // A team that has never started.
  updateCrew(PATH, (crew) => ({ ...crew, on: false, onAt: undefined }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setTeamSetupDeps(null);
  setFeatureCardBackend(null);
  vi.unstubAllGlobals();
  resetCrewsCache();
});

const sheet = () => document.querySelector<HTMLElement>(".crew-settings")!;
const q = <T extends HTMLElement>(selector: string) =>
  sheet().querySelector<T>(selector)!;
const buttonNamed = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === name,
  );

async function open(onTurnOn = vi.fn(async () => null), onStarted = vi.fn()) {
  await act(async () =>
    root.render(
      createElement(CrewSettingsSheet, {
        path: PATH,
        initialPage: "setup",
        onTurnOn,
        onStarted,
        onClose: () => {},
      }),
    ),
  );
  return { onTurnOn, onStarted };
}

/** Type into a React-controlled box, past React's own value tracking. */
async function type(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    const proto =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("a new team from your words", () => {
  it("describes, suggests, edits, then Start team makes the team and its first ideas", async () => {
    const generate = vi.fn(async () => proposal);
    setTeamSetupDeps({
      model: () => ({ harness: "claude", label: "Claude Haiku" }),
      generate,
      digest: async () => "Top level: src",
      timeoutMs: 1_000,
    });
    const { onTurnOn, onStarted } = await open(
      vi.fn(async () => {
        turnOnCrew(PATH, MODELS);
        return null;
      }),
    );
    expect(sheet().querySelector("h2")?.textContent).toBe(
      "New team for aven-site",
    );
    expect(sheet().textContent).toContain(
      "Say what aven-site is and what you want.",
    );
    // Nothing to start yet: only your words and Suggest.
    expect(q<HTMLButtonElement>("[data-crew-setup-start]").disabled).toBe(true);
    await type(q("textarea"), "An ADHD-friendly planner for iPhone.");
    await act(async () =>
      q<HTMLButtonElement>("[data-crew-setup-suggest]").click(),
    );
    expect(generate).toHaveBeenCalledTimes(1);
    const tiles = () => [
      ...sheet().querySelectorAll<HTMLElement>("[data-crew-setup-role]"),
    ];
    expect(tiles().map((tile) => tile.dataset.crewSetupRole)).toEqual([
      "builder",
      "checker",
      "researcher",
    ]);
    expect(tiles()[2]!.textContent).toContain("Reads up on ADHD planning");
    const rows = () => [
      ...sheet().querySelectorAll<HTMLElement>("[data-crew-setup-idea]"),
    ];
    expect(rows().map((row) => row.dataset.crewSetupIdea)).toEqual([
      "setup",
      "researcher",
    ]);
    expect(rows()[1]!.textContent).toContain("Researcher");
    // Drop the Checker, add it back, drop the first idea, add your own.
    await act(async () =>
      q<HTMLButtonElement>('[aria-label="Drop Checker"]').click(),
    );
    expect(tiles().map((tile) => tile.dataset.crewSetupRole)).toEqual([
      "builder",
      "researcher",
    ]);
    expect(q("[data-crew-setup-add]").textContent).toContain("Checker");
    await act(async () => buttonNamed("Checker")!.click());
    expect(tiles().map((tile) => tile.dataset.crewSetupRole)).toEqual([
      "builder",
      "checker",
      "researcher",
    ]);
    await act(async () =>
      q<HTMLButtonElement>(
        '[aria-label="Drop “Make the today list hold five things”"]',
      ).click(),
    );
    const own = q<HTMLInputElement>('[aria-label="Add an idea"]');
    await type(own, "Timer: a ring that fills");
    await act(async () =>
      own.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(rows().map((row) => row.dataset.crewSetupIdea)).toEqual([
      "researcher",
      "you",
    ]);
    // Nothing happened yet.
    expect(getCrew(PATH)!.on).toBe(false);
    expect(featureBoardState(PATH).cards).toEqual([]);
    await act(async () =>
      q<HTMLButtonElement>("[data-crew-setup-start]").click(),
    );
    expect(onTurnOn).toHaveBeenCalledTimes(1);
    expect(onStarted).toHaveBeenCalledWith(PATH);
    const crew = getCrew(PATH)!;
    expect(crew.on).toBe(true);
    expect(crew.members.map((member) => member.role)).toEqual([
      "builder",
      "checker",
      "researcher",
    ]);
    expect(crew.notes[0]?.text).toBe(
      "About this project: An ADHD-friendly planner for iPhone.",
    );
    const cards = featureBoardState(PATH).cards;
    expect(cards.map((card) => [card.title, card.column])).toEqual([
      ["What helps people with ADHD plan a day?", "building"],
      ["Timer: a ring that fills", "idea"],
    ]);
    expect(crewCard(crew, cards[0]!.id)).toMatchObject({ kind: "research" });
    expect(crew.ideas?.[cards[1]!.id]).toBeUndefined();
  });

  it("says so quietly when the model couldn't suggest, and Pick teammates myself is Build a team", async () => {
    setTeamSetupDeps({
      model: () => ({ harness: "claude", label: "Claude Haiku" }),
      generate: async () => {
        throw new Error("rate limited");
      },
      digest: async () => "",
      timeoutMs: 1_000,
    });
    const { onTurnOn } = await open();
    await type(q("textarea"), "A planner.");
    // Return asks too.
    await act(async () =>
      q("textarea").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(q("[data-crew-setup-problem]").textContent).toContain(SETUP_FAILED);
    expect(sheet().querySelector("[data-crew-setup-team]")).toBeNull();
    expect(q<HTMLTextAreaElement>("textarea").value).toBe("A planner.");
    expect(q<HTMLTextAreaElement>("textarea").disabled).toBe(false);
    expect(onTurnOn).not.toHaveBeenCalled();
    await act(async () =>
      q<HTMLButtonElement>("[data-crew-setup-pick]").click(),
    );
    expect(sheet().querySelector("[data-crew-add]")).not.toBeNull();
    expect(sheet().querySelector("h2")?.textContent).toBe(
      "Build aven-site's team",
    );
    expect(sheet().querySelector('[data-crew-team="ship"]')).not.toBeNull();
  });
});
