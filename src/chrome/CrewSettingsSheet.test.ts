// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
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

/** Open what sits one level deeper: Edit limits ›, More ›, Rules ›. */
const disclose = async (selector: string) =>
  act(async () => sheet().querySelector<HTMLButtonElement>(selector)!.click());

describe("the crew's settings", () => {
  it("shows little at first: members with one detail, one line each for routing and limits", async () => {
    updateCrew(PATH, (crew) => ({
      ...crew,
      members: crew.members.map((member) =>
        member.id === "checker"
          ? {
              ...member,
              harness: "codex",
              model: "codex:gpt-9.1",
              paused: true,
            }
          : member.id === "security"
            ? { ...member, model: "claude:haiku-9" }
            : member,
      ),
    }));
    await open();
    const rows = [
      ...sheet().querySelectorAll<HTMLElement>("[data-crew-member-row]"),
    ];
    expect(rows.map((row) => row.dataset.crewMemberRow)).toEqual([
      "builder",
      "checker",
      "security",
    ]);
    // One short detail: the model, and "off" only when it is.
    const checker = rows[1]!.querySelector("small")!.textContent!;
    // A model the catalog doesn't know yet still reads as a name.
    expect(checker).toBe("GPT-9.1 · off");
    expect(rows[2]!.querySelector("small")!.textContent).toBe("Haiku 9");
    expect(rows[0]!.querySelector("small")!.textContent).not.toContain("·");
    // No subtitle: "works only while Aven is open" is the switch's tooltip.
    expect(document.querySelector(".crew-settings")!.textContent).not.toContain(
      "Works only while Aven is open",
    );
    expect(
      document.querySelector(
        '[title="Works only while Aven is open and your Mac is awake"] [role="switch"]',
      ),
    ).not.toBeNull();
    expect(
      sheet().querySelector("[data-crew-routing-summary]")?.textContent,
    ).toBe("Cards go to Builder");
    expect(
      sheet().querySelector("[data-crew-limits-summary]")?.textContent,
    ).toBe(
      // "8 am" never breaks over two lines.
      "20 runs a day · 3 rounds a card · pauses at 80% of your week · quiet 11\u00a0pm–8\u00a0am",
    );
    // Nothing deeper is open, and no limit says its why in a line.
    expect(sheet().querySelector('[aria-label="Rounds a card"]')).toBeNull();
    expect(sheet().querySelector(".crew-settings-limit small")).toBeNull();
    const switches = [
      ...document.querySelectorAll(".crew-settings .settings-toggle"),
    ];
    for (const item of switches)
      expect(item.getAttribute("data-tone")).toBe("neutral");
    expect(sheet().querySelector("[data-crew-never]")?.textContent).toBe(
      ALWAYS_ASKS_LINE,
    );
  });

  it("changes a limit after Edit limits, and every crew's ceiling under More", async () => {
    await open();
    await disclose("[data-crew-edit-limits]");
    const rounds = sheet().querySelector<HTMLSelectElement>(
      '[aria-label="Rounds a card"]',
    )!;
    // Its why is its tooltip.
    expect(
      rounds.closest(".crew-settings-limit")!.querySelector("span")!.title,
    ).toBe("Then it stops and asks you");
    await pick(rounds, "5");
    expect(getCrew(PATH)!.limits.roundsPerCard).toBe(5);
    expect(
      sheet().querySelector('[aria-label="Runs a day, all crews"]'),
    ).toBeNull();
    await disclose("[data-crew-limits-more]");
    await pick(
      sheet().querySelector<HTMLSelectElement>(
        '[aria-label="Runs a day, all crews"]',
      )!,
      "100",
    );
    expect(crewsAllRunsPerDay()).toBe(100);
    // How many passed cards may wait for you before nothing new starts.
    await pick(
      sheet().querySelector<HTMLSelectElement>(
        '[aria-label="Cards waiting for you"]',
      )!,
      "3",
    );
    expect(getCrew(PATH)!.limits.readyCap).toBe(3);
  });

  it("shows the rules for who builds what only when you open them", async () => {
    updateCrew(PATH, (crew) => ({
      ...crew,
      members: [...crew.members, { id: "builder-2", role: "builder" }],
      routes: [{ id: "r1", words: ["css"], to: "builder-2" }],
    }));
    await open();
    expect(
      sheet().querySelector("[data-crew-routing-summary]")?.textContent,
    ).toBe("Cards go to Builder · 1 rule");
    expect(sheet().querySelector("[data-crew-rule]")).toBeNull();
    await disclose("[data-crew-rules]");
    expect(sheet().querySelector('[data-crew-rule="r1"]')).not.toBeNull();
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

  it("sets a member's mark from its popover, agent, model and instructions; other apps say why not", async () => {
    await open("checker");
    // The mark grid isn't open until you press the mark.
    expect(document.querySelector('[data-mark-choice="designer"]')).toBeNull();
    const agent = sheet().querySelector<HTMLSelectElement>(
      'select[aria-label="Agent"]',
    )!;
    const options = [...agent.options];
    expect(options.map((item) => item.value)).toEqual([
      "claude",
      "codex",
      "cursor",
    ]);
    const cursor = options.find((item) => item.value === "cursor")!;
    // Why not is the item's tooltip, not a paragraph.
    expect(cursor.disabled).toBe(true);
    expect(cursor.title).toBe("Can't be locked to read-only");
    expect(document.querySelector(".crew-settings")!.textContent).not.toContain(
      "Can't be locked to read-only",
    );
    await pick(agent, "cursor");
    expect(crewMemberById(getCrew(PATH)!, "checker")?.harness).toBeUndefined();
    await pick(agent, "codex");
    expect(crewMemberById(getCrew(PATH)!, "checker")?.harness).toBe("codex");
    // Model and effort share one row.
    const model = sheet().querySelector(".crew-settings-inline")!;
    expect(model.closest(".crew-settings-limit")!.textContent).toContain(
      "Model",
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>("[data-crew-mark-button]")!
        .click(),
    );
    // The grid opens above the sheet, not under it.
    const popover = document
      .querySelector("[data-crew-mark-popover]")!
      .closest<HTMLElement>("[style*='z-index']")!;
    expect(Number(popover.style.zIndex)).toBeGreaterThan(90);
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[data-mark-choice="designer"]')!
        .click(),
    );
    expect(crewMemberById(getCrew(PATH)!, "checker")?.critter).toBe("designer");
    expect(document.querySelector("[data-crew-mark-popover]")).toBeNull();
    const instructions = sheet().querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Instructions"]',
    )!;
    expect(instructions.title).toContain("read at every turn");
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
    // The last Checker can't be removed: a quiet word, its why a tooltip.
    const remove = buttonNamed("Remove from crew")!;
    expect(remove.disabled).toBe(true);
    expect(remove.className).toBe("crew-settings-remove-link");
    expect(remove.title).toBe("A crew needs a Checker.");
  });

  it("keeps a Builder's scope and its default under More, with one line of its rules", async () => {
    updateCrew(PATH, (crew) => ({
      ...crew,
      members: [...crew.members, { id: "builder-2", role: "builder" }],
    }));
    await open("builder-2");
    expect(
      sheet().querySelector('textarea[aria-label="Works only in"]'),
    ).toBeNull();
    // No long rules paragraph on the page.
    expect(sheet().textContent).not.toContain("Whatever you set here");
    await disclose("[data-crew-member-more]");
    expect(
      sheet().querySelector('textarea[aria-label="Works only in"]'),
    ).not.toBeNull();
    expect(
      sheet().querySelector('[aria-label="Takes cards no rule picks"]'),
    ).not.toBeNull();
    expect(sheet().querySelector("[data-crew-member-rules]")?.textContent).toBe(
      "Changes files only in the crew's copy, never pushes, runs in its sandbox.",
    );
  });
});

describe("quiet hours", () => {
  it("can't start and end at the same hour, which would never be quiet", async () => {
    await open();
    await disclose("[data-crew-edit-limits]");
    const [from, to] = [
      ...sheet().querySelectorAll<HTMLSelectElement>(
        ".crew-settings-hours select",
      ),
    ];
    // 11 pm to 8 am: 8 am can't be the start, nor 11 pm the end.
    expect(
      [...from.options].find((option) => option.value === "480")?.disabled,
    ).toBe(true);
    expect(
      [...to.options].find((option) => option.value === "1380")?.disabled,
    ).toBe(true);
    await pick(from, "480");
    await pick(to, "1380");
    expect(getCrew(PATH)!.limits.quiet).toMatchObject({
      start: 1380,
      end: 480,
    });
    await pick(from, "1320");
    expect(getCrew(PATH)!.limits.quiet.start).toBe(1320);
  });
});

describe("the sheet's styles", () => {
  const css = readFileSync("src/chrome/CrewCritter.css", "utf8");
  const overlays = readFileSync("src/chrome/Overlays.css", "utf8");
  const rule = (sheet: string, selector: string) => {
    const at = sheet.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return sheet.slice(at, sheet.indexOf("}", at));
  };

  it("keeps a member's mark full size in the header, over the close button's 28px", () => {
    // The header's rule for its close button would shrink the mark's button
    // under its 35px mark; the mark's own rule has to be more specific.
    expect(
      rule(overlays, '.modal-panel[role="dialog"] > header button'),
    ).toContain("width: 28px");
    const mark = rule(
      css,
      '.modal-panel[role="dialog"] > header .crew-mark-button',
    );
    expect(mark).toContain("width: 40px");
    expect(mark).toContain("height: 40px");
  });
});
