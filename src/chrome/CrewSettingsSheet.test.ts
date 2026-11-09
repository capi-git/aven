// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  crewMemberById,
  crewsAllRunsPerDay,
  crewAccess,
  getCrew,
  resetCrewsCache,
  updateCrew,
} from "../lib/crews";
import { memoryStorage } from "../lib/devSmoke";
import { TEAM_ALWAYS_LINE } from "../lib/projectBotPermissions";
import { resetProjectBotsCache } from "../lib/projectBots";
import { installCrewWorkspace } from "../lib/crewActions";
import { CrewSettingsSheet } from "./CrewSettingsSheet";

// The apps installed here: Codex and Cursor, unless a test installs more.
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
  installed.ids = new Set(["codex", "cursor"]);
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

/** Open what sits one level deeper: More ›, Rules ›. */
const disclose = async (selector: string) =>
  act(async () => sheet().querySelector<HTMLButtonElement>(selector)!.click());

/** Open one of Avos's four rows: Model, Helpers, Access or Limits. */
const toRow = async (id: string) =>
  act(async () =>
    sheet()
      .querySelector<HTMLButtonElement>(`[data-crew-summary="${id}"]`)!
      .click(),
  );

describe("the team's settings", () => {
  it("shows Avos's rows, model, instructions, memory, helpers, access and limits, each with one line", async () => {
    updateCrew(PATH, (crew) => ({
      ...crew,
      members: [
        { id: "lead", role: "lead", model: "claude:sonnet-9", chosen: true },
        ...crew.members.map((member) =>
          member.id === "checker"
            ? {
                ...member,
                harness: "codex" as const,
                model: "codex:gpt-9.1",
                paused: true,
              }
            : member.id === "security"
              ? { ...member, model: "claude:haiku-9" }
              : member,
        ),
      ],
    }));
    await open();
    const summary = (id: string) =>
      sheet().querySelector(`[data-crew-summary="${id}"] small`)?.textContent;
    expect(
      [...sheet().querySelectorAll<HTMLElement>("[data-crew-summary]")].map(
        (row) => row.dataset.crewSummary,
      ),
    ).toEqual([
      "model",
      "instructions",
      "memory",
      "helpers",
      "access",
      "limits",
    ]);
    expect(summary("model")).toBe("Claude · Sonnet 9");
    expect(summary("instructions")).toBe("Your standing words to Avos");
    expect(summary("memory")).toBe(
      "Nothing yet. It notes what it learns as it works",
    );
    // Avos isn't one of its own helpers.
    expect(summary("helpers")).toBe("Builder, Checker, Security");
    expect(summary("access")).toBe(
      "Auto · nothing reaches your folder until you Apply",
    );
    expect(summary("limits")).toBe("20 runs a day · quiet 11 pm–8 am");
    // The switch says when Avos works, and so does the line under the name.
    expect(
      document.querySelector(
        '[title="Works only while Aven is open and your Mac is awake"] [role="switch"]',
      ),
    ).not.toBeNull();
    expect(document.body.textContent).toContain(
      "On while Aven is open and your Mac is awake",
    );
    // Pause is in Avos's ⋯, and the sheet's close is its only Done.
    expect(buttonNamed("Pause Avos")).toBeUndefined();
    expect(buttonNamed("Done")).toBeUndefined();
    // Nothing deeper shows until its row is opened.
    expect(sheet().querySelector("[data-crew-member-row]")).toBeNull();
    expect(sheet().querySelector("[data-crew-access]")).toBeNull();
    await toRow("helpers");
    const rows = [
      ...sheet().querySelectorAll<HTMLElement>("[data-crew-member-row]"),
    ];
    expect(rows.map((row) => row.dataset.crewMemberRow)).toEqual([
      "builder",
      "checker",
      "security",
    ]);
    // One short detail: the model, and "off" only when it is.
    // A model the catalog doesn't know yet still reads as a name.
    expect(rows[1]!.querySelector("small")!.textContent).toBe(
      "Codex · GPT-9.1 · off",
    );
    expect(rows[2]!.querySelector("small")!.textContent).toBe(
      "Claude · Haiku 9",
    );
    // One Builder: no rules for who builds what.
    expect(sheet().querySelector("[data-crew-routing-summary]")).toBeNull();
    for (const item of document.querySelectorAll(
      ".crew-settings .settings-toggle",
    ))
      expect(item.getAttribute("data-tone")).toBe("neutral");
    await act(async () => buttonNamed("aven-site's Avos")!.click());
    await toRow("access");
    expect(sheet().querySelector("[data-crew-never]")?.textContent).toBe(
      TEAM_ALWAYS_LINE,
    );
  });

  it("keeps your instructions to Avos and rules for every job, with Add and Forget", async () => {
    updateCrew(PATH, (crew) => ({
      ...crew,
      members: [{ id: "lead", role: "lead" }, ...crew.members],
      notes: [{ id: "n1", at: 1, text: "Use pnpm, not npm" }],
    }));
    await open("instructions");
    const box = sheet().querySelector<HTMLTextAreaElement>(
      '[aria-label="Instructions"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(box, "Keep changes small");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      box.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
    );
    expect(crewMemberById(getCrew(PATH)!, "lead")?.instructions).toBe(
      "Keep changes small",
    );
    const add = sheet().querySelector<HTMLInputElement>(
      '[aria-label="Add a rule for every job"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(add, "Say what changed in a line");
      add.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => add.form!.requestSubmit());
    expect(getCrew(PATH)!.notes.map((note) => note.text)).toEqual([
      "Use pnpm, not npm",
      "Say what changed in a line",
    ]);
    await act(async () =>
      sheet()
        .querySelector('[data-avos-rule="n1"]')!
        .querySelector<HTMLButtonElement>("button")!
        .click(),
    );
    expect(getCrew(PATH)!.notes.map((note) => note.text)).toEqual([
      "Say what changed in a line",
    ]);
  });

  it("shows what Avos learned one fact a row, with Forget and Edit as text", async () => {
    updateCrew(PATH, (crew) => ({
      ...crew,
      members: [
        {
          id: "lead",
          role: "lead",
          memory:
            "# Notes\n- Articles go in as drafts\n- The Insights page is /insights",
        },
        ...crew.members,
      ],
    }));
    await open("memory");
    const facts = () =>
      [...sheet().querySelectorAll<HTMLElement>("[data-avos-fact] span")].map(
        (fact) => fact.textContent,
      );
    expect(facts()).toEqual([
      "Articles go in as drafts",
      "The Insights page is /insights",
    ]);
    await act(async () =>
      sheet()
        .querySelector<HTMLElement>("[data-avos-fact]")!
        .querySelector<HTMLButtonElement>("button")!
        .click(),
    );
    expect(facts()).toEqual(["The Insights page is /insights"]);
    expect(crewMemberById(getCrew(PATH)!, "lead")?.memory).not.toContain(
      "drafts",
    );
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>("[data-avos-memory-edit]")!
        .click(),
    );
    expect(
      sheet().querySelector<HTMLTextAreaElement>('[aria-label="Memory"]')
        ?.value,
    ).toContain("The Insights page is /insights");
  });

  it("lets Avos start quick helpers, up to a number a day, or none", async () => {
    await open();
    await toRow("helpers");
    const toggle = () =>
      sheet().querySelector<HTMLButtonElement>(
        '[aria-label="Let Avos start quick helpers"]',
      )!;
    expect(getCrew(PATH)!.limits.helpersPerDay).toBe(10);
    await pick(
      sheet().querySelector<HTMLSelectElement>(
        '[aria-label="Quick helpers a day"]',
      )!,
      "5",
    );
    expect(getCrew(PATH)!.limits.helpersPerDay).toBe(5);
    await act(async () => toggle().click());
    expect(getCrew(PATH)!.limits.helpersPerDay).toBe(0);
    // Off: no number to pick.
    expect(
      sheet().querySelector('[aria-label="Quick helpers a day"]'),
    ).toBeNull();
    await act(async () => toggle().click());
    expect(getCrew(PATH)!.limits.helpersPerDay).toBe(10);
  });

  it("lets you stop Avos reading the project from Access, which turns it off", async () => {
    await open();
    expect(
      sheet().querySelector('[data-crew-summary="access"] small')?.textContent,
    ).toMatch(/^Auto/);
    await toRow("access");
    const read = sheet().querySelector<HTMLButtonElement>(
      '[data-crew-read-access] [aria-label="Read this project"]',
    )!;
    expect(read.getAttribute("aria-checked")).toBe("true");
    await act(async () => read.click());
    expect(getCrew(PATH)).toMatchObject({ on: false, readAccess: "declined" });
    await act(async () => buttonNamed("aven-site's Avos")!.click());
    expect(
      sheet().querySelector('[data-crew-summary="access"] small')?.textContent,
    ).toBe("Can't read this project yet");
  });

  it("lets Avos build what it plans at once, or wait for your Build it", async () => {
    await open();
    await toRow("access");
    const ask = sheet().querySelector<HTMLButtonElement>(
      '[aria-label="Ask before building"]',
    )!;
    expect(ask.getAttribute("aria-checked")).toBe("false");
    await act(async () => ask.click());
    expect(getCrew(PATH)!.askBeforeBuilding).toBe(true);
    await act(async () => ask.click());
    expect(getCrew(PATH)!.askBeforeBuilding).toBeUndefined();
  });

  it("sets Access with one choice, in the message box's words", async () => {
    await open();
    await toRow("access");
    const access = sheet().querySelector<HTMLElement>("[data-crew-access]")!;
    const level = (name: string) =>
      access.querySelector<HTMLButtonElement>(
        `[data-crew-access-level="${name}"]`,
      )!;
    expect(
      [...access.querySelectorAll("b")].map((item) => item.textContent),
    ).toEqual(["Ask first", "Auto", "Full access"]);
    expect(level("auto").getAttribute("aria-checked")).toBe("true");
    await act(async () => level("full").click());
    expect(crewAccess(getCrew(PATH)!)).toEqual({
      deletes: true,
      web: "everyone",
      others: "allow",
    });
    await act(async () => level("ask").click());
    expect(crewAccess(getCrew(PATH)!)).toEqual({
      deletes: false,
      web: "builders",
      others: "ask",
    });
  });

  it("keeps web and deleting one level deeper", async () => {
    await open();
    await toRow("access");
    expect(sheet().querySelector("[data-crew-access-custom]")).toBeNull();
    await act(async () =>
      [...sheet().querySelectorAll<HTMLButtonElement>("button")]
        .find((item) => item.textContent?.includes("Customise web"))!
        .click(),
    );
    const custom = sheet().querySelector<HTMLElement>(
      "[data-crew-access-custom]",
    )!;
    const toggle = custom.querySelector<HTMLButtonElement>(".settings-toggle")!;
    await act(async () => toggle.click());
    expect(crewAccess(getCrew(PATH)!).deletes).toBe(false);
    const choice = (label: string) =>
      [...custom.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
        (item) => item.textContent === label,
      )!;
    await act(async () => choice("Everyone").click());
    expect(crewAccess(getCrew(PATH)!).web).toBe("everyone");
    // Going to Ask first keeps the web you customised.
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>('[data-crew-access-level="ask"]')!
        .click(),
    );
    expect(crewAccess(getCrew(PATH)!).web).toBe("everyone");
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>('[data-crew-access-level="auto"]')!
        .click(),
    );
    // Customising keeps the choice.
    expect(
      sheet()
        .querySelector('[data-crew-access-level="auto"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("shows the common limits on their page, and the rest under More", async () => {
    await open();
    await toRow("limits");
    await pick(
      sheet().querySelector<HTMLSelectElement>('[aria-label="Runs a day"]')!,
      "30",
    );
    expect(getCrew(PATH)!.limits.runsPerDay).toBe(30);
    expect(sheet().querySelector('[aria-label="Rounds a card"]')).toBeNull();
    await disclose("[data-crew-limits-more]");
    const rounds = sheet().querySelector<HTMLSelectElement>(
      '[aria-label="Rounds a card"]',
    )!;
    // Its why is its tooltip.
    expect(
      rounds.closest(".crew-settings-limit")!.querySelector("span")!.title,
    ).toBe("Then it stops and asks you");
    await pick(rounds, "5");
    expect(getCrew(PATH)!.limits.roundsPerCard).toBe(5);
    await pick(
      sheet().querySelector<HTMLSelectElement>(
        '[aria-label="Runs a day, every Avos"]',
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
    await toRow("helpers");
    expect(
      sheet().querySelector("[data-crew-routing-summary]")?.textContent,
    ).toBe("Cards go to Builder · 1 rule");
    expect(sheet().querySelector("[data-crew-rule]")).toBeNull();
    await disclose("[data-crew-rules]");
    expect(sheet().querySelector('[data-crew-rule="r1"]')).not.toBeNull();
  });

  it("opens a helper's page from the list, and Add opens Add a helper", async () => {
    await open();
    await toRow("helpers");
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>('[data-crew-member-row="checker"]')!
        .click(),
    );
    expect(
      sheet()
        .querySelector("[data-crew-member-page]")
        ?.getAttribute("data-crew-member-page"),
    ).toBe("checker");
    // The way back sits above its name.
    await act(async () => buttonNamed("Helpers")!.click());
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>("[data-crew-add-member]")!
        .click(),
    );
    expect(sheet().querySelector("[data-crew-add]")).not.toBeNull();
    expect(sheet().querySelector("h2")?.textContent).toBe("Add a helper");
  });
});

describe("removing a helper", () => {
  it("offers Remove on each helper's row in Helpers, asks once, and the helper goes", async () => {
    updateCrew(PATH, (crew) => ({
      ...crew,
      members: [
        { id: "lead", role: "lead" },
        ...crew.members,
        { id: "scout", role: "scout" },
      ],
    }));
    await open();
    await toRow("helpers");
    const removable = [
      ...sheet().querySelectorAll<HTMLButtonElement>("[data-crew-remove-row]"),
    ].map((button) => button.dataset.crewRemoveRow);
    expect(removable).toEqual(["builder", "checker", "security", "scout"]);
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>('[data-crew-remove-row="scout"]')!
        .click(),
    );
    expect(sheet().querySelector(".bot-sheet-question")?.textContent).toBe(
      "Remove Scout?",
    );
    expect(sheet().querySelector(".bot-sheet-note")?.textContent).toBe(
      "Its chat stays in your history.",
    );
    // Keep it: nothing changes, and the list is back.
    await act(async () => buttonNamed("Keep it")!.click());
    expect(crewMemberById(getCrew(PATH)!, "scout")).toBeDefined();
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>('[data-crew-remove-row="scout"]')!
        .click(),
    );
    await act(async () => buttonNamed("Remove")!.click());
    expect(crewMemberById(getCrew(PATH)!, "scout")).toBeUndefined();
    expect(sheet().querySelector('[data-crew-member-row="scout"]')).toBeNull();
    expect(sheet().querySelector("[data-crew-member-row]")).not.toBeNull();
  });

  it("removes from the helper's own page, back to Helpers; Avos's page has no Remove", async () => {
    updateCrew(PATH, (crew) => ({
      ...crew,
      members: [
        { id: "lead", role: "lead" },
        ...crew.members,
        { id: "builder-2", role: "builder" },
      ],
    }));
    await open("lead");
    expect(buttonNamed("Remove helper")).toBeUndefined();
    // A fresh sheet, open on Helpers.
    await act(async () => root.unmount());
    root = createRoot(container);
    await open("helpers");
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>('[data-crew-member-row="builder-2"]')!
        .click(),
    );
    await act(async () => buttonNamed("Remove helper")!.click());
    expect(sheet().querySelector(".bot-sheet-question")?.textContent).toBe(
      "Remove Builder 2?",
    );
    await act(async () => buttonNamed("Remove")!.click());
    expect(crewMemberById(getCrew(PATH)!, "builder-2")).toBeUndefined();
    expect(sheet().querySelector("[data-crew-member-page]")).toBeNull();
    expect(
      sheet().querySelector('[data-crew-member-row="builder"]'),
    ).not.toBeNull();
  });
});

describe("Add a helper", () => {
  it("shows each role with In team or +; a second Builder is fine, a second Security isn't", async () => {
    await open("add");
    const tile = (key: string) =>
      sheet().querySelector<HTMLElement>(`[data-crew-preset="${key}"]`)!;
    expect(tile("security").textContent).toContain("In team");
    expect(tile("security").querySelector("button")).toBeNull();
    expect(tile("scout").textContent).not.toContain("In team");
    // The Builder is in, and another one can join.
    expect(tile("builder").textContent).toContain("In team");
    await act(async () =>
      tile("builder")
        .querySelector<HTMLButtonElement>('[aria-label="Add another Builder"]')!
        .click(),
    );
    expect(crewMemberById(getCrew(PATH)!, "builder-2")?.role).toBe("builder");
    await act(async () =>
      tile("designer")
        .querySelector<HTMLButtonElement>('[aria-label="Add Designer"]')!
        .click(),
    );
    const designer = getCrew(PATH)!.members.find(
      (member) => member.preset === "designer",
    )!;
    expect(designer).toMatchObject({ role: "designer" });
    expect(designer.label).toBeUndefined();
    expect(tile("designer").textContent).toContain("In team");
    // Each teammate in the team's column opens its page.
    const rows = [
      ...sheet().querySelectorAll<HTMLElement>("[data-crew-member-row]"),
    ].map((row) => row.dataset.crewMemberRow);
    expect(rows).toEqual([
      "builder",
      "builder-2",
      "checker",
      "security",
      designer.id,
    ]);
    // No suggested teams: Avos brings in helpers when work needs them.
    expect(sheet().querySelector("[data-crew-team]")).toBeNull();
    expect(buttonNamed("Done")).toBeTruthy();
  });

  it("adds your own teammate with a name and one job; a Builder can't pick Codex", async () => {
    await open("add");
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>('[aria-label="Add your own helper"]')!
        .click(),
    );
    const form = sheet().querySelector<HTMLFormElement>("[data-crew-custom]")!;
    const codex = [...form.querySelectorAll("option")].find(
      (option) => option.value === "codex",
    )!;
    expect(codex.disabled).toBe(true);
    const [name, job] = [...form.querySelectorAll("input")];
    const type = async (field: HTMLInputElement, value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await type(name!, "Copywriter");
    await type(job!, "Keeps the words plain");
    await act(async () => buttonNamed("Add")!.click());
    expect(
      getCrew(PATH)!.members.find((member) => member.label === "Copywriter"),
    ).toMatchObject({ role: "builder", job: "Keeps the words plain" });
  });
});

describe("a teammate's page", () => {
  it("shows a Researcher you haven't set on the Helpers setting, and keeps the model you pick", async () => {
    updateCrew(PATH, (crew) => ({
      ...crew,
      members: [
        ...crew.members,
        { id: "researcher", role: "researcher", model: "claude:sonnet-5" },
      ],
    }));
    await open("researcher");
    const models = sheet().querySelector<HTMLElement>(
      '[role="radiogroup"][aria-label="Model"]',
    )!;
    expect(
      models
        .querySelector('[data-model="claude:opus-5.5"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(sheet().textContent).toContain(
      "Follows the Helpers setting until you pick one",
    );
    await act(async () =>
      models
        .querySelector<HTMLButtonElement>('[data-model="claude:sonnet-5"]')!
        .click(),
    );
    expect(crewMemberById(getCrew(PATH)!, "researcher")).toMatchObject({
      model: "claude:sonnet-5",
      chosen: true,
    });
    expect(sheet().textContent).not.toContain("Follows the Helpers setting");
  });

  it("shows its Bot, and sets its agent, model and effort in view, with no floating menu; other apps say why not", async () => {
    await open("checker");
    // The mark grid isn't open until you press the mark.
    expect(document.querySelector('[data-mark-choice="designer"]')).toBeNull();
    expect(sheet().querySelector("header p")?.textContent).toBe(
      "A Checker on aven-site's team · only reads",
    );
    const agent = sheet().querySelector<HTMLElement>(
      '[role="radiogroup"][aria-label="Agent"]',
    )!;
    const options = [...agent.querySelectorAll<HTMLButtonElement>("button")];
    expect(options.map((item) => item.textContent)).toEqual([
      "Claude",
      "Codex",
      "Cursor",
    ]);
    const cursor = options[2]!;
    // Why not is its tooltip, not a paragraph.
    expect(cursor.getAttribute("aria-disabled")).toBe("true");
    expect(cursor.title).toBe("Can't be locked to read-only");
    expect(sheet().textContent).not.toContain("Can't be locked to read-only");
    await act(async () => cursor.click());
    expect(crewMemberById(getCrew(PATH)!, "checker")?.harness).toBeUndefined();
    await act(async () => options[1]!.click());
    expect(crewMemberById(getCrew(PATH)!, "checker")?.harness).toBe("codex");
    await act(async () => options[0]!.click());
    // The model: a list in view, no picker to open.
    expect(
      document.querySelector('input[aria-label="Search models"]'),
    ).toBeNull();
    const models = sheet().querySelector<HTMLElement>(
      '[role="radiogroup"][aria-label="Model"]',
    )!;
    const sonnet = models.querySelector<HTMLButtonElement>(
      '[data-model="claude:sonnet-5"]',
    )!;
    await act(async () => sonnet.click());
    expect(crewMemberById(getCrew(PATH)!, "checker")?.model).toBe(
      "claude:sonnet-5",
    );
    expect(sonnet.getAttribute("aria-checked")).toBe("true");
    // Older ones are tucked away until asked for.
    expect(
      sheet().querySelector('[role="radiogroup"][aria-label="Older models"]'),
    ).toBeNull();
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>("[data-crew-older-models]")!
        .click(),
    );
    expect(
      sheet().querySelector('[role="radiogroup"][aria-label="Older models"]'),
    ).not.toBeNull();
    // Effort: a segmented control, Default first, for a model that has one.
    await act(async () =>
      models
        .querySelector<HTMLButtonElement>('[data-model="claude:opus-5.5"]')!
        .click(),
    );
    const effort = sheet().querySelector<HTMLElement>(
      '[role="radiogroup"][aria-label="Effort"]',
    )!;
    const high = [...effort.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === "High",
    )!;
    await act(async () => high.click());
    expect(crewMemberById(getCrew(PATH)!, "checker")?.effort).toBe("high");
    // Every agent is Bot: its mark is no button and has no marks to pick
    // from, and the one it chose before stays saved.
    const before = crewMemberById(getCrew(PATH)!, "checker")?.critter;
    const mark = document.querySelector<HTMLElement>(
      "[data-crew-member-mark]",
    )!;
    expect(mark.closest("button")).toBeNull();
    expect(mark.querySelector<HTMLElement>(".agent-mark")?.dataset.tone).toBe(
      "purple",
    );
    expect(document.querySelector("[data-mark-choice]")).toBeNull();
    expect(crewMemberById(getCrew(PATH)!, "checker")?.critter).toBe(before);
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
    // The last Checker stays: Remove helper says why, and what to do.
    await act(async () => buttonNamed("Remove helper")!.click());
    expect(sheet().querySelector("[data-crew-remove-kept]")?.textContent).toBe(
      "Avos needs a CheckerAdd another Checker first, or switch this one off.OK",
    );
    await act(async () => buttonNamed("OK")!.click());
    expect(crewMemberById(getCrew(PATH)!, "checker")).toBeDefined();
    expect(buttonNamed("Remove helper")).toBeDefined();
  });

  it("keeps a Builder's paths as chips with Edit, its default under When it works, and one line of its rules", async () => {
    updateCrew(PATH, (crew) => ({
      ...crew,
      members: [
        ...crew.members,
        {
          id: "builder-2",
          role: "builder",
          label: "Designer",
          job: "Builds UI cards",
          scope: [
            "src/a",
            "src/b",
            "src/c",
            "src/d",
            "src/e",
            "src/f",
            "src/g",
          ],
        },
      ],
    }));
    await open("builder-2");
    const chips = sheet().querySelector<HTMLElement>("[data-crew-scope]")!;
    expect(
      [...chips.querySelectorAll("code")].map((chip) => chip.textContent),
    ).toEqual(["src/a", "src/b", "src/c", "src/d", "src/e"]);
    expect(
      sheet().querySelector('textarea[aria-label="Works only in"]'),
    ).toBeNull();
    await act(async () =>
      chips.querySelector<HTMLButtonElement>("[data-crew-scope-edit]")!.click(),
    );
    const scope = sheet().querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Works only in"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(scope, "/elsewhere/x");
      scope.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonNamed("Done")!.click());
    // Outside the project: refused, with why.
    expect(sheet().querySelector('[role="alert"]')?.textContent).toContain(
      "is outside the project",
    );
    expect(crewMemberById(getCrew(PATH)!, "builder-2")?.scope).toHaveLength(7);
    // Its title and job are its own to change.
    expect(
      sheet().querySelector<HTMLInputElement>('input[aria-label="Job"]')?.value,
    ).toBe("Builds UI cards");
    expect(
      sheet().querySelector(
        '[data-crew-when] [aria-label="Takes cards no rule picks"]',
      ),
    ).not.toBeNull();
    expect(sheet().querySelector("[data-crew-member-rules]")?.textContent).toBe(
      "Never pushes or publishes, and runs in its sandbox. Changes save as you make them.",
    );
  });

  it("opens its chat, closing the sheet once it's open; while the team is off it can't", async () => {
    updateCrew(PATH, (crew) => ({
      ...crew,
      copy: { path: "/copies/site", branch: "aven/crew/site", root: PATH },
    }));
    const openChat = vi.fn(async () => null as string | null);
    const onClose = vi.fn();
    const uninstall = installCrewWorkspace({
      openChat,
      openCrew: vi.fn(),
      openSettings: vi.fn(),
      stop: vi.fn(async () => undefined),
    });
    try {
      await act(async () =>
        root.render(
          createElement(CrewSettingsSheet, {
            path: PATH,
            initialPage: "builder",
            onTurnOn: async () => null,
            onClose,
          }),
        ),
      );
      await act(async () => buttonNamed("Open chat")!.click());
      expect(onClose).toHaveBeenCalled();
      expect(openChat).toHaveBeenCalledWith(PATH, "builder");
      await act(async () =>
        updateCrew(PATH, (crew) => ({ ...crew, on: false })),
      );
      expect(buttonNamed("Open chat")!.disabled).toBe(true);
    } finally {
      uninstall();
    }
  });
});

describe("quiet hours", () => {
  it("can't start and end at the same hour, which would never be quiet", async () => {
    await open();
    await toRow("limits");
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
  const css = readFileSync("src/chrome/TeammatePage.css", "utf8");
  const overlays = readFileSync("src/chrome/Overlays.css", "utf8");
  const rule = (sheet: string, selector: string) => {
    const at = sheet.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return sheet.slice(at, sheet.indexOf("}", at));
  };

  it("keeps a member's mark full size in the header, clear of the close button's 28px", () => {
    // The header shrinks its buttons to 28px; the mark is no button, so its
    // own 60px holds.
    expect(
      rule(overlays, '.modal-panel[role="dialog"] > header button'),
    ).toContain("width: 28px");
    const mark = rule(
      css,
      ".crew-settings.teammate-sheet > header .crew-member-mark",
    );
    expect(mark).toContain("width: 60px");
    expect(mark).toContain("height: 60px");
  });
});

describe("a teammate's chat before Avos's first card", () => {
  it("can't be opened, and says why, from its page", async () => {
    const openChat = vi.fn(async () => null as string | null);
    const onClose = vi.fn();
    const uninstall = installCrewWorkspace({
      openChat,
      openCrew: vi.fn(),
      openSettings: vi.fn(),
      stop: vi.fn(async () => undefined),
    });
    try {
      await act(async () =>
        root.render(
          createElement(CrewSettingsSheet, {
            path: PATH,
            initialPage: "builder",
            onTurnOn: async () => null,
            onClose,
          }),
        ),
      );
      // No copy yet: the chat starts with Avos's first card.
      const open = buttonNamed("Open chat")!;
      expect(open.disabled).toBe(true);
      expect(open.title).toBe("Builder's chat starts with Avos's first card.");
      expect(
        sheet().querySelector("[data-crew-member-notice]")?.textContent,
      ).toBe("Builder's chat starts with Avos's first card.");
      // With its copy, a chat that still won't open says why; the sheet stays.
      await act(async () =>
        updateCrew(PATH, (crew) => ({
          ...crew,
          copy: { path: "/copies/site", branch: "aven/crew/site", root: PATH },
        })),
      );
      openChat.mockResolvedValueOnce("Couldn't open Builder's chat.");
      await act(async () => buttonNamed("Open chat")!.click());
      expect(onClose).not.toHaveBeenCalled();
      expect(sheet().querySelector('[role="alert"]')?.textContent).toBe(
        "Couldn't open Builder's chat.",
      );
    } finally {
      uninstall();
    }
  });
});

describe("the way back", () => {
  it("goes from Add a helper to Helpers, and from a helper to where you opened it", async () => {
    await open("add");
    // A teammate opened from Build a team goes back there.
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>('[data-crew-member-row="checker"]')!
        .click(),
    );
    expect(sheet().querySelector("[data-crew-member-page]")).not.toBeNull();
    await act(async () => buttonNamed("Add a helper")!.click());
    expect(sheet().querySelector("[data-crew-add]")).not.toBeNull();
    // Add a helper goes back to Helpers, and Helpers to Avos.
    await act(async () => buttonNamed("Helpers")!.click());
    expect(
      sheet().querySelector('[data-crew-settings-page="helpers"]'),
    ).not.toBeNull();
    await act(async () => buttonNamed("aven-site's Avos")!.click());
    expect(sheet().querySelector("[data-crew-settings]")).not.toBeNull();
  });
});

describe("every installed agent", () => {
  it("fits in rows of four on a teammate's page", async () => {
    installed.ids = new Set([
      "codex",
      "cursor",
      "grok",
      "opencode",
      "pi",
      "omp",
      "fx",
    ]);
    await open("checker");
    const agent = sheet().querySelector<HTMLElement>(
      '[role="radiogroup"][aria-label="Agent"]',
    )!;
    expect(agent.querySelectorAll('[role="radio"]').length).toBeGreaterThan(4);
    expect(agent.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
  });
});
