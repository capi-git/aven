// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerHarness } from "../lib/harness/registry";
import { codexAdapter } from "../lib/harness/codexAdapter";
import type { SkillsCliOutcome, SkillsCliRequest } from "../lib/skillInstall";
import { Composer } from "./Composer";

const catalog = vi.hoisted(() => ({ refresh: vi.fn(async () => true) }));
const cli = vi.hoisted(() => ({
  runs: [] as {
    request: SkillsCliRequest;
    resolve: (outcome: SkillsCliOutcome) => void;
  }[],
  forget: vi.fn(),
}));
vi.mock("./useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [], refresh: catalog.refresh }),
}));
vi.mock("../lib/skillInstall", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/skillInstall")>()),
  runSkillsCli: (request: SkillsCliRequest) =>
    new Promise<SkillsCliOutcome>((resolve) =>
      cli.runs.push({ request, resolve }),
    ),
  cancelSkillsCli: vi.fn(async () => {}),
  forgetSkillListsAfterInstall: cli.forget,
}));
vi.mock("../hooks/useTabGroupLogos", () => ({ useTabGroupLogos: () => ({}) }));
vi.mock("./AgentPill", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./AgentPill")>()),
  AgentPill: () => null,
}));
vi.mock("./ComposerRunner", () => ({ ComposerRunner: () => null }));

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
  catalog.refresh.mockClear();
  cli.runs = [];
  cli.forget.mockClear();
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
    onFocus: vi.fn(),
    onCwdChange: vi.fn(),
    onModelChange: vi.fn(),
    onRuntimeModeChange: vi.fn(),
    onSubmit: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const field = () => container.querySelector("textarea")!;
const dialog = () =>
  document.body.querySelector<HTMLElement>("[data-add-skill]");

async function type(text: string) {
  await act(async () => {
    const el = field();
    el.value = text;
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  });
}
async function press(key: string, target: EventTarget = field()) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}
/** The dialog is loaded on first use. */
async function waitForDialog() {
  for (let i = 0; i < 100 && !dialog(); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  return dialog();
}

it("opens Add a skill from the / list and refreshes it after an install", async () => {
  await act(async () => root.render(createElement(Composer, props)));
  await type("/");
  const row = [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.includes("Add a skill…"),
  )!;
  await act(async () => row.click());
  const form = await waitForDialog();
  expect(form).not.toBeNull();

  await act(async () => {
    const input = form!.querySelector("input")!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "nutlope/hallmark");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const submit = () =>
    act(async () => {
      form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
  await submit();
  await act(async () =>
    cli.runs[0].resolve({
      status: "finished",
      code: 0,
      stdout:
        "◇  Available Skills\n│    hallmark\n│      Make pages look designed.\n└  Use --skill <name>\n",
      stderr: "",
      installed: [],
    }),
  );
  await submit();
  expect(cli.runs[1].request).toMatchObject({
    action: "add",
    source: "nutlope/hallmark",
    global: true,
  });
  catalog.refresh.mockClear();
  await act(async () =>
    cli.runs[1].resolve({
      status: "finished",
      code: 0,
      stdout: "",
      stderr: "",
      installed: ["hallmark"],
    }),
  );
  expect(cli.forget).toHaveBeenCalledWith("global", "/work/site");
  expect(catalog.refresh).toHaveBeenCalledWith({ refresh: true });
  expect(form!.textContent).toContain("Added hallmark for all projects");

  await submit();
  expect(dialog()).toBeNull();
  expect(props.onSubmit).not.toHaveBeenCalled();
});

it("reaches Add a skill from the keyboard and closes with Escape", async () => {
  await act(async () => root.render(createElement(Composer, props)));
  await type("/zzz");
  await press("ArrowDown");
  await press("ArrowDown");
  await press("Enter");
  expect(await waitForDialog()).not.toBeNull();
  expect(container.querySelector('[aria-label="Skill name"]')).toBeNull();
  expect(props.onSubmit).not.toHaveBeenCalled();
  await press("Escape", document.activeElement ?? window);
  expect(dialog()).toBeNull();
});
