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

/** Open what sits one level deeper: Edit limits ›, More ›, Rules ›. */
const disclose = async (selector: string) =>
  act(async () => sheet().querySelector<HTMLButtonElement>(selector)!.click());

describe("the team's settings", () => {
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
    expect(checker).toBe("Codex · GPT-9.1 · off");
    expect(rows[2]!.querySelector("small")!.textContent).toBe(
      "Claude · Haiku 9",
    );
    expect(rows[0]!.querySelector("small")!.textContent).toMatch(/^Claude · /);
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
      TEAM_ALWAYS_LINE,
    );
  });

  it("lets you decide what teammates may do without asking", async () => {
    await open();
    const access = sheet().querySelector<HTMLElement>("[data-crew-access]")!;
    const toggle = access.querySelector<HTMLButtonElement>(".settings-toggle")!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click());
    expect(crewAccess(getCrew(PATH)!).deletes).toBe(false);
    const choice = (label: string) =>
      [...access.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
        (item) => item.textContent === label,
      )!;
    expect(choice("Builders").getAttribute("aria-checked")).toBe("true");
    await act(async () => choice("Everyone").click());
    expect(crewAccess(getCrew(PATH)!).web).toBe("everyone");
    expect(choice("Say no").getAttribute("aria-checked")).toBe("true");
    await act(async () => choice("Ask me").click());
    expect(crewAccess(getCrew(PATH)!).others).toBe("ask");
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
      sheet().querySelector('[aria-label="Runs a day, all teams"]'),
    ).toBeNull();
    await disclose("[data-crew-limits-more]");
    await pick(
      sheet().querySelector<HTMLSelectElement>(
        '[aria-label="Runs a day, all teams"]',
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

  it("opens a teammate's page from the list, and Add teammate opens Build a team", async () => {
    await open();
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
    await act(async () => buttonNamed("aven-site team")!.click());
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>("[data-crew-add-member]")!
        .click(),
    );
    expect(sheet().querySelector("[data-crew-add]")).not.toBeNull();
    expect(sheet().querySelector("h2")?.textContent).toBe(
      "Build aven-site's team",
    );
  });
});

describe("Build a team", () => {
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
    // A team that has started can't be swapped for a suggested one.
    expect(sheet().querySelector("[data-crew-team]")).toBeNull();
    expect(buttonNamed("Done")).toBeTruthy();
  });

  it("starts from a suggested team before the team has ever started, and Start team turns it on", async () => {
    updateCrew(PATH, (crew) => ({ ...crew, on: false, onAt: undefined }));
    const onTurnOn = vi.fn(async () => null);
    const onStarted = vi.fn();
    await act(async () =>
      root.render(
        createElement(CrewSettingsSheet, {
          path: PATH,
          initialPage: "add",
          onTurnOn,
          onStarted,
          onClose: () => {},
        }),
      ),
    );
    const team = (key: string) =>
      sheet().querySelector<HTMLElement>(`[data-crew-team="${key}"]`)!;
    // A new team is Builder, Checker and Security: Ship features.
    expect(team("ship").getAttribute("aria-checked")).toBe("true");
    expect(team("polish").textContent).toContain("Designer, Tester, Checker");
    await act(async () => team("polish").click());
    const roles = getCrew(PATH)!.members.map(
      (member) => member.preset ?? member.id,
    );
    // Its Checker stays as it was; the Builder and Security leave.
    expect(roles.sort()).toEqual(["checker", "designer", "tester"]);
    expect(team("polish").getAttribute("aria-checked")).toBe("true");
    await act(async () => buttonNamed("Start team")!.click());
    expect(onTurnOn).toHaveBeenCalledWith(PATH);
    expect(onStarted).toHaveBeenCalledWith(PATH);
  });

  it("is one stop in the tab order, and arrow keys move between the suggested teams", async () => {
    updateCrew(PATH, (crew) => ({ ...crew, on: false, onAt: undefined }));
    await open("add");
    const radios = () => [
      ...sheet().querySelectorAll<HTMLButtonElement>("[data-crew-team]"),
    ];
    expect(radios().map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
    const before = JSON.stringify(getCrew(PATH)!.members);
    await act(async () =>
      radios()[0]!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    // Arrows only move: who is in the team stays as it was.
    expect(document.activeElement).toBe(radios()[1]);
    expect(JSON.stringify(getCrew(PATH)!.members)).toBe(before);
    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(
      ["true", "false", "false"],
    );
    // Choosing is a press (Space or Enter on a button is one).
    await act(async () => radios()[1]!.click());
    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(
      ["false", "true", "false"],
    );
    expect(radios().map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("never drops a teammate whose settings you changed when you pick a suggested team", async () => {
    updateCrew(PATH, (crew) => ({
      ...crew,
      on: false,
      onAt: undefined,
      members: crew.members.map((member) =>
        member.id === "builder"
          ? { ...member, instructions: "Use the house style." }
          : member,
      ),
    }));
    await open("add");
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>('[data-crew-team="polish"]')!
        .click(),
    );
    expect(crewMemberById(getCrew(PATH)!, "builder")?.instructions).toBe(
      "Use the house style.",
    );
    expect(sheet().querySelector('[role="alert"]')?.textContent).toContain(
      "Kept Builder: you changed its settings.",
    );
  });

  it("says why Start team couldn't, and starts nothing", async () => {
    updateCrew(PATH, (crew) => ({ ...crew, on: false, onAt: undefined }));
    const onStarted = vi.fn();
    await act(async () =>
      root.render(
        createElement(CrewSettingsSheet, {
          path: PATH,
          initialPage: "add",
          onTurnOn: async () => "Teams need a Git project.",
          onStarted,
          onClose: () => {},
        }),
      ),
    );
    await act(async () => buttonNamed("Start team")!.click());
    expect(sheet().querySelector('[role="alert"]')?.textContent).toBe(
      "Teams need a Git project.",
    );
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("adds your own teammate with a name and one job; a Builder can't pick Codex", async () => {
    await open("add");
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>(
          '[aria-label="Add your own teammate"]',
        )!
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
  it("sets its mark, agent, model and effort in view, with no floating menu; other apps say why not", async () => {
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
    const remove = buttonNamed("Remove from team")!;
    expect(remove.disabled).toBe(true);
    expect(remove.className).toBe("crew-settings-remove-link");
    expect(remove.title).toBe("A team needs a Checker.");
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

describe("a teammate's chat before the team's first card", () => {
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
      // No copy yet: the chat starts with the team's first card.
      const open = buttonNamed("Open chat")!;
      expect(open.disabled).toBe(true);
      expect(open.title).toBe(
        "Builder's chat starts with the team's first card.",
      );
      expect(
        sheet().querySelector("[data-crew-member-notice]")?.textContent,
      ).toBe("Builder's chat starts with the team's first card.");
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
  it("goes from Build a team to the team, and from a teammate to where you opened it", async () => {
    await open("add");
    // A teammate opened from Build a team goes back there.
    await act(async () =>
      sheet()
        .querySelector<HTMLButtonElement>('[data-crew-member-row="checker"]')!
        .click(),
    );
    expect(sheet().querySelector("[data-crew-member-page]")).not.toBeNull();
    await act(async () => buttonNamed("Build aven-site's team")!.click());
    expect(sheet().querySelector("[data-crew-add]")).not.toBeNull();
    // Build a team goes back to the team.
    await act(async () => buttonNamed("aven-site team")!.click());
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
