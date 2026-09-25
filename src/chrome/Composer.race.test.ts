// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerHarness } from "../lib/harness/registry";
import { codexAdapter } from "../lib/harness/codexAdapter";
import { Composer } from "./Composer";

vi.mock("./useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [] }),
}));
vi.mock("../hooks/useTabGroupLogos", () => ({ useTabGroupLogos: () => ({}) }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));
vi.mock("./ModelSettings", () => ({ ModelSettings: () => null }));
vi.mock("./AccessPicker", () => ({ AccessPicker: () => null }));
vi.mock("./ContextMeter", () => ({ ContextMeter: () => null }));
vi.mock("./ComposerRunner", () => ({ ComposerRunner: () => null }));
vi.mock("../lib/paletteAgents", () => ({
  availablePaletteAgents: () => [
    { harness: "claude", model: "opus", label: "Claude Code · Opus" },
    { harness: "codex", model: "gpt-5", label: "Codex · GPT-5" },
    { harness: "cursor", model: "composer", label: "Cursor · Composer" },
  ],
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
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(createElement(Composer, props)));
}
const raceButton = () =>
  container.querySelector<HTMLButtonElement>("[data-race-toggle] button")!;

it("races the message across this chat's agent and another instead of sending it", async () => {
  await render();
  await act(async () => raceButton().click());
  const toggle = document.body.querySelector<HTMLInputElement>(
    '[aria-label="Race"] input[type="checkbox"]',
  )!;
  await act(async () => toggle.click());
  expect(raceButton().getAttribute("aria-pressed")).toBe("true");
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
  expect(raceButton().getAttribute("aria-pressed")).toBe("false");
});

it("adds a third agent from the Race menu", async () => {
  await render();
  await act(async () => raceButton().click());
  const cursor = [
    ...document.body.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Race"] [role="menuitemcheckbox"]',
    ),
  ].find((item) => item.textContent?.includes("Cursor"))!;
  await act(async () => cursor.click());
  const toggle = document.body.querySelector<HTMLInputElement>(
    '[aria-label="Race"] input[type="checkbox"]',
  )!;
  await act(async () => toggle.click());
  expect(
    container.querySelector('[aria-label="Race 3 agents"]'),
  ).not.toBeNull();
});

it("hides Race when the chat does not offer it", async () => {
  props.onRace = undefined;
  await render();
  expect(container.querySelector("[data-race-toggle]")).toBeNull();
});
