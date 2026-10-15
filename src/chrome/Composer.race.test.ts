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
// The model list has its own tests; this file is about the Race section.
vi.mock("./ModelPicker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ModelPicker")>()),
  ModelChooser: () => null,
}));
vi.mock("./ContextMeter", () => ({ ContextMeter: () => null }));
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
  });
  agents.list = agents.all;
  registerHarness(codexAdapter);
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
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(createElement(Composer, props)));
}
const pill = () =>
  container.querySelector<HTMLButtonElement>("[data-agent-pill]")!;
const panel = () =>
  document.body.querySelector<HTMLElement>("[data-agent-panel]");
const raceSection = () =>
  document.body.querySelector<HTMLElement>("[data-race-options]")!;
const raceSwitch = () =>
  raceSection().querySelector<HTMLButtonElement>('[role="switch"]')!;
const raceChip = () =>
  container.querySelector<HTMLButtonElement>('[aria-label="Turn off Race"]');
const lane = (name: string) =>
  [
    ...raceSection().querySelectorAll<HTMLButtonElement>('[role="checkbox"]'),
  ].find((item) => item.textContent?.includes(name))!;
const field = () => container.querySelector("textarea")!;
const sendButton = () =>
  container.querySelector<HTMLButtonElement>(".composer-send")!;

async function openPanel() {
  if (!panel()) await act(async () => pill().click());
}
async function turnRaceOn() {
  await openPanel();
  await act(async () => raceSwitch().click());
}

it("races the message across this chat's agent and another instead of sending it", async () => {
  await render();
  await turnRaceOn();
  expect(raceSwitch().getAttribute("aria-checked")).toBe("true");
  expect(raceChip()?.textContent).toContain("Race · 2");
  const send = container.querySelector<HTMLButtonElement>(
    '[aria-label="Race 2 agents"]',
  );
  expect(send).not.toBeNull();
  await act(async () => send!.click());
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
  expect(raceSwitch().getAttribute("aria-checked")).toBe("false");
  expect(raceChip()).toBeNull();
});

it("adds a third agent from the Race section", async () => {
  await render();
  await openPanel();
  // Two agents is the minimum, so the second one can't be unticked yet.
  expect(lane("Claude").disabled).toBe(true);
  await act(async () => lane("Cursor").click());
  expect(lane("Claude").disabled).toBe(false);
  await act(async () => raceSwitch().click());
  expect(
    container.querySelector('[aria-label="Race 3 agents"]'),
  ).not.toBeNull();
});

it("turns Race off from its chip beside the + button", async () => {
  await render();
  await turnRaceOn();
  await act(async () => raceChip()!.click());
  expect(raceChip()).toBeNull();
  expect(raceSwitch().getAttribute("aria-checked")).toBe("false");
  expect(sendButton().getAttribute("aria-label")).toBe("Send");
  expect(document.activeElement).toBe(field());
});

it("hides Race when the chat does not offer it", async () => {
  props.onRace = undefined;
  await render();
  await openPanel();
  expect(panel()).not.toBeNull();
  expect(document.body.querySelector("[data-race-options]")).toBeNull();
});

it("puts the message back when the race can't start", async () => {
  props.onRace = vi.fn(async () => false);
  await render();
  await turnRaceOn();
  await act(async () => sendButton().click());
  expect(props.onRace).toHaveBeenCalledOnce();
  expect(field().value).toBe("Fix the login loop");
  expect(sendButton().getAttribute("aria-label")).toBe("Send");
});

it("keeps Race and Plan mode exclusive, so a plan is never raced", async () => {
  await render();
  await turnRaceOn();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Add files or choose a mode"]',
      )!
      .click(),
  );
  const plan = [
    ...document.body.querySelectorAll<HTMLButtonElement>("[aria-pressed]"),
  ].find((item) => item.textContent?.includes("Plan mode"))!;
  await act(async () => plan.click());
  expect(raceChip()).toBeNull();
  await act(async () => sendButton().click());
  expect(props.onRace).not.toHaveBeenCalled();
  expect(props.onSubmit).toHaveBeenCalledWith(
    "Fix the login loop",
    [],
    expect.objectContaining({ intent: "plan" }),
  );
});

it("turns Race off when fewer than two agents remain", async () => {
  await render();
  await turnRaceOn();
  expect(raceSwitch().getAttribute("aria-checked")).toBe("true");
  agents.list = agents.all.filter((agent) => agent.harness === "codex");
  // Any catalog or availability change re-reads the installed agents.
  await act(async () => setHarnessModels("claude", pickerModelsFor("claude")));
  expect(raceSwitch().disabled).toBe(true);
  expect(raceSwitch().getAttribute("aria-checked")).toBe("false");
  expect(raceSection().textContent).toContain(
    "Install or enable a second agent to race",
  );
  expect(raceChip()).toBeNull();
  expect(sendButton().getAttribute("aria-label")).toBe("Send");
});

it("races each agent on the model picked for it", async () => {
  const pick = pickerModelsFor("claude").find((model) => model.id !== "opus")!;
  await render();
  await openPanel();
  const chip = raceSection().querySelector<HTMLButtonElement>(
    `[aria-label^="${HARNESS_TITLE.claude} model:"]`,
  )!;
  await act(async () => chip.click());
  const option = [
    ...raceSection().querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((item) => item.textContent === pick.name)!;
  await act(async () => option.click());
  expect(chip.getAttribute("aria-label")).toBe(
    `${HARNESS_TITLE.claude} model: ${pick.name}`,
  );
  await turnRaceOn();
  await act(async () => sendButton().click());
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
  const pick = pickerModelsFor("codex").find((model) => model.id !== "gpt-5")!;
  await render();
  await openPanel();
  const chip = raceSection().querySelector<HTMLButtonElement>(
    `[aria-label^="${HARNESS_TITLE.codex} model:"]`,
  )!;
  expect(chip.disabled).toBe(false);
  await act(async () => chip.click());
  const option = [
    ...raceSection().querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((item) => item.textContent === pick.name)!;
  await act(async () => option.click());
  await turnRaceOn();
  await act(async () => sendButton().click());
  expect(props.onRace).toHaveBeenCalledWith(
    "Fix the login loop",
    [],
    [
      expect.objectContaining({ harness: "codex", model: pick.id }),
      expect.objectContaining({ harness: "claude" }),
    ],
  );
  // Only for the race: the chat keeps its own model.
  expect(props.onModelChange).not.toHaveBeenCalled();
});

it("offers the model in use while a provider's list is still loading", async () => {
  await render();
  await openPanel();
  const chip = raceSection().querySelector<HTMLButtonElement>(
    `[aria-label^="${HARNESS_TITLE.codex} model:"]`,
  )!;
  await act(async () => chip.click());
  const options = [
    ...raceSection().querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ];
  expect(options.map((item) => item.textContent)).toContain("gpt-5");
  expect(
    options
      .find((item) => item.textContent === "gpt-5")
      ?.getAttribute("aria-selected"),
  ).toBe("true");
});
