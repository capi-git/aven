// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  crewMemberById,
  crewsAllRunsPerDay,
  getCrew,
  resetCrewsCache,
  updateCrew,
} from "../lib/crews";
import { memoryStorage } from "../lib/devSmoke";
import { ALWAYS_ASKS_LINE } from "../lib/projectBotPermissions";
import { resetProjectBotsCache } from "../lib/projectBots";
import { CrewSettingsSheet } from "./CrewSettingsSheet";

vi.mock("../lib/harness/availability", async (original) => ({
  ...(await original<typeof import("../lib/harness/availability")>()),
  probeHarnessAvailability: vi.fn(async () => undefined),
  isHarnessAvailable: (id: string) => id === "codex" || id === "cursor",
}));

const PATH = "/Users/me/aven-site";
let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  resetCrewsCache();
  updateCrew(PATH, (crew) => ({ ...crew, on: true, onAt: 1 }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  resetCrewsCache();
});

async function open(initialPage?: string) {
  await act(async () =>
    root.render(
      createElement(CrewSettingsSheet, {
        path: PATH,
        onTurnOn: async () => null,
        onClose: () => {},
        ...(initialPage ? { initialPage } : {}),
      }),
    ),
  );
}

const sheet = () => document.querySelector<HTMLElement>(".crew-settings")!;
const buttonNamed = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === name,
  );
const pick = async (select: HTMLSelectElement, value: string) =>
  act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

describe("the crew's settings", () => {
  it("lists members, uses neutral switches, and keeps the never line", async () => {
    await open();
    const rows = [
      ...sheet().querySelectorAll<HTMLElement>("[data-crew-member-row]"),
    ].map((row) => row.dataset.crewMemberRow);
    expect(rows).toEqual(["builder", "checker", "security"]);
    const switches = [...sheet().querySelectorAll(".settings-toggle")];
    expect(switches.length).toBeGreaterThan(0);
    for (const item of switches)
      expect(item.getAttribute("data-tone")).toBe("neutral");
    expect(sheet().querySelector("[data-crew-never]")?.textContent).toBe(
      ALWAYS_ASKS_LINE,
    );
  });

  it("changes a limit, and every crew's ceiling, within range", async () => {
    await open();
    await pick(
      sheet().querySelector<HTMLSelectElement>('[aria-label="Rounds a card"]')!,
      "5",
    );
    expect(getCrew(PATH)!.limits.roundsPerCard).toBe(5);
    await pick(
      sheet().querySelector<HTMLSelectElement>(
        '[aria-label="Runs a day, all crews"]',
      )!,
      "100",
    );
    expect(crewsAllRunsPerDay()).toBe(100);
  });

  it("adds a Builder from a template and opens its page", async () => {
    await open();
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>("[data-crew-add-member]")!
        .click(),
    );
    // Ready-made members above; one already in the crew is greyed.
    expect(
      sheet()
        .querySelector('[data-crew-preset="security"]')
        ?.getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      sheet()
        .querySelector('[data-crew-preset="scout"]')
        ?.getAttribute("aria-disabled"),
    ).toBeNull();
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>('[data-crew-template="builder"]')!
        .click(),
    );
    expect(crewMemberById(getCrew(PATH)!, "builder-2")?.role).toBe("builder");
    expect(
      sheet()
        .querySelector("[data-crew-member-page]")
        ?.getAttribute("data-crew-member-page"),
    ).toBe("builder-2");
  });

  it("sets a member's mark, agent, instructions and scope; other apps say why not", async () => {
    await open("checker");
    const agents = [
      ...sheet().querySelectorAll<HTMLButtonElement>("[data-agent]"),
    ];
    expect(agents.map((item) => item.dataset.agent)).toEqual([
      "claude",
      "codex",
      "cursor",
    ]);
    const cursor = agents.find((item) => item.dataset.agent === "cursor")!;
    expect(cursor.getAttribute("aria-disabled")).toBe("true");
    expect(cursor.textContent).toContain("Can't be locked to read-only");
    await act(async () => cursor.click());
    expect(crewMemberById(getCrew(PATH)!, "checker")?.harness).toBeUndefined();
    await act(async () =>
      agents.find((item) => item.dataset.agent === "codex")!.click(),
    );
    expect(crewMemberById(getCrew(PATH)!, "checker")?.harness).toBe("codex");
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>('[data-mark-choice="designer"]')!
        .click(),
    );
    expect(crewMemberById(getCrew(PATH)!, "checker")?.critter).toBe("designer");
    const instructions = sheet().querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Instructions"]',
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(instructions, "Run the e2e tests.");
      instructions.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      instructions.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(crewMemberById(getCrew(PATH)!, "checker")?.instructions).toBe(
      "Run the e2e tests.",
    );
    // Only a Builder has a scope.
    expect(
      sheet().querySelector('textarea[aria-label="Works only in"]'),
    ).toBeNull();
    // The last Checker can't be removed.
    expect(buttonNamed("Remove from crew")?.disabled).toBe(true);
  });
});
