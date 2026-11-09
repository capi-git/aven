// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCrew, resetCrewsCache, updateCrew } from "../lib/crews";
import { memoryStorage } from "../lib/devSmoke";
import {
  TEAM_ACCESS_ROLE_LINES,
  TEAM_ACCESS_SCOPE_LINE,
} from "../lib/projectBotPermissions";
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

describe("the Researcher in the Team sheet", () => {
  it("is offered under Add a helper, once, as a reader", async () => {
    await open("add");
    const tile = sheet().querySelector<HTMLElement>(
      '[data-crew-preset="researcher"]',
    )!;
    expect(tile.textContent).toContain("Researcher");
    expect(tile.textContent).toContain(
      "Reads up on a question and writes findings you can turn into ideas",
    );
    expect(tile.textContent).not.toContain("In team");
    await act(async () =>
      tile
        .querySelector<HTMLButtonElement>('[aria-label="Add Researcher"]')!
        .click(),
    );
    const researcher = getCrew(PATH)!.members.find(
      (member) => member.role === "researcher",
    )!;
    expect(researcher).toMatchObject({ preset: "researcher" });
    expect(tile.textContent).toContain("In team");
    // One Researcher: no Add another.
    expect(
      tile.querySelector('[aria-label="Add another Researcher"]'),
    ).toBeNull();
    const rows = [
      ...sheet().querySelectorAll<HTMLElement>("[data-crew-member-row]"),
    ].map((row) => row.dataset.crewMemberRow);
    expect(rows).toContain(researcher.id);
  });

  it("says in Access that the Researcher reads the web too", async () => {
    await open();
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>('[data-crew-summary="access"]')!
        .click(),
    );
    await act(async () =>
      [...sheet().querySelectorAll<HTMLButtonElement>("button")]
        .find((item) => item.textContent?.includes("Customise web"))!
        .click(),
    );
    const access = sheet().querySelector<HTMLElement>(
      "[data-crew-access-custom]",
    )!;
    // Its why is the row's tooltip.
    expect(
      [...access.querySelectorAll<HTMLElement>("span[title]")].map(
        (item) => item.title,
      ),
    ).toContainEqual(
      expect.stringContaining(
        "Builders and the Researcher search and read pages",
      ),
    );
    expect(sheet().querySelector("[data-crew-access-scope]")?.textContent).toBe(
      TEAM_ACCESS_SCOPE_LINE,
    );
    expect(
      [...sheet().querySelectorAll("[data-crew-access-roles] li")].map(
        (item) => item.textContent,
      ),
    ).toEqual(TEAM_ACCESS_ROLE_LINES);
    expect(TEAM_ACCESS_ROLE_LINES).toContainEqual(
      expect.stringContaining(
        "The Researcher reads the web whenever Builders may",
      ),
    );
    // Everyone: the Scout's ideas wait because it read the web; the
    // Researcher's always do. Neither finds ideas on the web.
    const everyone = [
      ...access.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ].find((item) => item.textContent === "Everyone")!;
    await act(async () => everyone.click());
    expect(
      [...access.querySelectorAll<HTMLElement>("span[title]")].map(
        (item) => item.title,
      ),
    ).toContainEqual(
      expect.stringContaining(
        "The Scout's ideas then wait for you, as the Researcher's always do",
      ),
    );
  });
});
