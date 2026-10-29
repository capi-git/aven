// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerHarness } from "../lib/harness/registry";
import { codexAdapter } from "../lib/harness/codexAdapter";
import {
  pickerModelsFor,
  resetHarnessModelOverlays,
  setHarnessModels,
} from "../lib/models";
import { loadRaceLaneChoice } from "../lib/raceAgents";
import { resetDiscussionStore, type DiscussionHost } from "../lib/discussions";
import { HARNESS_TITLE } from "../lib/session";
import { Composer } from "./Composer";

const agents = vi.hoisted(() => ({
  all: [
    { harness: "claude", model: "opus", label: "Claude Code · Opus" },
    { harness: "codex", model: "gpt-5", label: "Codex · GPT-5" },
    { harness: "cursor", model: "composer", label: "Cursor · Composer" },
  ],
  list: [] as { harness: string; model: string; label: string }[],
}));

vi.mock("./useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [] }),
}));
vi.mock("../hooks/useTabGroupLogos", () => ({ useTabGroupLogos: () => ({}) }));
// The model list has its own tests; this file is about Race mode.
vi.mock("./ModelPicker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ModelPicker")>()),
  ModelChooser: () => null,
}));
vi.mock("./ComposerRunner", () => ({ ComposerRunner: () => null }));
vi.mock("../lib/paletteAgents", () => ({
  availablePaletteAgents: () => agents.list,
}));

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof Composer>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  agents.list = agents.all;
  registerHarness(codexAdapter);
  resetDiscussionStore("main");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    enabled: true,
    focused: false,
    harness: "codex",
    model: "gpt-5",
    runtimeMode: "full-access",
    executionCwd: "/work/site",
    hideTopBar: true,
    initialDraft: "Fix the login loop",
    onFocus: vi.fn(),
    onCwdChange: vi.fn(),
    onModelChange: vi.fn(),
    onRuntimeModeChange: vi.fn(),
    onSubmit: vi.fn(),
    onRace: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  resetHarnessModelOverlays();
  resetDiscussionStore();
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(createElement(Composer, props)));
}
// The + menu's modes live on a page of the critter's dialog.
const plusButton = () =>
  container.querySelector<HTMLButtonElement>("[data-helm-critter]")!;
const plusMenu = () =>
  container.querySelector<HTMLElement>("[data-composer-plus]");
const raceEntry = () =>
  plusMenu()?.querySelector<HTMLButtonElement>("[data-composer-race]") ?? null;
const chip = () => container.querySelector<HTMLElement>("[data-race-chip]");
const chipLabel = () =>
  chip()?.querySelector("[data-race-chip-label]")?.textContent;
const chipToggle = () =>
  chip()!.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
const turnOff = () =>
  container.querySelector<HTMLButtonElement>('[aria-label="Turn off Race"]');
const menu = () => document.body.querySelector<HTMLElement>("[data-race-menu]");
const reason = () =>
  menu()?.querySelector("[data-race-reason]")?.textContent ?? null;
const laneLabels = () =>
  [...(menu()?.querySelectorAll("[data-race-lane-choice]") ?? [])].map((row) =>
    row.getAttribute("data-race-lane-label"),
  );
const add = (harness: string) =>
  menu()!.querySelector<HTMLButtonElement>(`[data-race-add="${harness}"]`)!;
const field = () => container.querySelector("textarea")!;
const sendButton = () =>
  container.querySelector<HTMLButtonElement>("[data-helm-send]")!;

async function openPlus() {
  if (plusMenu()) return;
  await act(async () => plusButton().click());
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[data-helm-row="modes"]')!
      .click(),
  );
}
async function pickMode(name: string) {
  await openPlus();
  const entry = [
    ...plusMenu()!.querySelectorAll<HTMLButtonElement>("[aria-checked]"),
  ].find((item) => item.textContent?.includes(name))!;
  await act(async () => entry.click());
}
async function turnRaceOn() {
  await openPlus();
  await act(async () => raceEntry()!.click());
}
async function openChip() {
  if (!menu()) await act(async () => chipToggle().click());
}
async function closeChip() {
  if (menu()) await act(async () => chipToggle().click());
}
async function send() {
  await act(async () => sendButton().click());
}

it("starts from the + menu and races the message instead of sending it", async () => {
  await render();
  await openPlus();
  expect(raceEntry()?.textContent).toContain("Race");
  expect(raceEntry()?.getAttribute("aria-checked")).toBe("false");
  await act(async () => raceEntry()!.click());
  expect(plusMenu()).toBeNull();
  expect(chipLabel()).toBe("Race · Codex · Claude");
  // Its tooltip names each agent in full.
  expect(chip()?.querySelector("button")?.title).toBe(
    "Codex · gpt-5, Claude Code · Opus",
  );
  // Two agents can race, so the dropdown stays closed until asked.
  expect(menu()).toBeNull();
  expect(sendButton().getAttribute("aria-label")).toBe("Race 2 agents");
  await openPlus();
  expect(raceEntry()?.getAttribute("aria-checked")).toBe("true");
  await act(async () => plusButton().click());
  await send();
  expect(props.onSubmit).not.toHaveBeenCalled();
  expect(props.onRace).toHaveBeenCalledWith(
    "Fix the login loop",
    [],
    [
      { harness: "codex", model: "gpt-5", label: "Codex · gpt-5" },
      { harness: "claude", model: "opus", label: "Claude Code · Opus" },
    ],
  );
  // Race is one-shot: the next message sends normally.
  expect(chip()).toBeNull();
  expect(sendButton().getAttribute("aria-label")).toBe("Send");
});

it("adds a third agent from the chip's dropdown and remembers it", async () => {
  await render();
  await turnRaceOn();
  await openChip();
  expect(laneLabels()).toEqual(["Codex · gpt-5", "Claude Code · Opus"]);
  const leaveOut = () =>
    menu()!.querySelector<HTMLButtonElement>(
      '[aria-label="Leave Claude Opus out of the race"]',
    )!;
  // Two agents is the minimum, so the second one can't be left out yet.
  expect(leaveOut().disabled).toBe(true);
  await act(async () => add("cursor").click());
  expect(laneLabels()).toEqual([
    "Codex · gpt-5",
    "Claude Code · Opus",
    "Cursor · Composer",
  ]);
  expect(chipLabel()).toBe("Race · Codex · Claude · Cursor");
  expect(sendButton().getAttribute("aria-label")).toBe("Race 3 agents");
  expect(loadRaceLaneChoice()).toEqual([
    { harness: "claude", model: "opus" },
    { harness: "cursor", model: "composer" },
  ]);
  await act(async () => leaveOut().click());
  expect(laneLabels()).toEqual(["Codex · gpt-5", "Cursor · Composer"]);
});

it("races two models of one provider when only that provider is installed", async () => {
  agents.list = agents.all.filter((agent) => agent.harness === "codex");
  // Codex lists its models at run time.
  setHarnessModels("codex", [
    { id: "gpt-5", harness: "codex", name: "GPT-5" },
    { id: "gpt-5-mini", harness: "codex", name: "GPT-5 Mini" },
  ]);
  await render();
  await turnRaceOn();
  // One lane can't race: the dropdown opens by itself and says why.
  expect(menu()).not.toBeNull();
  expect(reason()).toBe("Add another agent or model above to race.");
  expect(sendButton().getAttribute("aria-label")).toBe("Choose agents to race");
  await act(async () => add("codex").click());
  expect(laneLabels()).toEqual(["Codex · GPT-5", "Codex · GPT-5 Mini"]);
  expect(chipLabel()).toBe("Race · Codex GPT-5 · Codex GPT-5 Mini");
  // Every Codex model is racing now.
  expect(add("codex").disabled).toBe(true);
  await closeChip();
  await send();
  expect(props.onRace).toHaveBeenCalledWith(
    "Fix the login loop",
    [],
    [
      expect.objectContaining({ harness: "codex", model: "gpt-5" }),
      {
        harness: "codex",
        model: "gpt-5-mini",
        label: `${HARNESS_TITLE.codex} · GPT-5 Mini`,
      },
    ],
  );
});

it("explains why it can't race and never sends the message normally", async () => {
  agents.list = agents.all.filter((agent) => agent.harness === "codex");
  await render();
  await turnRaceOn();
  expect(reason()).toBe("Install or enable another agent to race.");
  await closeChip();
  await send();
  expect(props.onRace).not.toHaveBeenCalled();
  expect(props.onSubmit).not.toHaveBeenCalled();
  expect(menu()?.querySelector('[role="alert"]')?.textContent).toBe(
    "Install or enable another agent to race.",
  );
  expect(field().value).toBe("Fix the login loop");
});

it("asks for the task before racing an empty message", async () => {
  props.initialDraft = undefined;
  await render();
  await turnRaceOn();
  await openChip();
  expect(reason()).toBe("Type the task in the message box, then send.");
});

it("says to send or remove an attached card first", async () => {
  props.noteCard = { id: "n1", slug: "plan", title: "Plan", body: "Steps" };
  await render();
  await turnRaceOn();
  await openChip();
  expect(reason()).toBe("Send or remove the attached card before racing.");
  await closeChip();
  await send();
  expect(props.onRace).not.toHaveBeenCalled();
  expect(props.onSubmit).not.toHaveBeenCalled();
});

it("turns Race off from its chip beside the critter", async () => {
  await render();
  await turnRaceOn();
  await act(async () => turnOff()!.click());
  expect(chip()).toBeNull();
  expect(sendButton().getAttribute("aria-label")).toBe("Send");
  expect(document.activeElement).toBe(field());
});

it("hides Race when the chat does not offer it, and the agent panel has none", async () => {
  props.onRace = undefined;
  await render();
  await openPlus();
  expect(raceEntry()).toBeNull();
  await act(async () => plusButton().click());
  props.onRace = vi.fn();
  await render();
  // The Model row opens the agent's panel: Race is not in it.
  await act(async () => plusButton().click());
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[data-helm-row="model"]')!
      .click(),
  );
  expect(document.body.querySelector("[data-agent-panel]")).not.toBeNull();
  expect(
    document.body.querySelector("[data-agent-panel] [data-race-options]"),
  ).toBeNull();
});

it("puts the message and Race mode back when the race can't start", async () => {
  props.onRace = vi.fn(async () => false);
  await render();
  await turnRaceOn();
  await send();
  expect(props.onRace).toHaveBeenCalledOnce();
  expect(field().value).toBe("Fix the login loop");
  expect(chip()).not.toBeNull();
  expect(sendButton().getAttribute("aria-label")).toBe("Race 2 agents");
});

it("keeps Race and Plan mode exclusive, so a plan is never raced", async () => {
  await render();
  await turnRaceOn();
  await pickMode("Plan mode");
  expect(chip()).toBeNull();
  await send();
  expect(props.onRace).not.toHaveBeenCalled();
  expect(props.onSubmit).toHaveBeenCalledWith(
    "Fix the login loop",
    [],
    expect.objectContaining({ intent: "plan" }),
  );
});

it("lets a typed /plan win over Race mode", async () => {
  props.initialDraft = "/plan Fix the login loop";
  await render();
  await turnRaceOn();
  await send();
  expect(props.onRace).not.toHaveBeenCalled();
  expect(props.onSubmit).toHaveBeenCalledWith(
    "Fix the login loop",
    [],
    expect.objectContaining({ intent: "plan" }),
  );
});

it("keeps Race, Orchestrator and Discuss exclusive", async () => {
  const discussion: DiscussionHost = {
    options: () => ({
      candidates: [
        {
          sessionId: "b",
          title: "Review",
          harness: "claude",
          model: "Opus",
          cwd: "/work/site",
        },
      ],
    }),
    start: vi.fn(() => null),
  };
  props.hideTopBar = false;
  props.sessionId = "a";
  props.cwd = "/work/site";
  props.discussion = discussion;
  await render();
  await turnRaceOn();
  expect(chip()).not.toBeNull();
  await pickMode("Orchestrator");
  expect(chip()).toBeNull();
  const orchestrator = () =>
    container.querySelector('[aria-label="Turn off Orchestrator mode"]');
  expect(orchestrator()).not.toBeNull();
  await turnRaceOn();
  expect(chip()).not.toBeNull();
  expect(orchestrator()).toBeNull();
  await pickMode("Discuss");
  expect(chip()).toBeNull();
  const discuss = () => container.querySelector("[data-discussion-chip]");
  expect(discuss()).not.toBeNull();
  await turnRaceOn();
  expect(discuss()).toBeNull();
  await send();
  expect(discussion.start).not.toHaveBeenCalled();
  expect(props.onRace).toHaveBeenCalledOnce();
});

it("races each agent on the model picked for it", async () => {
  const pick = pickerModelsFor("claude").find((model) => model.id !== "opus")!;
  await render();
  await turnRaceOn();
  await openChip();
  const modelButton = () =>
    menu()!.querySelector<HTMLButtonElement>('[aria-label^="Claude model:"]')!;
  await act(async () => modelButton().click());
  const option = [
    ...menu()!.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((item) => item.textContent === pick.name)!;
  await act(async () => option.click());
  expect(modelButton().getAttribute("aria-label")).toBe(
    `Claude model: ${pick.name}`,
  );
  await closeChip();
  await send();
  expect(props.onRace).toHaveBeenCalledWith(
    "Fix the login loop",
    [],
    [
      expect.objectContaining({ harness: "codex", model: "gpt-5" }),
      {
        harness: "claude",
        model: pick.id,
        label: `${HARNESS_TITLE.claude} · ${pick.name}`,
      },
    ],
  );
});

it("lets this chat's agent race on another of its models", async () => {
  // Codex lists its models at run time.
  setHarnessModels("codex", [
    { id: "gpt-5", harness: "codex", name: "GPT-5" },
    { id: "gpt-5-mini", harness: "codex", name: "GPT-5 Mini" },
  ]);
  await render();
  await turnRaceOn();
  await openChip();
  const modelButton = menu()!.querySelector<HTMLButtonElement>(
    `[aria-label^="${HARNESS_TITLE.codex} model:"]`,
  )!;
  expect(modelButton.disabled).toBe(false);
  await act(async () => modelButton.click());
  const option = [
    ...menu()!.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((item) => item.textContent === "GPT-5 Mini")!;
  await act(async () => option.click());
  await closeChip();
  await send();
  expect(props.onRace).toHaveBeenCalledWith(
    "Fix the login loop",
    [],
    [
      expect.objectContaining({ harness: "codex", model: "gpt-5-mini" }),
      expect.objectContaining({ harness: "claude" }),
    ],
  );
  // Only for the race: the chat keeps its own model.
  expect(props.onModelChange).not.toHaveBeenCalled();
});

it("offers the model in use while a provider's list is still loading", async () => {
  await render();
  await turnRaceOn();
  await openChip();
  await act(async () =>
    menu()!
      .querySelector<HTMLButtonElement>(
        `[aria-label^="${HARNESS_TITLE.codex} model:"]`,
      )!
      .click(),
  );
  const options = [
    ...menu()!.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ];
  expect(options.map((item) => item.textContent)).toContain("gpt-5");
  expect(
    options
      .find((item) => item.textContent === "gpt-5")
      ?.getAttribute("aria-selected"),
  ).toBe("true");
});

it("offers no role for racing agents, so their comparison stays fair", async () => {
  await render();
  await turnRaceOn();
  await openChip();
  expect(menu()!.querySelector("[data-role-picker]")).toBeNull();
  expect(menu()!.textContent).not.toMatch(/Reviewer|Skeptic|Tester|Designer/);
});

it("moves through the dropdown with the arrow keys from the start, and keeps the keyboard there after a choice", async () => {
  setHarnessModels("codex", [
    { id: "gpt-5", harness: "codex", name: "GPT-5" },
    { id: "gpt-5-mini", harness: "codex", name: "GPT-5 Mini" },
  ]);
  await render();
  await turnRaceOn();
  await openChip();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // The dropdown holds the keyboard: ↓ reaches its first button.
  const surface = menu()!;
  await act(async () =>
    (document.activeElement ?? surface).dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  expect(surface.contains(document.activeElement)).toBe(true);
  expect(document.activeElement?.tagName).toBe("BUTTON");
  // Picking a model keeps the keyboard on that lane's model button.
  const modelButton = surface.querySelector<HTMLButtonElement>(
    '[data-race-lane-model="0"]',
  )!;
  await act(async () => modelButton.click());
  const option = [
    ...surface.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((item) => item.textContent === "GPT-5 Mini")!;
  await act(async () => option.click());
  expect(document.activeElement).toBe(
    menu()!.querySelector('[data-race-lane-model="0"]'),
  );
});

it("forgets this chat's race-only model once the race is sent", async () => {
  setHarnessModels("codex", [
    { id: "gpt-5", harness: "codex", name: "GPT-5" },
    { id: "gpt-5-mini", harness: "codex", name: "GPT-5 Mini" },
  ]);
  await render();
  await turnRaceOn();
  await openChip();
  await act(async () =>
    menu()!
      .querySelector<HTMLButtonElement>('[data-race-lane-model="0"]')!
      .click(),
  );
  await act(async () =>
    [...menu()!.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((item) => item.textContent === "GPT-5 Mini")!
      .click(),
  );
  await closeChip();
  await send();
  // The next race starts from the chat's own model again.
  await act(async () => {
    field().value = "Again";
  });
  await turnRaceOn();
  const title = chip()?.querySelector("button")?.title ?? "";
  expect(title).toContain("GPT-5");
  expect(title).not.toContain("Mini");
});

it("drops a refusal once the lanes change", async () => {
  // Only Codex is installed, with two models: a second one can race.
  agents.list = agents.all.filter((agent) => agent.harness === "codex");
  setHarnessModels("codex", [
    { id: "gpt-5", harness: "codex", name: "GPT-5" },
    { id: "gpt-5-mini", harness: "codex", name: "GPT-5 Mini" },
  ]);
  await render();
  await turnRaceOn();
  await closeChip();
  await send();
  expect(menu()?.querySelector('[role="alert"]')?.textContent).toBe(
    "Add another agent or model above to race.",
  );
  await act(async () => add("codex").click());
  expect(laneLabels()).toHaveLength(2);
  expect(menu()?.querySelector('[role="alert"]')).toBeNull();
});

it("shortens the chip in a narrow message box", async () => {
  let width = 700;
  const spy = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-composer-box") ? width : 0;
    });
  // The box is measured when it appears.
  const renderAt = async (next: number) => {
    width = next;
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    await turnRaceOn();
  };
  try {
    await renderAt(700);
    expect(chipLabel()).toBe("Race · Codex · Claude");

    await renderAt(480);
    expect(chipLabel()).toBe("Race · 2 agents");
    // The full text stays in the tooltip and on the chip for the smoke test.
    expect(chipToggle().title).toContain("Race · Codex · Claude");
    expect(chip()!.dataset.fullLabel).toBe("Race · Codex · Claude");

    await renderAt(360);
    expect(chipLabel()).toBe("Race · 2");
    // The critter still names the agent in full for screen readers.
    expect(plusButton().getAttribute("aria-label")).toContain("Codex");
  } finally {
    spy.mockRestore();
  }
});
