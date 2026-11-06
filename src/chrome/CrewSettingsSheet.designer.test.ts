// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCrew, resetCrewsCache, updateCrew } from "../lib/crews";
import { memoryStorage } from "../lib/devSmoke";
import { TEAM_ACCESS_ROLE_LINES } from "../lib/projectBotPermissions";
import { resetProjectBotsCache } from "../lib/projectBots";
import { CrewSettingsSheet } from "./CrewSettingsSheet";

const installed = vi.hoisted(() => ({ ids: new Set(["codex", "cursor"]) }));
vi.mock("../lib/harness/availability", async (original) => ({
  ...(await original<typeof import("../lib/harness/availability")>()),
  probeHarnessAvailability: vi.fn(async () => undefined),
  isHarnessAvailable: (id: string) => installed.ids.has(id),
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

const sheet = () => document.querySelector<HTMLElement>(".crew-settings")!;

describe("the Designer in the Team sheet", () => {
  it("is offered under Add a helper after the Researcher, once", async () => {
    await act(async () =>
      root.render(
        createElement(CrewSettingsSheet, {
          path: PATH,
          onTurnOn: async () => null,
          onClose: () => {},
          initialPage: "add",
        }),
      ),
    );
    const keys = [
      ...sheet().querySelectorAll<HTMLElement>("[data-crew-preset]"),
    ].map((tile) => tile.dataset.crewPreset);
    expect(keys.indexOf("designer")).toBe(keys.indexOf("researcher") + 1);
    const tile = sheet().querySelector<HTMLElement>(
      '[data-crew-preset="designer"]',
    )!;
    expect(tile.textContent).toContain("Mocks up a screen or a look");
    await act(async () =>
      tile
        .querySelector<HTMLButtonElement>('[aria-label="Add Designer"]')!
        .click(),
    );
    const designer = getCrew(PATH)!.members.find(
      (member) => member.role === "designer",
    )!;
    expect(designer).toMatchObject({ preset: "designer", critter: "designer" });
    expect(designer.label).toBeUndefined();
    expect(tile.textContent).toContain("In team");
    expect(
      tile.querySelector('[aria-label="Add another Designer"]'),
    ).toBeNull();
    expect(TEAM_ACCESS_ROLE_LINES).toContainEqual(
      expect.stringContaining("The Designer never uses the web or the browser"),
    );
  });
});
